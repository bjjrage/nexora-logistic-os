import { randomUUID } from 'node:crypto';
import type { Express, Request } from 'express';
import { z } from 'zod';
import { authorize, hash, type Actor } from './auth.ts';
import type { Database, Row, SqlValue } from './database.ts';
import { Logistics } from './domain.ts';
import { ensure } from './errors.ts';
import type { Procurement } from './procurement.ts';
import { maxWorkbookBytes, parseProcurementWorkbook, workbookFamily, type HistoricalRow } from './procurement-workbook.ts';
import {applyImportedPayments,paymentKey,paymentPartyLookup} from './procurement-import-payments.ts';
import { dimensions, matchesSourceScope, registryDimensions, setupPlan, sourceIncluded, sourceKey, sourceScopes, sourceSuppliers, sourceValue, summarizeSource, type Source, type SourceRow } from './procurement-source.ts';

const fileInput = z.object({
  filename: z.string().trim().min(6).max(200).regex(/^[^\\/\u0000-\u001f\u007f]+\.xlsx$/i),
  contentBase64: z.string().min(4).max(Math.ceil(maxWorkbookBytes / 3) * 4),
  mode: z.enum(['append','replace']).optional(), replaceBatchId:z.uuid().optional(),
}).strict().refine(input=>(input.mode==='replace')===Boolean(input.replaceBatchId));
const resolution = z.discriminatedUnion('action', [
  z.object({ action: z.literal('SKIP'), commandId: z.uuid(), reason: z.string().trim().min(1).max(500) }).strict(),
  z.object({ action: z.literal('PROMOTE'), commandId: z.uuid(), reason: z.string().trim().min(1).max(500),
    acknowledgePrior: z.boolean().optional(),
    operation: z.discriminatedUnion('action', [
      z.looseObject({ action: z.literal('DOCUMENT'), lines: z.array(z.looseObject({ totalPyg: z.number().int().positive() })).min(1).max(200), payment: z.unknown().optional() }),
      z.looseObject({ action: z.literal('SETTLEMENT'), amountPyg: z.number().int().positive(), kind: z.enum(['PAYMENT', 'ADVANCE', 'CREDIT']) }),
    ]),
  }).strict(),
]);

type State = 'PENDING' | 'PROMOTED' | 'SKIPPED';
type Prior = { type: 'UNCHANGED' | 'POSSIBLE_MATCH' | 'CHANGED'; batchId: string; rowId: string; rowNumber: number;
  state: State; receiptMatched: boolean; operationId: string | null };
type Comparison = { rowNumber: number; normalized: HistoricalRow; fingerprint: string; matchKey: string | null; receiptKey: string | null };

function batchView(row: Row) {
  return { id: row.id, filename: row.filename, sha256: row.sha256, sheet: row.sheet,
    createdAt: row.created_at, createdBy: row.created_by, summary: JSON.parse(row.summary_json),
  };
}

function rowView(row: Row) {
  return { id: row.id, rowNumber: row.row_number, normalized: JSON.parse(row.normalized_json),
    issues: JSON.parse(row.issues_json), prior: JSON.parse(row.prior_json) as Prior[], state: row.state,
    outcome: row.outcome_json ? JSON.parse(row.outcome_json) : null, resolutionReason: row.resolution_reason,
    resolvedAt: row.resolved_at, resolvedBy: row.resolved_by,
  };
}

function compareRows(current: Comparison, previous: Row, sourceKey: string): Prior | null {
  const receiptMatched = current.receiptKey !== null && current.receiptKey === previous.receipt_key;
  let type: Prior['type'];
  if (previous.fingerprint === current.fingerprint) type = 'UNCHANGED';
  else if (receiptMatched) type = 'CHANGED';
  else if (current.matchKey && current.matchKey === previous.match_key) type = 'POSSIBLE_MATCH';
  else if (sourceKey === previous.source_key && current.rowNumber === previous.row_number) {
    const newer = current.normalized, older = JSON.parse(previous.normalized_json) as HistoricalRow;
    const supplier = newer.taxId && older.taxId ? newer.taxId === older.taxId : Boolean(newer.supplier && newer.supplier === older.supplier);
    const anchors = [supplier, newer.description && newer.description === older.description,
      newer.date && newer.date === older.date, newer.totalPyg !== null && newer.totalPyg === older.totalPyg,
      newer.documentNumber && newer.documentNumber === older.documentNumber];
    if (anchors.filter(Boolean).length < 2) return null;
    type = 'CHANGED';
  } else return null;
  return { type, batchId: previous.batch_id, rowId: previous.id, rowNumber: previous.row_number, state: previous.state,
    receiptMatched, operationId: previous.outcome_json ? JSON.parse(previous.outcome_json).operationId : null };
}

function rankPrior(left: Prior, right: Prior) {
  const priority = (item: Prior) => (item.state === 'PROMOTED' ? 0 : 3) + ['UNCHANGED', 'CHANGED', 'POSSIBLE_MATCH'].indexOf(item.type);
  return priority(left) - priority(right);
}

export class ProcurementImport {
  private store: Database;
  private procurement: Pick<Procurement, 'execute'>;
  private logistics: Logistics;
  constructor(store: Database, procurement: Pick<Procurement, 'execute'>) {
    this.store = store;
    this.procurement = procurement;
    this.logistics = new Logistics(store);
  }

  private async batch(actor: Actor, id: string) {
    const result = await this.store.one(`SELECT id,filename,sha256,sheet,source_key,created_at,created_by,summary_json
      FROM procurement_import_batches WHERE org_id=? AND id=?`, actor.orgId, z.uuid().parse(id));
    ensure(result, 'NOT_FOUND', 'Lote no encontrado.', 404);
    return result;
  }

  private async row(actor: Actor, batchId: string, id: string) {
    const result = await this.store.one('SELECT * FROM procurement_import_rows WHERE org_id=? AND batch_id=? AND id=?', actor.orgId, batchId, z.uuid().parse(id));
    ensure(result, 'NOT_FOUND', 'Fila no encontrada.', 404);
    return result;
  }

  async list(actor: Actor, query: unknown = {}) {
    authorize(actor, ['ADMIN']);
    const { limit, offset } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25),
      offset: z.coerce.number().int().min(0).max(1_000_000).default(0), }).strict().parse(query);
    const rows = await this.store.all(`SELECT id,filename,sha256,sheet,created_at,created_by,summary_json
      FROM procurement_import_batches WHERE org_id=? ORDER BY created_at DESC,id LIMIT ? OFFSET ?`, actor.orgId, limit + 1, offset);
    return { items: rows.slice(0, limit).map(batchView), hasMore: rows.length > limit, limit, offset };
  }

  private async activeRow(actor: Actor, family?: string) {
    const activated = await this.store.one(`SELECT b.id,b.filename,b.sha256,b.sheet,b.source_key,b.created_at,b.created_by,b.summary_json,e.created_at AS activated_at
      FROM procurement_events e JOIN procurement_import_batches b ON b.org_id=e.org_id AND b.id=e.subject_id
      WHERE e.org_id=? AND e.action='IMPORT_ACTIVATE' ${family===undefined?'':'AND b.source_key=?'}
      ORDER BY e.created_at DESC,e.id DESC LIMIT 1`,actor.orgId,...(family===undefined?[]:[family]));
    if(family!==undefined)return activated;
    return activated ?? this.store.one(`SELECT id,filename,sha256,sheet,source_key,created_at,created_by,summary_json
      FROM procurement_import_batches WHERE org_id=? ORDER BY created_at DESC,id DESC LIMIT 1`,actor.orgId);
  }

  async active(actor: Actor) {
    authorize(actor,['ADMIN']);
    const row=await this.activeRow(actor);
    return {batch:row?batchView(row):null};
  }

  private async markActive(actor: Actor, id: string, previous?: Row) {
    const last=Date.parse(previous?.activated_at ?? '') || 0;
    const time=new Date(Math.max(Date.now(),last+1)).toISOString();
    await this.store.run(`INSERT INTO procurement_events(org_id,id,subject_id,action,actor_id,reason,created_at)
      VALUES(?,?,?,?,?,?,?)`,actor.orgId,randomUUID(),id,'IMPORT_ACTIVATE',actor.id,'Versión visible en el control de gastos',time);
  }

  async activate(actor: Actor, id: string, raw: unknown) {
    authorize(actor,['ADMIN']);
    const input=z.strictObject({commandId:z.uuid()}).parse(raw);
    return this.logistics.command(actor,'procurement.import.activate.'+z.uuid().parse(id),input,['ADMIN'],async()=>{
      const batch=await this.batch(actor,id),previous=await this.activeRow(actor);
      const rows=await this.sourceRows(actor,batch);
      await this.connectSuppliers(actor,rows);
      await applyImportedPayments(this.store,this.procurement,actor,batch.id);
      if(batch.id!==(await this.activeRow(actor,batch.source_key))?.id)await this.markActive(actor,batch.id,previous);
      return {id:batch.id};
    });
  }

  async detail(actor: Actor, id: string, query: unknown = {}) {
    authorize(actor, ['ADMIN']);
    const { limit, offset, state, group, key, month, from, before, dateFrom, to, scope, q, ...criteria } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).max(1_000_000).default(0), state: z.enum(['PENDING','PROMOTED','SKIPPED']).optional(),
      group:z.enum(dimensions).optional(),key:z.string().max(10000).optional(),
      month:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),from:z.iso.date().optional(),before:z.iso.date().optional(),scope:z.enum(sourceScopes).optional(),
      dateFrom:z.iso.date().optional(),to:z.iso.date().optional(),q:z.string().trim().min(1).max(200).optional(),
      supplier:z.string().max(10000).optional(),category:z.string().max(10000).optional(),
      costCenter:z.string().max(10000).optional(),historicalStatus:z.string().max(10000).optional(),
    }).strict().refine(value=>Boolean(value.group)===(value.key!==undefined)).parse(query);
    const batch = await this.batch(actor, id);
    const active = (await this.activeRow(actor,batch.source_key)) ?? await this.activeRow(actor);
    const included=active?.id===batch.id;
    const fold = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
    const search = q ? fold(q) : undefined;
    if (group || month || from || before || dateFrom || to || scope || search || Object.values(criteria).some(value=>value!==undefined)) {
      const candidates = await this.store.all('SELECT id,row_number,normalized_json,issues_json,prior_json,state,outcome_json,resolution_reason,resolved_at,resolved_by FROM procurement_import_rows WHERE org_id=? AND batch_id=? ORDER BY row_number', actor.orgId, batch.id);
      const matching = candidates.filter(row => {
        if (state && row.state!==state) return false;
        const normalized = JSON.parse(row.normalized_json) as HistoricalRow;
        if (scope && !matchesSourceScope(normalized,scope)) return false;
        if (month && (!normalized.date?.startsWith(month) || !sourceIncluded(normalized))) return false;
        if ((from || before) && (!normalized.date || (from && normalized.date<from) ||
          (before && normalized.date>=before) || !sourceIncluded(normalized))) return false;
        if ((dateFrom || to) && (!normalized.date || (dateFrom && normalized.date<dateFrom) || (to && normalized.date>to))) return false;
        if (registryDimensions.some(dimension=>criteria[dimension]!==undefined && criteria[dimension]!==sourceKey(normalized[dimension]))) return false;
        if (search && ![normalized.supplier,normalized.taxId,normalized.description,normalized.documentNumber]
          .some(value=>value && fold(value).includes(search))) return false;
        if (!group) return true;
        if (!sourceIncluded(normalized,group)) return false;
        const candidate = sourceKey(sourceValue(normalized,group));
        return (month || from || before) && group==='category' ? candidate.trim().normalize('NFC').toLowerCase()===key?.trim().normalize('NFC').toLowerCase() : candidate===key;
      });
      return {...batchView(batch),included,rows:matching.slice(offset,offset+limit).map(rowView),hasMore:matching.length>offset+limit,limit,offset};
    }
    const rows = await this.store.all(`SELECT r.id,r.row_number,r.normalized_json,r.issues_json,r.prior_json,r.state,r.outcome_json,
      r.resolution_reason,r.resolved_at,r.resolved_by FROM procurement_import_rows r WHERE r.org_id=? AND r.batch_id=?
      ${state ? 'AND r.state=?' : ''} ORDER BY r.row_number LIMIT ? OFFSET ?`, actor.orgId, batch.id, ...(state ? [state] : []), limit + 1, offset);
    return { ...batchView(batch),included, rows: rows.slice(0, limit).map(rowView), hasMore: rows.length > limit, limit, offset };
  }

  private async source(actor: Actor, batch: Row) {
    const saved = JSON.parse(batch.summary_json) as Source;
    if (saved.parameterLayoutVersion===2 && Array.isArray(saved.controls)) return saved;
    const {bytes} = await this.original(actor,batch.id);
    return parseProcurementWorkbook(bytes).summary;
  }

  private async sourceRows(actor: Actor, batch: Row): Promise<SourceRow[]> {
    const rows = await this.store.all(`SELECT normalized_json,state,issues_json,outcome_json
      FROM procurement_import_rows WHERE org_id=? AND batch_id=? ORDER BY row_number`,actor.orgId,batch.id);
    return rows.map(row=>({normalized:JSON.parse(row.normalized_json),state:row.state,issues:JSON.parse(row.issues_json),
      operationId:row.outcome_json?JSON.parse(row.outcome_json).operationId:undefined}));
  }

  private async storedParties(actor: Actor) {
    const rows=await this.store.all('SELECT id,name,ruc,active FROM procurement_parties WHERE org_id=?',actor.orgId);
    return rows.map(row=>({id:row.id,name:row.name,ruc:row.ruc,active:row.active}));
  }

  private async createSuppliers(actor: Actor, parties: ReturnType<typeof sourceSuppliers>['parties']) {
    for (const party of parties) {
      await this.procurement.execute(actor,{
        commandId:randomUUID(),action:'PARTY',name:party.name,ruc:party.ruc ?? undefined,kind:'SUPPLIER',active:true,
      });
    }
  }

  private async connectSuppliers(actor: Actor, rows: SourceRow[]) {
    const {parties} = sourceSuppliers(rows,await this.storedParties(actor));
    await this.createSuppliers(actor,parties);
  }

  private async plan(actor: Actor, summary: Source, rows: SourceRow[]) {
    const [parties,categories,centers,budgets] = await Promise.all([
      this.storedParties(actor),
      this.store.all('SELECT id,name FROM procurement_categories WHERE org_id=?',actor.orgId),
      this.store.all('SELECT id,name FROM procurement_centers WHERE org_id=?',actor.orgId),
      this.store.all('SELECT category_id,month,amount_pyg FROM procurement_budgets WHERE org_id=? AND month=?',
        actor.orgId,summary.parameters?.budgetMonth ?? ''),
    ]);
    return setupPlan(summary,rows,{
      parties,
      categories:categories.map(r=>({id:r.id,name:r.name})),centers:centers.map(r=>({id:r.id,name:r.name})),
      budgets:budgets.map(r=>({category_id:r.category_id,month:r.month,amount_pyg:r.amount_pyg})),
    });
  }

  private setupEvent(actor: Actor, batch: Row) {
    return this.store.one("SELECT id FROM procurement_events WHERE org_id=? AND subject_id=? AND action='IMPORT_SETUP'",actor.orgId,batch.id);
  }

  async workspace(actor: Actor, id: string) {
    authorize(actor,['ADMIN']);
    const batch = await this.batch(actor,id);
    const [summary,rows,configured] = await Promise.all([
      this.source(actor,batch),this.sourceRows(actor,batch),this.setupEvent(actor,batch),
    ]);
    const budgetSources=summary.parameters?.budgets ?? [];
    return {...summarizeSource(summary,rows),payments:this.paymentCounts(rows),setup:await this.plan(actor,summary,rows),configured:Boolean(configured),
      source:{sha256:batch.sha256,definedBudgets:budgetSources.filter(item=>item.amountPyg!==null).length,
        unreadableBudgets:summary.parameters?.issues.filter(issue=>issue.code==='INVALID_PARAMETER_BUDGET').length??0}};

  }

  private paymentCounts(rows: SourceRow[]) {
    const payments=rows.filter(row=>Boolean(row.normalized.payment));
    return {total:payments.length,registered:new Set(payments.filter(row=>row.state==='PROMOTED').flatMap(row=>row.operationId??[])).size,
      pending:payments.filter(row=>row.state==='PENDING').length};
  }

  async applySetup(actor: Actor, id: string, raw: unknown) {
    authorize(actor,['ADMIN']);
    const input = z.strictObject({commandId:z.uuid(),digest:z.string().regex(/^[\da-f]{64}$/)}).parse(raw);
    return this.logistics.command(actor,'procurement.import.setup.'+z.uuid().parse(id),input,['ADMIN'],async()=>{
      const batch=await this.batch(actor,id);
      const summary=await this.source(actor,batch);
      const plan=await this.plan(actor,summary,await this.sourceRows(actor,batch));
      ensure(plan.digest===input.digest,'IMPORT_SETUP_CHANGED','Cambió la configuración. Actualizá la vista previa y revisá los cambios.',409);
      const exec = (action:string, values:object) => this.procurement.execute(actor,{commandId:randomUUID(),action,...values});
      for (const name of plan.categories) await exec('CATEGORY',{name});
      for (const name of plan.centers) await exec('CENTER',{name});
      await this.createSuppliers(actor,plan.parties);
      const categories = await this.store.all('SELECT id,name FROM procurement_categories WHERE org_id=?',actor.orgId);
      for (const budget of plan.budgets) {
        const category = categories.find(row=>String(row.name).trim().normalize('NFC').toLowerCase()===budget.category.normalize('NFC').toLowerCase());
        ensure(category,'IMPORT_SETUP_CHANGED','Falta una categoría del presupuesto. Revisá las listas del archivo.',409);
        await exec('BUDGET',{categoryId:category.id,month:budget.month,amountPyg:budget.amountPyg});
      }
      if (!await this.setupEvent(actor,batch)) await this.store.run(`INSERT INTO procurement_events(org_id,id,subject_id,action,actor_id,reason,created_at)
        VALUES(?,?,?,?,?,?,?)`,actor.orgId,randomUUID(),batch.id,'IMPORT_SETUP',actor.id,'Configuración confirmada desde el Excel',new Date().toISOString());
      return {id:batch.id,categories:plan.categories.length,centers:plan.centers.length,parties:plan.parties.length,
        budgets:plan.budgets.length,paymentMethods:plan.paymentMethods.length};
    });
  }

  async options(actor: Actor) {
    authorize(actor,['ADMIN']);
    const rows = await this.store.all(`SELECT b.summary_json FROM procurement_import_batches b JOIN procurement_events e
      ON e.org_id=b.org_id AND e.subject_id=b.id AND e.action='IMPORT_SETUP'
      WHERE b.org_id=? ORDER BY e.created_at DESC,e.id`,actor.orgId);
    const methods = new Set<string>();
    for(const row of rows) {
      const summary = JSON.parse(row.summary_json) as Source;
      for (const value of summary.parameters?.lists.paymentMethods ?? []) {
        if (typeof value==='string' && value.trim() && value.trim().length<=60) methods.add(value.trim());
      }
    }
    return {paymentMethods:[...methods].sort((a,b)=>a.localeCompare(b,'es'))};
  }


  async rowDetail(actor: Actor, batchId: string, rowId: string) {
    authorize(actor, ['ADMIN']);
    const batch = await this.batch(actor, batchId);
    const row = await this.row(actor, batch.id, rowId);
    const prior = await this.currentPrior(actor, batch, row);
    return { ...rowView(row), original: JSON.parse(row.original_json), prior: prior.slice(0, 12) };
  }

  private async pendingTransfer(actor: Actor, batchId: string, rowId: string) {
    const batch=await this.batch(actor,batchId);
    const anchor=await this.row(actor,batch.id,rowId);
    const source=JSON.parse(anchor.normalized_json) as HistoricalRow;
    const reference=source.payment?.reference;
    ensure(reference,'VALIDATION_ERROR','La fila no tiene una referencia de pago.',400);
    const posted=anchor.state==='PROMOTED'&&anchor.outcome_json?JSON.parse(anchor.outcome_json):null;
    if(posted?.action==='SETTLEMENT')return {batch,reference,postedId:posted.operationId as string,items:[]};
    ensure(anchor.state==='PENDING','INVALID_TRANSITION','La fila ya fue resuelta.',409);
    const active=(await this.activeRow(actor,batch.source_key))??await this.activeRow(actor);
    ensure(active?.id===batch.id,'INVALID_TRANSITION','La versión de la planilla ya no está en uso.',409);
    const all=await this.store.all(`SELECT id,row_number,normalized_json,original_json,issues_json
      FROM procurement_import_rows WHERE org_id=? AND batch_id=? AND state='PENDING' ORDER BY row_number`,actor.orgId,batch.id);
    const findParty=paymentPartyLookup(await this.storedParties(actor));
    const items=all.flatMap(row=>{
      const normalized=JSON.parse(row.normalized_json) as HistoricalRow;
      const payment=normalized.payment;
      return payment&&paymentKey(payment.reference)===paymentKey(reference)?[{row,normalized,payment,party:findParty(normalized)}]:[];
    });
    const party=items[0]?.party;
    return {batch,reference,postedId:null,items,party:party&&items.every(item=>item.party?.id===party.id)?party:undefined};
  }

  async transferReview(actor: Actor,batchId:string,rowId:string) {
    authorize(actor,['ADMIN']);
    const transfer=await this.pendingTransfer(actor,batchId,rowId);
    return {reference:transfer.reference,settlementId:transfer.postedId,partyId:transfer.party?.id??null,
      partyName:transfer.party?.name??null,rows:transfer.items.map(({row,normalized,payment})=>{
        const original=JSON.parse(row.original_json).invoiceReference;
        const issue=(JSON.parse(row.issues_json) as Array<{code:string;message:string}>)
          .find(item=>item.code==='PAYMENT_GROUP_REVIEW'||item.code==='PAYMENT_REVIEW');
        return {id:row.id,rowNumber:row.row_number,amountPyg:normalized.totalPyg,documentId:payment.invoiceDocumentId??null,
          invoiceReference:payment.invoiceReference,originalInvoice:original?String(original.formatted??original.value??''):null,
          reason:issue?.message??null};
      })};
  }

  async reprocessTransfer(actor: Actor,batchId:string,rowId:string,raw:unknown) {
    authorize(actor,['ADMIN']);
    const input=z.strictObject({commandId:z.uuid(),corrections:z.array(z.strictObject({rowId:z.uuid(),documentId:z.uuid()})).max(100)})
      .refine(value=>new Set(value.corrections.map(item=>item.rowId)).size===value.corrections.length).parse(raw);
    const operation='procurement.import.'+z.uuid().parse(batchId)+'.'+z.uuid().parse(rowId)+'.transfer';
    return this.logistics.command(actor,operation,input,['ADMIN'],async()=>{
      const transfer=await this.pendingTransfer(actor,batchId,rowId);
      if(transfer.postedId)return {id:transfer.postedId,status:'ALREADY_POSTED'};
      const items=new Map(transfer.items.map(item=>[item.row.id,item]));
      for(const correction of input.corrections) {
        const item=items.get(correction.rowId);
        ensure(item&&transfer.party,'VALIDATION_ERROR','La corrección debe corresponder a esta transferencia y a su proveedor.',400);
        const document=await this.store.one(`SELECT id,reference FROM procurement_documents
          WHERE org_id=? AND id=? AND party_id=? AND voided_at IS NULL`,actor.orgId,correction.documentId,transfer.party.id);
        ensure(document,'VALIDATION_ERROR','Seleccioná una factura vigente del proveedor de la transferencia.',400);
        if(item.payment.invoiceDocumentId===document.id)continue;
        const before={reference:item.payment.invoiceReference,documentId:item.payment.invoiceDocumentId??null};
        const after={reference:document.reference,documentId:document.id};
        await this.store.run('UPDATE procurement_import_rows SET normalized_json=? WHERE org_id=? AND batch_id=? AND id=? AND state=\'PENDING\'',
          JSON.stringify({...item.normalized,payment:{...item.payment,invoiceReference:after.reference,invoiceDocumentId:after.documentId}}),
          actor.orgId,transfer.batch.id,item.row.id);
        await this.store.run(`INSERT INTO procurement_events(org_id,id,subject_id,action,actor_id,reason,created_at)
          VALUES(?,?,?,?,?,?,?)`,actor.orgId,randomUUID(),item.row.id,'IMPORT_PAYMENT_INVOICE_CORRECTED',actor.id,
          JSON.stringify({before,after}),new Date().toISOString());
      }
      await applyImportedPayments(this.store,this.procurement,actor,transfer.batch.id,new Set(items.keys()));
      const updated=await this.row(actor,transfer.batch.id,rowId);
      if(updated.state==='PROMOTED')return {id:JSON.parse(updated.outcome_json).operationId,status:'POSTED'};
      const issue=(JSON.parse(updated.issues_json) as Array<{code:string;message:string}>)
        .find(item=>item.code==='PAYMENT_GROUP_REVIEW'||item.code==='PAYMENT_REVIEW');
      return {id:updated.id,status:'PENDING',reason:issue?.message??'Transferencia por revisar.'};
    });
  }

  async original(actor: Actor, id: string) {
    authorize(actor, ['ADMIN']);
    const row = await this.store.one('SELECT filename,original_file FROM procurement_import_batches WHERE org_id=? AND id=?', actor.orgId, z.uuid().parse(id));
    ensure(row, 'NOT_FOUND', 'Lote no encontrado.', 404);
    return { filename: row.filename as string, bytes: Buffer.from(row.original_file) };
  }

  private async candidates(orgId: string, sourceKey: string, rows: Comparison[], excludedBatchId?: string) {
    const result: Row[] = [];
    for (let offset = 0; offset < rows.length; offset += 150) {
      const chunk = rows.slice(offset, offset + 150);
      const sets = [
        ['r.fingerprint', chunk.map(row => row.fingerprint)],
        ['r.match_key', chunk.flatMap(row => row.matchKey ?? [])],
        ['r.receipt_key', chunk.flatMap(row => row.receiptKey ?? [])],
      ] as const;
      const entries = sets.filter(([, values]) => values.length);
      const params: SqlValue[] = [orgId];
      if (excludedBatchId) params.push(excludedBatchId);
      for (const [, values] of entries) params.push(...values);
      params.push(sourceKey, ...chunk.map(row => row.rowNumber));
      const scopes = entries.map(([column, values]) => `${column} IN (${values.map(() => '?').join(',')})`);
      scopes.push(`(b.source_key=? AND r.row_number IN (${chunk.map(() => '?').join(',')}))`);
      const matching = await this.store.all(`SELECT r.id,r.batch_id,r.row_number,r.state,r.outcome_json,r.fingerprint,r.match_key,r.receipt_key,
        r.normalized_json,b.source_key FROM procurement_import_rows r JOIN procurement_import_batches b
        ON b.org_id=r.org_id AND b.id=r.batch_id WHERE r.org_id=? ${excludedBatchId ? 'AND b.id<>?' : ''}
        AND (${scopes.join(' OR ')}) ORDER BY b.created_at DESC,r.row_number,r.id`, ...params);
      result.push(...matching);
    }
    return [...new Map(result.map(row => [row.id, row])).values()];
  }

  private prior(rows: Row[], current: Comparison, sourceKey: string) {
    return rows.flatMap(previous => compareRows(current, previous, sourceKey) ?? []).sort(rankPrior);
  }

  private async uploadResult(actor: Actor, id: string, status: 'IMPORTED'|'UNCHANGED'|'REVIEW_REQUIRED') {
    const [detail,active]=await Promise.all([this.detail(actor,id),this.activeRow(actor)]);
    const payments=this.paymentCounts(detail.summary.paymentRows?await this.sourceRows(actor,{id}):[]);
    return {...detail,status,payments,activeId:(active?.id as string|undefined) ?? null};
  }

  async upload(actor: Actor, raw: unknown) {
    authorize(actor, ['ADMIN']);
    const { filename, contentBase64, mode, replaceBatchId } = fileInput.parse(raw);
    const bytes = Buffer.from(contentBase64, 'base64');
    ensure(bytes.toString('base64') === contentBase64, 'VALIDATION_ERROR', 'No se pudo leer el contenido del Excel.', 400);
    const sha256 = hash(bytes);
    const existing = await this.store.one('SELECT id FROM procurement_import_batches WHERE org_id=? AND sha256=?', actor.orgId, sha256);
    if (existing) return this.uploadResult(actor,existing.id,'UNCHANGED');
    const { sheet, rows, summary } = parseProcurementWorkbook(bytes);
    const result = await this.store.transaction(async () => {
      const duplicate = await this.store.one('SELECT id FROM procurement_import_batches WHERE org_id=? AND sha256=?', actor.orgId, sha256);
      if (duplicate) return {id:duplicate.id as string,status:'UNCHANGED' as const};
      const replacement=replaceBatchId?await this.batch(actor,replaceBatchId):undefined;
      const sourceKey=replacement?.source_key ?? (mode==='append'?'append:'+randomUUID():workbookFamily(filename));
      const active=await this.activeRow(actor);
      const previous=await this.activeRow(actor,sourceKey)
        ?? (replacement ?? (active?.source_key===sourceKey?active:undefined));
      const priorSource=previous?await this.source(actor,previous):null;
      const lastBudget=priorSource?.parameters, nextBudget=summary.parameters;
      const defined = (params:Source['parameters']|undefined) => params?.budgets.some(item=>item.amountPyg!==null) ?? false;
      const reviewRequired=defined(lastBudget)&&!defined(nextBudget)&&
        (!nextBudget?.budgetMonth||lastBudget?.budgetMonth===nextBudget.budgetMonth);
      const priorRows = await this.candidates(actor.orgId, sourceKey, rows);
      const batchId = randomUUID(), date = new Date().toISOString();
      await this.store.run(`INSERT INTO procurement_import_batches(org_id,id,filename,sha256,sheet,source_key,original_file,summary_json,created_by,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`, actor.orgId, batchId, filename, sha256, sheet, sourceKey, bytes, JSON.stringify(summary), actor.id, date);
      for (let offset = 0; offset < rows.length; offset += 75) {
        const chunk = rows.slice(offset, offset + 75);
        const fields: SqlValue[] = chunk.flatMap(row => [actor.orgId, randomUUID(), batchId, row.rowNumber,
          JSON.stringify(row.original), JSON.stringify(row.normalized), JSON.stringify(row.issues), row.fingerprint,
          row.matchKey, row.receiptKey, JSON.stringify(this.prior(priorRows, row, sourceKey).slice(0, 12))]);
        await this.store.run(`INSERT INTO procurement_import_rows(org_id,id,batch_id,row_number,original_json,normalized_json,
          issues_json,fingerprint,match_key,receipt_key,prior_json,state)
          VALUES ${chunk.map(() => "(?,?,?,?,?,?,?,?,?,?,?,'PENDING')").join(',')}`, ...fields);
      }
      await this.store.run('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)', randomUUID(), actor.orgId, actor.id,
        'procurement.import.upload', batchId, batchId, JSON.stringify({ sha256, rows: rows.length }), date);
      if (active&&!active.activated_at) await this.markActive(actor,active.id);
      if (!reviewRequired) {
        await this.connectSuppliers(actor,rows.map(row=>({normalized:row.normalized,state:'PENDING',issues:row.issues})));
        if(summary.paymentRows)await applyImportedPayments(this.store,this.procurement,actor,batchId);
        await this.markActive(actor,batchId,await this.activeRow(actor)??active);
      }
      return {id:batchId,status:reviewRequired?'REVIEW_REQUIRED' as const:'IMPORTED' as const};
    });
    return this.uploadResult(actor,result.id,result.status);
  }

  private async currentPrior(actor: Actor, batch: Row, row: Row) {
    const comparison = { rowNumber: row.row_number, normalized: JSON.parse(row.normalized_json) as HistoricalRow,
      fingerprint: row.fingerprint, matchKey: row.match_key, receiptKey: row.receipt_key };
    const candidates = await this.candidates(actor.orgId, batch.source_key, [comparison], batch.id);
    return this.prior(candidates, comparison, batch.source_key);
  }

  async resolve(actor: Actor, batchId: string, rowId: string, raw: unknown) {
    authorize(actor, ['ADMIN']);
    const input = resolution.parse(raw);
    const operationName = `procurement.import.${z.uuid().parse(batchId)}.${z.uuid().parse(rowId)}.resolve`;
    return this.logistics.command(actor, operationName, input, ['ADMIN'], async () => {
      const batch = await this.batch(actor, batchId);
      const row = await this.row(actor, batch.id, rowId);
      ensure(row.state === 'PENDING', 'INVALID_TRANSITION', 'La fila ya fue resuelta.', 409);
      let state: State = 'SKIPPED';
      let outcome = null;
      if (input.action === 'PROMOTE') {
        const history = await this.currentPrior(actor, batch, row);
        const sameReceipt = row.receipt_key === null ? undefined : await this.store.one(`SELECT id FROM procurement_import_rows
          WHERE org_id=? AND batch_id=? AND receipt_key=? AND id<>? AND state='PROMOTED'`, actor.orgId, batch.id, row.receipt_key, row.id);
        ensure(!sameReceipt && !history.some(match => match.state === 'PROMOTED' && (match.type === 'UNCHANGED' || match.receiptMatched)), 'DUPLICATE_IMPORT_ROW',
        'Una versión previa ya se promovió. Revisá la operación vinculada y aplicá las correcciones desde su historial.', 409);
        const possibleDuplicate = (JSON.parse(row.issues_json) as Array<{ code: string }>).some(issue => issue.code === 'POSSIBLE_DUPLICATE');
        ensure(!(history.length || possibleDuplicate) || input.acknowledgePrior === true, 'IMPORT_MATCH_REVIEW_REQUIRED',
          'Confirmá que revisaste las coincidencias y que esta fila es una operación distinta.', 409);
        const normalized = JSON.parse(row.normalized_json) as HistoricalRow;
        const { operation } = input;
        ensure(!('commandId' in operation) && !('importRowId' in operation), 'VALIDATION_ERROR', 'La identidad de origen se obtiene del lote.', 400);
        if(normalized.payment) {
          ensure(operation.action==='SETTLEMENT'&&operation.kind==='PAYMENT','VALIDATION_ERROR','La fila corresponde a un pago.',400);
          const identifiers=z.object({partyId:z.uuid(),accountId:z.uuid(),reference:z.string().trim().min(1).max(180)}).parse(operation);
          const referenceKey=(value:string)=>value.trim().normalize('NFC').toLowerCase();
          const imported=normalized.payment.reference;
          if(imported) {
            const sameTransfer=(await this.sourceRows(actor,batch)).filter(item=>item.state==='PENDING'&&item.normalized.payment?.reference&&
              referenceKey(item.normalized.payment.reference)===referenceKey(imported));
            ensure(sameTransfer.length<=1,'PAYMENT_GROUP_REVIEW','Corregí y volvé a importar la transferencia completa para aplicarla a todas las facturas.',409);
          }
          const references=await this.store.all(`SELECT reference FROM procurement_settlements WHERE org_id=?
            AND (party_id=? OR account_id=?) AND kind IN ('PAYMENT','ADVANCE') AND reference IS NOT NULL`,
          actor.orgId,identifiers.partyId,identifiers.accountId);
          ensure(!references.some(row=>referenceKey(row.reference)===referenceKey(identifiers.reference)||
            Boolean(imported&&referenceKey(row.reference)===referenceKey(imported))),
          'DUPLICATE_IMPORT_ROW','La referencia del pago ya está registrada.',409);
        }
        const total = operation.action === 'DOCUMENT' ? operation.lines.reduce((sum, line) => sum + BigInt(line.totalPyg), 0n) : BigInt(operation.amountPyg);
        ensure(normalized.totalPyg === null || total === BigInt(normalized.totalPyg), 'VALIDATION_ERROR', 'El importe confirmado debe coincidir con el total del archivo.', 400);
        ensure(!normalized.paidAccordingToFile || operation.action !== 'DOCUMENT' || operation.payment,
          'HISTORICAL_PAYMENT_UNVERIFIED', 'Confirmá fecha de pago, cuenta, medio e importe para registrar este documento pagado.', 400);
        if (normalized.paidAccordingToFile && operation.action === 'DOCUMENT') {
          const payment = z.object({ amountPyg: z.number().int().positive() }).parse(operation.payment);
          ensure(BigInt(payment.amountPyg) === total, 'HISTORICAL_PAYMENT_UNVERIFIED', 'El pago confirmado debe cubrir el total del documento histórico pagado.', 400);
        }
        const commandId = randomUUID();
        const financial = await this.procurement.execute(actor, { ...operation, commandId }, row.id);
        outcome = { operationId: financial.id, action: operation.action, commandId };
        state = 'PROMOTED';
      }
      await this.store.run(`UPDATE procurement_import_rows SET state=?,outcome_json=?,resolution_reason=?,resolved_by=?,resolved_at=?
        WHERE org_id=? AND batch_id=? AND id=? AND state='PENDING'`, state, outcome ? JSON.stringify(outcome) : null,
      input.reason, actor.id, new Date().toISOString(), actor.orgId, batch.id, row.id);
      return { id: row.id, state, outcome };
    });
  }
}

export function installProcurementImportRoutes(app: Express, store: Database, auth: (req: Request) => Promise<Actor>, procurement: Procurement) {
  const importer = new ProcurementImport(store, procurement);
  const prefix = '/api/procurement/imports';
  app.use(prefix, (_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  app.get(prefix, async (req, res) => res.json(await importer.list(await auth(req), req.query)));
  app.get(prefix+'/active',async(req,res)=>res.json(await importer.active(await auth(req))));
  app.post(`${prefix}/:id/activate`,async(req,res)=>res.json(await importer.activate(await auth(req),req.params.id,req.body)));
  app.get(prefix+'/options', async (req,res)=>res.json(await importer.options(await auth(req))));
  app.get(`${prefix}/:id/workspace`, async (req,res)=>res.json(await importer.workspace(await auth(req),req.params.id)));
  app.post(`${prefix}/:id/setup`, async (req,res)=>res.json(await importer.applySetup(await auth(req),req.params.id,req.body)));
  app.post(prefix, async (req, res) => res.json(await importer.upload(await auth(req), req.body)));
  app.get(`${prefix}/:id`, async (req, res) => res.json(await importer.detail(await auth(req), req.params.id, req.query)));
  app.get(`${prefix}/:id/original`, async (req, res) => {
    const file = await importer.original(await auth(req), req.params.id);
    res.attachment(file.filename).type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .set('X-Content-Type-Options', 'nosniff').send(file.bytes);
  });
  app.get(`${prefix}/:id/rows/:rowId`, async (req, res) => res.json(await importer.rowDetail(await auth(req), req.params.id, req.params.rowId)));
  app.get(`${prefix}/:id/rows/:rowId/transfer`, async (req,res)=>res.json(await importer.transferReview(await auth(req),req.params.id,req.params.rowId)));
  app.post(`${prefix}/:id/rows/:rowId/transfer`, async (req,res)=>res.json(await importer.reprocessTransfer(await auth(req),req.params.id,req.params.rowId,req.body)));
  app.post(`${prefix}/:id/rows/:rowId/resolve`, async (req, res) => res.json(await importer.resolve(await auth(req), req.params.id, req.params.rowId, req.body)));
}
