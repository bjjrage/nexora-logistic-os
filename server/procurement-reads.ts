import {randomUUID} from 'node:crypto';
import type {Express, Request, Response} from 'express';
import {z} from 'zod';
import {authorize, hash, type Actor} from './auth.ts';
import {encodeCsv} from './csv.ts';
import type {Database, Row, SqlValue} from './database.ts';
import {camel} from './db.ts';
import {Logistics} from './domain.ts';
import {ensure} from './errors.ts';

const id = z.uuid();
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const views = ['documents','expenses','payments','payables','overdue','advances','assets','movements','budgets'] as const;
type View = typeof views[number];
const filters = z.object({
  q: z.string().trim().max(200).default(''), from: z.iso.date().optional(), to: z.iso.date().optional(),
  partyId: id.optional(), categoryId: z.union([id, z.literal('unclassified')]).optional(),
  centerId: id.optional(), accountId: id.optional(), month: month.optional(),
  nature: z.enum(['EXPENSE','PURCHASE','ASSET','REMUNERATION']).optional(),
  state: z.enum(['OPEN','PARTIAL','PAID','OVERDUE','VOID','AVAILABLE','APPLIED','REVERSED','ACTIVE','INACTIVE']).optional(),
  kind: z.enum(['PAYMENT','ADVANCE','CREDIT','OPENING','ENTRY','EXIT','TRANSFER','REVERSAL','CASH','BANK','SUPPLIER','BENEFICIARY']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  view: z.enum(views).default('expenses'),
  sort: z.enum(['asc','desc']).default('desc'),
}).strict().refine(input => !input.from || !input.to || input.from <= input.to, {
  path:['to'], message:'La fecha final debe ser igual o posterior a la inicial.',
});
type Filters = z.infer<typeof filters>;
type Query = {with?: string; from: string; where: string[]; args: SqlValue[]; order: string};

function restrict(query: Query, clause: string, ...args: SqlValue[]) {
  query.where.push(clause);
  query.args.push(...args);
}

function search(query: Query, input: Filters, columns: string[]) {
  if (!input.q) return;
  const pattern = '%' + input.q.toLowerCase().replace(/[!%_]/g, '!$&') + '%';
  restrict(query, '(' + columns.map(column => `LOWER(COALESCE(${column}, '')) LIKE ? ESCAPE '!'`).join(' OR ') + ')',
    ...columns.map(() => pattern));
}

function period(query: Query, input: Filters, column: string) {
  if (input.from) restrict(query, `${column}>=?`, input.from);
  if (input.to) restrict(query, `${column}<=?`, input.to);
  if (input.month) restrict(query, `SUBSTR(${column},1,7)=?`, input.month);
}

function category(query: Query, input: Filters, column: string) {
  if (input.categoryId === 'unclassified') restrict(query, `${column} IS NULL`);
  else if (input.categoryId) restrict(query, `${column}=?`, input.categoryId);
}

function classification(query: Query, input: Filters, alias: string) {
  category(query, input, alias + '.category_id');
  if (input.centerId) restrict(query, `${alias}.center_id=?`, input.centerId);
  if (input.nature) restrict(query, `${alias}.nature=?`, input.nature);
}

function linkedClassification(query: Query, input: Filters, settlement: string) {
  if (!input.categoryId && !input.centerId && !input.nature) return;
  const linked: Query = {from:'',where:[],args:[],order:''};
  classification(linked, input, 'd');
  restrict(query, `EXISTS (
    SELECT 1 FROM procurement_applications a JOIN procurement_documents d ON d.org_id=a.org_id AND d.id=a.document_id
    WHERE a.org_id=${settlement}.org_id AND a.settlement_id=${settlement}.id AND a.reversed_at IS NULL AND d.voided_at IS NULL
      AND ${linked.where.join(' AND ')}
  )`, ...linked.args);
}

function where(query: Query) {
  return query.where.length ? ' WHERE ' + query.where.join(' AND ') : '';
}

function ordered(column: string, input: Filters) {
  return `${column} ${input.sort === 'asc' ? 'ASC' : 'DESC'}, r.id`;
}

// Aggregate live applications once. Payment/advance and credit remain distinguishable.
const documentSource = `WITH applied AS (
  SELECT a.org_id,a.document_id,
    SUM(CASE WHEN s.kind IN ('PAYMENT','ADVANCE') THEN a.amount_pyg ELSE 0 END) AS paid_pyg,
    SUM(CASE WHEN s.kind='CREDIT' THEN a.amount_pyg ELSE 0 END) AS credit_pyg,
    SUM(a.amount_pyg) AS applied_pyg
  FROM procurement_applications a
  JOIN procurement_settlements s ON s.org_id=a.org_id AND s.id=a.settlement_id
  WHERE a.org_id=? AND a.reversed_at IS NULL AND s.reversed_at IS NULL
  GROUP BY a.org_id,a.document_id
), document_data AS (
  SELECT d.*,p.name AS party_name,p.ruc AS party_ruc,u.name AS actor_name,ir.batch_id AS import_batch_id,
    COALESCE(c.name,'Sin clasificar') AS category_name,k.name AS center_name,
    COALESCE(a.paid_pyg,0) AS paid_pyg, COALESCE(a.credit_pyg,0) AS credit_pyg,
    COALESCE(a.applied_pyg,0) AS applied_pyg,
    CASE WHEN d.voided_at IS NOT NULL THEN 0 ELSE d.total_pyg-COALESCE(a.applied_pyg,0) END AS balance_pyg
  FROM procurement_documents d
  JOIN procurement_parties p ON p.org_id=d.org_id AND p.id=d.party_id
  LEFT JOIN users u ON u.org_id=d.org_id AND u.id=d.actor_id
  LEFT JOIN procurement_categories c ON c.org_id=d.org_id AND c.id=d.category_id
  LEFT JOIN procurement_centers k ON k.org_id=d.org_id AND k.id=d.center_id
  LEFT JOIN procurement_import_rows ir ON ir.org_id=d.org_id AND ir.id=d.import_row_id
  LEFT JOIN applied a ON a.org_id=d.org_id AND a.document_id=d.id
  WHERE d.org_id=?
), documents AS (
  SELECT document_data.*, CASE
    WHEN voided_at IS NOT NULL THEN 'VOID'
    WHEN balance_pyg=0 THEN 'PAID'
    WHEN due_date<? THEN 'OVERDUE'
    WHEN applied_pyg>0 THEN 'PARTIAL'
    ELSE 'OPEN' END AS state
  FROM document_data
)`;

function documents(orgId: string, today: string, input: Filters, view?: View): Query {
  const query: Query = {with: documentSource,from:'documents r',where:[],args:[orgId,orgId,today],
    order: view === 'payables' || view === 'overdue'
      ? `CASE WHEN r.due_date IS NULL THEN 1 ELSE 0 END, r.due_date, r.id`
      : ordered('r.document_date',input)};
  if (input.partyId) restrict(query, 'r.party_id=?', input.partyId);
  if (input.state) restrict(query, 'r.state=?', input.state);
  classification(query, input, 'r');
  period(query, input, 'r.document_date');
  search(query, input, ['r.party_name','r.reference','r.description','r.category_name','r.center_name']);
  if (input.accountId) restrict(query, `EXISTS (
    SELECT 1 FROM procurement_applications a JOIN procurement_settlements s ON s.org_id=a.org_id AND s.id=a.settlement_id
    WHERE a.org_id=r.org_id AND a.document_id=r.id AND a.reversed_at IS NULL AND s.reversed_at IS NULL AND s.account_id=?
  )`, input.accountId);
  if (view === 'payables') restrict(query, 'r.balance_pyg>0');
  if (view === 'overdue') restrict(query, "r.state='OVERDUE'");
  if (view === 'expenses') restrict(query, "r.voided_at IS NULL AND r.nature IN ('PURCHASE','EXPENSE','REMUNERATION')");
  if (view === 'assets') restrict(query, "r.voided_at IS NULL AND r.nature='ASSET'");
  return query;
}

const settlementSource = `WITH applied AS (
  SELECT org_id,settlement_id,SUM(amount_pyg) AS applied_pyg
  FROM procurement_applications WHERE org_id=? AND reversed_at IS NULL GROUP BY org_id,settlement_id
), settlements AS (
  SELECT s.*,p.name AS party_name,u.name AS actor_name,b.name AS account_name,
    COALESCE(a.applied_pyg,0) AS applied_pyg,
    CASE WHEN s.reversed_at IS NOT NULL THEN 0 ELSE s.amount_pyg-COALESCE(a.applied_pyg,0) END AS available_pyg,
    CASE WHEN s.reversed_at IS NOT NULL THEN 'REVERSED'
      WHEN s.amount_pyg=COALESCE(a.applied_pyg,0) THEN 'APPLIED' ELSE 'AVAILABLE' END AS state
  FROM procurement_settlements s
  JOIN procurement_parties p ON p.org_id=s.org_id AND p.id=s.party_id
  LEFT JOIN users u ON u.org_id=s.org_id AND u.id=s.actor_id
  LEFT JOIN procurement_accounts b ON b.org_id=s.org_id AND b.id=s.account_id
  LEFT JOIN applied a ON a.org_id=s.org_id AND a.settlement_id=s.id
  WHERE s.org_id=?
)`;

function settlements(orgId: string, input: Filters, view?: View): Query {
  const query: Query = {with:settlementSource,from:'settlements r',where:[],args:[orgId,orgId],order:ordered('r.event_date',input)};
  if (input.partyId) restrict(query, 'r.party_id=?', input.partyId);
  if (input.accountId) restrict(query, 'r.account_id=?', input.accountId);
  if (input.kind) restrict(query, 'r.kind=?', input.kind);
  if (input.state) restrict(query, 'r.state=?', input.state);
  period(query, input, 'r.event_date');
  linkedClassification(query, input, 'r');
  search(query, input, ['r.party_name','r.account_name','r.reference','r.description','r.method']);
  if (view === 'payments') restrict(query, "r.kind IN ('PAYMENT','ADVANCE') AND r.reversed_at IS NULL");
  if (view === 'advances') restrict(query, "r.kind='ADVANCE' AND r.available_pyg>0");
  return query;
}

function movements(orgId: string, input: Filters): Query {
  const query: Query = {
    with: `WITH movements AS (
      SELECT m.*,a.name AS account_name,p.name AS party_name,s.party_id,u.name AS actor_name,
        EXISTS(SELECT 1 FROM procurement_movements x WHERE x.org_id=m.org_id AND x.reversal_of=m.id) AS reversed
      FROM procurement_movements m
      JOIN procurement_accounts a ON a.org_id=m.org_id AND a.id=m.account_id
      LEFT JOIN procurement_settlements s ON s.org_id=m.org_id AND s.id=m.settlement_id
      LEFT JOIN procurement_parties p ON p.org_id=s.org_id AND p.id=s.party_id
      LEFT JOIN users u ON u.org_id=m.org_id AND u.id=m.actor_id
      WHERE m.org_id=?
    )`,from:'movements r',where:[],args:[orgId],order:ordered('r.event_date',input),
  };
  if (input.partyId) restrict(query, 'r.party_id=?', input.partyId);
  if (input.accountId) restrict(query, 'r.account_id=?', input.accountId);
  if (input.kind) restrict(query, 'r.kind=?', input.kind);
  period(query, input, 'r.event_date');
  if (input.state || input.categoryId || input.centerId || input.nature) {
    const nested = settlements(orgId, filters.parse({
      state:input.state, categoryId:input.categoryId, centerId:input.centerId, nature:input.nature,
    }));
    restrict(query, `r.settlement_id IN (${nested.with} SELECT r.id FROM ${nested.from}${where(nested)})`, ...nested.args);
  }
  search(query, input, ['r.account_name','r.party_name','r.reference']);
  return query;
}

function accounts(orgId: string, input: Filters): Query {
  const query: Query = {
    with: `WITH account_movements AS (
      SELECT m.org_id,m.account_id,m.kind,m.amount_pyg,m.event_date
      FROM procurement_movements m
      LEFT JOIN procurement_movements reversal ON reversal.org_id=m.org_id AND reversal.reversal_of=m.id
      LEFT JOIN procurement_movements original ON original.org_id=m.org_id AND original.id=m.reversal_of
      WHERE m.org_id=? AND (m.kind<>'OPENING' OR reversal.id IS NULL)
        AND (original.kind IS NULL OR original.kind<>'OPENING')
    ), accounts AS (
      SELECT a.*,
        MAX(CASE WHEN m.kind='OPENING' THEN m.event_date END) AS opening_date,
        SUM(CASE WHEN m.kind='OPENING' THEN m.amount_pyg END) AS opening_pyg,
        COALESCE(SUM(CASE WHEN m.kind<>'OPENING' THEN m.amount_pyg END),0) AS movement_pyg,
        COALESCE(SUM(m.amount_pyg),0) AS signed_total_pyg
      FROM procurement_accounts a LEFT JOIN account_movements m ON m.org_id=a.org_id AND m.account_id=a.id
      WHERE a.org_id=? GROUP BY a.org_id,a.id,a.name,a.kind
    )`,from:'accounts r',where:[],args:[orgId,orgId],order:'r.name,r.id',
  };
  if (input.accountId) restrict(query, 'r.id=?', input.accountId);
  if (input.kind) restrict(query, 'r.kind=?', input.kind);
  search(query, input, ['r.name']);
  return query;
}

function budgets(orgId: string, today: string, input: Filters): Query {
  const active = input.month ?? (!input.from && !input.to ? today.slice(0,7) : undefined);
  const source = documents(orgId, today, {...input,month:active}, 'expenses');
  const defined: Query = {from:'',where:['b.org_id=?'],args:[orgId],order:''};
  if (active) restrict(defined, 'b.month=?', active);
  if (input.from) restrict(defined, 'b.month>=?', input.from.slice(0,7));
  if (input.to) restrict(defined, 'b.month<=?', input.to.slice(0,7));
  const activeSql = active
    ? 'UNION SELECT id,CAST(? AS TEXT) AS month FROM procurement_categories WHERE org_id=?'
    : '';
  const query: Query = {
    with: `${source.with},execution AS (
      SELECT r.category_id,SUBSTR(r.document_date,1,7) AS month,SUM(r.total_pyg) AS executed_pyg
      FROM ${source.from}${where(source)} GROUP BY r.category_id,SUBSTR(r.document_date,1,7)
    ),defined AS (
      SELECT b.category_id,b.month,b.amount_pyg FROM procurement_budgets b${where(defined)}
    ),category_months AS (
      SELECT category_id,month FROM defined
      UNION SELECT category_id,month FROM execution
      ${activeSql}
    ),budgets AS (
      SELECT COALESCE(t.category_id,'unclassified') || ':' || t.month AS id,
        t.category_id,COALESCE(c.name,'Sin clasificar') AS category_name,t.month,
        b.amount_pyg AS budget_pyg,COALESCE(e.executed_pyg,0) AS executed_pyg,
        b.amount_pyg-COALESCE(e.executed_pyg,0) AS remaining_pyg
      FROM category_months t
      LEFT JOIN procurement_categories c ON c.org_id=? AND c.id=t.category_id
      LEFT JOIN defined b ON b.category_id=t.category_id AND b.month=t.month
      LEFT JOIN execution e ON (e.category_id=t.category_id OR (e.category_id IS NULL AND t.category_id IS NULL)) AND e.month=t.month
    )`,
    from:'budgets r', where:[], args:[...source.args,...defined.args,...(active ? [active,orgId] : []),orgId],
    order:`r.month ${input.sort === 'asc' ? 'ASC' : 'DESC'}, r.category_name, r.id`,
  };
  category(query, input, 'r.category_id');
  search(query, input, ['r.category_name']);
  return query;
}

const moneyKeys = ['totalPyg','vatPyg','netPyg','paidPyg','creditPyg','appliedPyg','balancePyg','amountPyg',
  'availablePyg','openingPyg','movementPyg','signedTotalPyg','budgetPyg','executedPyg','remainingPyg'];

function integer(value: unknown): number {
  const parsed = Number(value);
  ensure(Number.isSafeInteger(parsed), 'VALIDATION_ERROR', 'El importe total supera el rango admitido.', 422);
  return parsed;
}

function readRow(raw: Row) {
  const {org_id: _org, ...rest} = raw;
  const row = camel(rest);
  for (const key of moneyKeys) if (row[key] !== null && row[key] !== undefined) row[key] = integer(row[key]);
  if ('active' in row) row.active = Boolean(row.active);
  if ('reversed' in row) row.reversed = Boolean(row.reversed);
  if ('openingPyg' in row) row.hasOpening = row.openingPyg !== null;
  return row;
}

function select(query: Query) {
  return `${query.with ?? ''} SELECT r.* FROM ${query.from}${where(query)}`;
}

async function page(store: Database, query: Query, input: Filters) {
  const rows = await store.all(`${select(query)} ORDER BY ${query.order} LIMIT ? OFFSET ?`,
    ...query.args,input.limit+1,input.offset);
  return {items:rows.slice(0,input.limit).map(readRow),hasMore:rows.length>input.limit,limit:input.limit,offset:input.offset};
}

type Collection = 'parties'|'documents'|'settlements'|'payables'|'accounts'|'categories'|'centers'|'budgets'|'movements';
type Subject = 'documents'|'settlements';
type DetailCollection = 'parties'|'accounts'|'movements'|Subject;
type Detail = Row & {events:Row[]};

const measure: Record<View,string> = {
  documents:'total_pyg', expenses:'total_pyg', payments:'amount_pyg', payables:'balance_pyg', overdue:'balance_pyg',
  advances:'available_pyg', assets:'total_pyg', movements:'amount_pyg', budgets:'executed_pyg',
};
const documentColumns = ['id','documentDate','partyName','reference','description','nature','categoryName','centerName',
  'totalPyg','vatPyg','netPyg','paidPyg','creditPyg','balancePyg','dueDate','state'];
const settlementColumns = ['id','eventDate','partyName','kind','method','accountName','reference','description','amountPyg',
  'availablePyg','appliedPyg','state','actorName'];
const movementColumns = ['id','eventDate','accountName','partyName','kind','reference','amountPyg','settlementId','transferId','reversalOf','actorName'];
const exportFields: Record<View,string[]> = {
  documents:documentColumns, expenses:documentColumns, payments:settlementColumns, payables:documentColumns, overdue:documentColumns,
  advances:settlementColumns, assets:documentColumns, movements:movementColumns,
  budgets:['month','categoryName','budgetPyg','executedPyg','remainingPyg'],
};
const subjectInfo = {
  documents: {field:'document_id',label:'Documento'},
  settlements: {field:'settlement_id',label:'Pago, anticipo o nota de crédito'},
} as const;

const maxAttachment = 5 * 1024 * 1024;
const attachmentInput = z.object({
  commandId:id,
  filename:z.string().trim().min(1).max(180).refine(value=>!/[\\/\x00-\x1F\x7F]/.test(value),'Nombre de archivo inválido.'),
  mimeType:z.enum(['application/pdf','image/jpeg','image/png','image/webp']),
  dataBase64:z.string().min(4).max(Math.ceil(maxAttachment/3)*4).regex(/^[A-Za-z0-9+/]+={0,2}$/,'Archivo inválido.'),
}).strict();

function validateAttachment(input: z.infer<typeof attachmentInput>) {
  const data = Buffer.from(input.dataBase64,'base64');
  ensure(data.toString('base64')===input.dataBase64 && data.length<=maxAttachment,
    'VALIDATION_ERROR','El archivo es inválido o supera 5 MB.',400);
  const signatures: Record<typeof input.mimeType, boolean> = {
    'application/pdf': /^%PDF-[12]\.\d/.test(data.subarray(0,8).toString('latin1'))
      && /%%EOF\s*$/.test(data.subarray(-1024).toString('latin1')),
    'image/jpeg': data.length>=4 && data.subarray(0,3).equals(Buffer.from([0xff,0xd8,0xff])),
    'image/png': data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
    'image/webp': data.toString('latin1',0,4)==='RIFF' && data.toString('latin1',8,12)==='WEBP',
  };
  ensure(signatures[input.mimeType], 'VALIDATION_ERROR', 'El contenido no corresponde al tipo de archivo.', 400);
  return data;
}

export class ProcurementReads {
  private store: Database;
  private clock: () => Date;
  constructor(store: Database, clock: () => Date = () => new Date()) {
    this.store = store;
    this.clock = clock;
  }

  private async today(actor: Actor) {
    const organization = await this.store.one('SELECT timezone FROM organizations WHERE id=?',actor.orgId);
    ensure(organization,'FORBIDDEN','Tu sesión no tiene una organización disponible.',403);
    return new Intl.DateTimeFormat('en-CA',{timeZone:organization.timezone,year:'numeric',month:'2-digit',day:'2-digit'})
      .format(this.clock());
  }

  private async reportQuery(actor: Actor, input: Filters): Promise<Query> {
    if (input.view === 'movements') return movements(actor.orgId,input);
    if (input.view === 'payments' || input.view === 'advances') return settlements(actor.orgId,input,input.view);
    const today = await this.today(actor);
    if (input.view === 'budgets') return budgets(actor.orgId,today,input);
    return documents(actor.orgId,today,input,input.view);
  }

  async list(actor: Actor, collection: Collection, raw: unknown) {
    authorize(actor,['ADMIN']);
    const input = filters.parse(raw);
    const {orgId} = actor;
    switch (collection) {
      case 'documents': return page(this.store,documents(orgId,await this.today(actor),input),input);
      case 'payables': return page(this.store,documents(orgId,await this.today(actor),input,'payables'),input);
      case 'settlements': return page(this.store,settlements(orgId,input),input);
      case 'accounts': return page(this.store,accounts(orgId,input),input);
      case 'movements': return page(this.store,movements(orgId,input),input);
      case 'budgets': return page(this.store,budgets(orgId,await this.today(actor),input),input);
      default: {
        const query: Query = {from:`procurement_${collection} r`,where:['r.org_id=?'],args:[orgId],order:'r.name,r.id'};
        if (collection === 'parties') {
          if (input.partyId) restrict(query,'r.id=?',input.partyId);
          if (input.kind) restrict(query,'r.kind=?',input.kind);
          if (input.state === 'ACTIVE' || input.state === 'INACTIVE') restrict(query,'r.active=?',Number(input.state==='ACTIVE'));
          search(query,input,['r.name','r.ruc','r.contact']);
        } else search(query,input,['r.name']);
        return page(this.store,query,input);
      }
    }
  }

  async confirmedDocuments(actor: Actor, from?: string, to?: string) {
    authorize(actor,['ADMIN']);
    const query=documents(actor.orgId,await this.today(actor),filters.parse({from,to}));
    return (await this.store.all(select(query),...query.args)).map(readRow);
  }

  async report(actor: Actor, raw: unknown) {
    authorize(actor,['ADMIN']);
    const input = filters.parse(raw);
    const query = await this.reportQuery(actor,input);
    const sql = `${query.with ? query.with+', ' : 'WITH '} matching AS (
      SELECT r.* FROM ${query.from}${where(query)}
    ), totals AS (
      SELECT COUNT(*) AS match_count,COALESCE(SUM(${measure[input.view]}),0) AS report_total
      ${input.view==='budgets' ? ',SUM(budget_pyg) AS report_budget, COUNT(budget_pyg) AS budget_count' : ''}
      FROM matching
    ), paged AS (
      SELECT r.* FROM matching r ORDER BY ${query.order} LIMIT ? OFFSET ?
    ) SELECT r.*,t.* FROM totals t LEFT JOIN paged r ON 1=1 ORDER BY ${query.order}`;
    const found = await this.store.all(sql,...query.args,input.limit,input.offset);
    const total = integer(found[0].report_total);
    const count = integer(found[0].match_count);
    const budgetTotal = found[0].report_budget;
    const items = found.filter(row=>row.id!==null).map(({match_count,report_total,report_budget,budget_count,...row})=>readRow(row));
    return {items,total,totalPyg:total,count,hasMore:input.offset+items.length<count,limit:input.limit,offset:input.offset,
      ...(input.view==='budgets' ? {budgetTotalPyg:budgetTotal===null ? null : integer(budgetTotal),
        budgetCount:integer(found[0].budget_count)} : {})};
  }

  async export(actor: Actor, raw: unknown) {
    authorize(actor,['ADMIN']);
    const input = filters.parse(raw);
    const query = await this.reportQuery(actor,input);
    const rows = await this.store.all(`${select(query)} ORDER BY ${query.order}`,...query.args);
    const fields = exportFields[input.view];
    return encodeCsv([fields,...rows.map(raw=>{const row=readRow(raw);return fields.map(field=>row[field]);})]);
  }

  private events(actor: Actor, subjectId: string) {
    return this.store.all(`SELECT e.*,u.name AS actor_name FROM procurement_events e
      LEFT JOIN users u ON u.org_id=e.org_id AND u.id=e.actor_id
      WHERE e.org_id=? AND e.subject_id=? ORDER BY e.created_at DESC,e.id`,actor.orgId,subjectId);
  }

  async detail(actor: Actor, collection: Subject, rawId: unknown): Promise<Detail & {applications:Row[];attachments:Row[];lines?:Row[]}>;
  async detail(actor: Actor, collection: DetailCollection, rawId: unknown): Promise<Detail>;
  async detail(actor: Actor, collection: DetailCollection, rawId: unknown): Promise<Detail> {
    authorize(actor,['ADMIN']);
    const subjectId = id.parse(rawId);
    const {orgId} = actor;
    const input = filters.parse({});
    if (collection === 'parties') {
      const row = await this.store.one('SELECT * FROM procurement_parties WHERE org_id=? AND id=?',orgId,subjectId);
      ensure(row,'NOT_FOUND','Contraparte no encontrada.',404);
      const [documentPage, settlementPage, debt, available, events] = await Promise.all([
        this.list(actor,'documents',{partyId:subjectId}),
        this.list(actor,'settlements',{partyId:subjectId}),
        this.report(actor,{partyId:subjectId,view:'payables',limit:1}),
        this.report(actor,{partyId:subjectId,view:'advances',limit:1}),
        this.events(actor,subjectId),
      ]);
      return {...readRow(row),documents:documentPage.items,settlements:settlementPage.items,events:events.map(readRow),
        balancePyg:debt.total,availableAdvancePyg:available.total};
    }
    if (collection === 'accounts') {
      const query = accounts(orgId, {...input,accountId:subjectId});
      const row = await this.store.one(select(query),...query.args);
      ensure(row,'NOT_FOUND','Cuenta no encontrada.',404);
      const [movementPage,events] = await Promise.all([
        this.list(actor,'movements',{accountId:subjectId}),this.events(actor,subjectId),
      ]);
      return {...readRow(row),movements:movementPage.items,events:events.map(readRow)};
    }
    if (collection === 'movements') {
      const query = movements(orgId,input);
      restrict(query,'r.id=?',subjectId);
      const row = await this.store.one(select(query),...query.args);
      ensure(row,'NOT_FOUND','Movimiento no encontrado.',404);
      const [related,events] = await Promise.all([
        this.store.all(`SELECT id,account_id,kind,amount_pyg,event_date,reversal_of FROM procurement_movements
          WHERE org_id=? AND id<>? AND (transfer_id=? OR reversal_of=? OR id=?) ORDER BY created_at,id`,
        orgId,subjectId,row.transfer_id,subjectId,row.reversal_of),
        this.events(actor,subjectId),
      ]);
      return {...readRow(row),related:related.map(readRow),events:events.map(readRow)};
    }
    const query = collection==='documents' ? documents(orgId,await this.today(actor),input) : settlements(orgId,input);
    restrict(query,'r.id=?',subjectId);
    const row = await this.store.one(select(query),...query.args);
    const {field,label} = subjectInfo[collection];
    ensure(row,'NOT_FOUND',`${label}: registro inexistente.`,404);
    const [applications, attachments, events, lines] = await Promise.all([
      this.store.all(`SELECT a.*,d.reference AS document_reference,d.description AS document_description,
        s.reference AS settlement_reference,s.kind AS settlement_kind,s.event_date AS settlement_date,u.name AS actor_name
        FROM procurement_applications a
        JOIN procurement_documents d ON d.org_id=a.org_id AND d.id=a.document_id
        JOIN procurement_settlements s ON s.org_id=a.org_id AND s.id=a.settlement_id
        LEFT JOIN users u ON u.org_id=a.org_id AND u.id=a.actor_id
        WHERE a.org_id=? AND a.${field}=? ORDER BY a.created_at,a.id`,orgId,subjectId),
      this.store.all(`SELECT id,filename,mime_type AS mime,size_bytes,created_at,actor_id
        FROM procurement_attachments WHERE org_id=? AND ${field}=? ORDER BY created_at DESC,id`,orgId,subjectId),
      this.events(actor,subjectId),
      collection==='documents' ? this.store.all('SELECT * FROM procurement_lines WHERE org_id=? AND document_id=? ORDER BY position',orgId,subjectId) : [],
    ]);
    return {...readRow(row),applications:applications.map(readRow),attachments:attachments.map(readRow),events:events.map(readRow),
      ...(collection==='documents' ? {lines:lines.map(readRow)} : {})};
  }

  async upload(actor: Actor, collection: Subject, rawId: unknown, raw: unknown) {
    authorize(actor,['ADMIN']);
    const subjectId = id.parse(rawId);
    const input = attachmentInput.parse(raw);
    const data = validateAttachment(input);
    const sha256 = hash(data);
    const {commandId,filename,mimeType} = input;
    const {field,label} = subjectInfo[collection];
    return new Logistics(this.store).command(actor,`procurement.${collection}.${subjectId}.attach`,{commandId,filename,mimeType,sha256},['ADMIN'],async()=>{
      const subject = await this.store.one(`SELECT id FROM procurement_${collection} WHERE org_id=? AND id=?`,actor.orgId,subjectId);
      ensure(subject,'NOT_FOUND',`${label}: registro inexistente.`,404);
      const previous = await this.store.one(`SELECT id FROM procurement_attachments WHERE org_id=? AND ${field}=? AND sha256=?`,
        actor.orgId,subjectId,sha256);
      if (previous) return {id:previous.id};
      const attachmentId=randomUUID(), now=this.clock().toISOString();
      await this.store.run(`INSERT INTO procurement_attachments
        (org_id,id,document_id,settlement_id,actor_id,filename,mime_type,data,sha256,size_bytes,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`,actor.orgId,attachmentId,collection==='documents'?subjectId:null,
        collection==='settlements'?subjectId:null,actor.id,filename,mimeType,data,sha256,data.length,now);
      await this.store.run(`INSERT INTO procurement_events(org_id,id,subject_id,action,actor_id,reason,created_at)
        VALUES(?,?,?,'ATTACH',?,NULL,?)`,actor.orgId,randomUUID(),subjectId,actor.id,now);
      return {id:attachmentId};
    });
  }

  async download(actor: Actor, rawId: unknown) {
    authorize(actor,['ADMIN']);
    const row = await this.store.one('SELECT filename,mime_type,data FROM procurement_attachments WHERE org_id=? AND id=?',
      actor.orgId,id.parse(rawId));
    ensure(row,'NOT_FOUND','Adjunto no encontrado.',404);
    return {filename:String(row.filename),mime:String(row.mime_type),data:Buffer.from(row.data)};
  }
}

function privateResponse(res: Response) {
  return res.set({'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
}

export function installProcurementReadRoutes(app: Express, store: Database, auth: (req: Request)=>Promise<Actor>) {
  const service = new ProcurementReads(store);
  const base = '/api/procurement';
  for (const collection of ['parties','documents','settlements','payables','accounts','categories','centers','budgets','movements'] as const) {
    app.get(`${base}/${collection}`,async(req,res)=>privateResponse(res).json(await service.list(await auth(req),collection,req.query)));
  }
  for (const collection of ['parties','documents','settlements','accounts','movements'] as const) {
    app.get(`${base}/${collection}/:id`,async(req,res)=>privateResponse(res).json(await service.detail(await auth(req),collection,req.params.id)));
  }
  for (const collection of ['documents','settlements'] as const) {
    app.post(`${base}/${collection}/:id/attachments`,async(req,res)=>
      privateResponse(res).status(201).json(await service.upload(await auth(req),collection,req.params.id,req.body)));
  }
  app.get(`${base}/reports`,async(req,res)=>privateResponse(res).json(await service.report(await auth(req),req.query)));
  app.get(`${base}/export.csv`,async(req,res)=>{
    const csv = await service.export(await auth(req),req.query);
    privateResponse(res).attachment('nexora-proveedores-gastos.csv').type('text/csv').send(csv);
  });
  app.get(`${base}/attachments/:id`,async(req,res)=>{
    const attachment = await service.download(await auth(req),req.params.id);
    privateResponse(res).attachment(attachment.filename).type(attachment.mime).send(attachment.data);
  });
}
