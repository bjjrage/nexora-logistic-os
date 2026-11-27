import type {Express,Request} from 'express';
import {z} from 'zod';
import {authorize,type Actor} from './auth.ts';
import {encodeCsv} from './csv.ts';
import type {Database} from './database.ts';
import {ProcurementReads} from './procurement-reads.ts';
import {parseProcurementWorkbook,type HistoricalRow} from './procurement-workbook.ts';

const filters=z.strictObject({
  q:z.string().trim().max(200).default(''),from:z.iso.date().optional(),to:z.iso.date().optional(),
  month:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  partyId:z.uuid().optional(),categoryId:z.union([z.uuid(),z.literal('unclassified')]).optional(),centerId:z.uuid().optional(),
  nature:z.enum(['EXPENSE','PURCHASE','ASSET','REMUNERATION']).optional(),
  state:z.enum(['OPEN','PARTIAL','PAID','OVERDUE','VOID','REVIEW']).optional(),
  view:z.enum(['documents','expenses']).default('documents'),
  limit:z.coerce.number().int().min(1).max(100).default(25),offset:z.coerce.number().int().min(0).max(1_000_000).default(0),
}).refine(input=>!input.from||!input.to||input.from<=input.to,{path:['to'],message:'La fecha final debe ser igual o posterior a la inicial.'});

type Entry = {
  id:string;batchId:string|null;sourceBatchId:string|null;origin:'MANUAL'|'IMPORTED';date:string|null;partyId:string|null;partyName:string|null;
  taxId:string|null;categoryId:string|null;categoryName:string|null;centerId:string|null;centerName:string|null;
  reference:string|null;description:string|null;nature:string|null;state:string;
  totalPyg:number|null;vatPyg:number|null;netPyg:number|null;balancePyg:number|null;paidPyg:number|null;dueDate:string|null;
};
type BudgetLine = {month:string;categoryId:string|null;categoryName:string;budgetPyg:number|null;executedPyg:number;remainingPyg:number|null};
const key=(value:string|null|undefined)=>value?.trim().normalize('NFC').toLowerCase();
const searchKey=(value:string)=>value.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
const emptyTotals=()=>({count:0,totalPyg:0,vatPyg:0,netPyg:0,incompleteBreakdown:0});
const activeImportBatches=`WITH ranked AS (
  SELECT b.id,e.created_at AS activated_at,ROW_NUMBER() OVER (PARTITION BY b.source_key ORDER BY e.created_at DESC,e.id DESC) AS position
  FROM procurement_events e JOIN procurement_import_batches b ON b.org_id=e.org_id AND b.id=e.subject_id
  WHERE e.org_id=? AND e.action='IMPORT_ACTIVATE'
), active_batches AS (
  SELECT id,activated_at FROM ranked WHERE position=1
  UNION ALL
  SELECT id,created_at FROM (
    SELECT id,created_at FROM procurement_import_batches WHERE org_id=? AND NOT EXISTS (SELECT 1 FROM ranked)
    ORDER BY created_at DESC,id DESC LIMIT 1
  ) fallback
)`;

function addExpense(totals:ReturnType<typeof emptyTotals>,row:Entry) {
  if(row.state==='VOID'||row.nature==='ASSET')return;
  totals.count++;
  totals.totalPyg+=row.totalPyg??0;
  if(row.totalPyg===null||row.vatPyg===null||row.netPyg===null||row.totalPyg-row.vatPyg!==row.netPyg)totals.incompleteBreakdown++;
  else {totals.vatPyg+=row.vatPyg;totals.netPyg+=row.netPyg;}
}

function semesterTotals(rows:Entry[],year:string,budgetPyg:number|null) {
  const months=Array.from({length:6},(_,index)=>{
    const month=year+'-'+String(index+7).padStart(2,'0');
    return {month,...emptyTotals(),pendingPyg:0,accumulatedPyg:0};
  });
  const byMonth=new Map(months.map(month=>[month.month,month]));
  const totals={...emptyTotals(),pendingPyg:0};
  for(const row of rows) {
    const month=byMonth.get(row.date?.slice(0,7)??'');
    if(!month)continue;
    const pending=row.balancePyg??(row.state==='OPEN'?row.totalPyg??0:0);
    addExpense(month,row);
    addExpense(totals,row);
    totals.pendingPyg+=pending;
    month.pendingPyg+=pending;
  }
  let accumulated=0;
  let peak:typeof months[number]|undefined;
  let activeMonths=0;
  for(const month of months) {
    accumulated+=month.totalPyg;
    month.accumulatedPyg=accumulated;
    if(month.totalPyg<=0)continue;
    activeMonths++;
    if(!peak||month.totalPyg>peak.totalPyg)peak=month;
  }
  return {months,kpis:{
    totalPyg:totals.totalPyg,vatPyg:totals.incompleteBreakdown?null:totals.vatPyg,
    netPyg:totals.incompleteBreakdown?null:totals.netPyg,pendingPyg:totals.pendingPyg,count:totals.count,
    averagePyg:activeMonths?totals.totalPyg/activeMonths:0,
    peakMonth:peak?.month??null,peakPyg:peak?.totalPyg??0,
    budgetPyg,remainingPyg:budgetPyg===null?null:budgetPyg-totals.totalPyg,
    executionRatio:budgetPyg?totals.totalPyg/budgetPyg:null,
  }};
}

export class ProcurementRegister {
  private reads:ProcurementReads;
  private store:Database;
  constructor(store:Database) {
    this.store=store;
    this.reads=new ProcurementReads(store);
  }

  private async imported(actor:Actor):Promise<Entry[]> {
    const org=actor.orgId;
    const [rows,linked,parties,categories,centers]=await Promise.all([
      this.store.all(`${activeImportBatches} SELECT r.id,r.batch_id,r.normalized_json,r.fingerprint,r.receipt_key FROM procurement_import_rows r
        JOIN procurement_import_batches b ON b.org_id=r.org_id AND b.id=r.batch_id
        WHERE r.org_id=? AND r.state<>'SKIPPED' AND r.batch_id IN (SELECT id FROM active_batches)
        ORDER BY b.created_at DESC,b.id,r.row_number`,org,org,org),
      this.store.all(`SELECT r.id,r.fingerprint,r.receipt_key FROM procurement_import_rows r
        JOIN procurement_documents d ON d.org_id=r.org_id AND d.import_row_id=r.id WHERE r.org_id=?
        UNION ALL
        SELECT r.id,r.fingerprint,NULL AS receipt_key FROM procurement_import_rows r
        JOIN procurement_settlements s ON s.org_id=r.org_id AND s.import_row_id=r.id WHERE r.org_id=?`,org,org),
      this.store.all('SELECT id,name,ruc FROM procurement_parties WHERE org_id=?',org),
      this.store.all('SELECT id,name FROM procurement_categories WHERE org_id=?',org),
      this.store.all('SELECT id,name FROM procurement_centers WHERE org_id=?',org),
    ]);
    const linkedIds=new Set(linked.map(row=>row.id));
    const linkedFingerprints=new Set(linked.map(row=>row.fingerprint));
    const linkedReceipts=new Set(linked.flatMap(row=>row.receipt_key??[]));
    const firstBatch=new Map<string,string>();
    const byRuc=new Map(parties.filter(p=>p.ruc).map(p=>[p.ruc,p]));
    const byName=new Map<string|undefined,typeof parties[number]|null>();
    for(const party of parties) {
      const name=key(party.name);
      byName.set(name,byName.has(name)?null:party);
    }
    const categoryByName=new Map(categories.map(c=>[key(c.name),c.id]));
    const centerByName=new Map(centers.map(c=>[key(c.name),c.id]));
    return rows.flatMap(row=>{
      if(linkedIds.has(row.id)||linkedFingerprints.has(row.fingerprint)||(row.receipt_key&&linkedReceipts.has(row.receipt_key)))return [];
      if(row.receipt_key) {
        const batch=firstBatch.get(row.fingerprint);
        if(batch&&batch!==row.batch_id)return [];
        firstBatch.set(row.fingerprint,row.batch_id);
      }
      const source=JSON.parse(row.normalized_json) as HistoricalRow;
      if(source.payment)return [];
      const named=byName.get(key(source.supplier));
      const party=(source.taxId?byRuc.get(source.taxId):undefined) ?? (named&&(!source.taxId||!named.ruc)?named:null);
      const status=key(source.historicalStatus);
      const state=status==='pagado'?'PAID':status==='pendiente'?'OPEN':status==='anulado'?'VOID':'REVIEW';
      return [{
        id:row.id,batchId:row.batch_id,sourceBatchId:row.batch_id,origin:'IMPORTED' as const,date:source.date,partyId:party?.id??null,
        partyName:party?.name??source.supplier,taxId:source.taxId,categoryId:categoryByName.get(key(source.category))??null,
        categoryName:source.category,centerId:centerByName.get(key(source.costCenter))??null,centerName:source.costCenter,
        reference:source.documentNumber,description:source.description,nature:null,state,totalPyg:source.totalPyg,
        vatPyg:source.taxPyg,netPyg:source.netPyg,balancePyg:null,paidPyg:null,dueDate:source.dueDate,
      }];
    });
  }

  private async entries(actor:Actor,from?:string,to?:string):Promise<Entry[]> {
    const [documents,imports]=await this.store.transaction(()=>Promise.all([
      this.reads.confirmedDocuments(actor,from,to),this.imported(actor),
    ]));
    return [...documents.map(doc=>({
      id:doc.id,batchId:null,sourceBatchId:doc.importBatchId??null,origin:doc.importRowId?'IMPORTED' as const:'MANUAL' as const,date:doc.documentDate,
      partyId:doc.partyId,partyName:doc.partyName,taxId:doc.partyRuc,categoryId:doc.categoryId,categoryName:doc.categoryName,
      centerId:doc.centerId,centerName:doc.centerName,reference:doc.reference,description:doc.description,nature:doc.nature,state:doc.state,
      totalPyg:doc.totalPyg,vatPyg:doc.vatPyg,netPyg:doc.netPyg,balancePyg:doc.balancePyg,paidPyg:doc.paidPyg,dueDate:doc.dueDate,
    })), ...imports];
  }

  private async matching(actor:Actor,input:z.infer<typeof filters>) {
    const text=searchKey(input.q);
    return (await this.entries(actor,input.from,input.to)).filter(row=>{
      if(input.from&&(!row.date||row.date<input.from)||input.to&&(!row.date||row.date>input.to))return false;
      if(input.month&&!row.date?.startsWith(input.month))return false;
      if(input.partyId&&input.partyId!==row.partyId||input.centerId&&input.centerId!==row.centerId)return false;
      if(input.categoryId&&input.categoryId!==(row.categoryId??'unclassified'))return false;
      if(input.state&&input.state!==row.state||input.nature&&input.nature!==row.nature)return false;
      if(input.view==='expenses'&&(row.state==='VOID'||row.nature==='ASSET'))return false;
      return !text||[row.partyName,row.taxId,row.description,row.reference,row.categoryName,row.centerName]
        .some(value=>value&&searchKey(value).includes(text));
    }).sort((a,b)=>(b.date??'').localeCompare(a.date??'')||a.id.localeCompare(b.id));
  }

  async list(actor:Actor,raw:unknown) {
    authorize(actor,['ADMIN']);
    const input=filters.parse(raw);
    const rows=await this.matching(actor,input);
    const totals=emptyTotals();
    for(const row of rows)addExpense(totals,row);
    const items=rows.slice(input.offset,input.offset+input.limit);
    return {items,totals,count:rows.length,hasMore:input.offset+items.length<rows.length,limit:input.limit,offset:input.offset};
  }

  async monthly(actor:Actor,raw:unknown,exportCsv=false) {
    authorize(actor,['ADMIN']);
    const input=filters.parse(raw);
    const groups=new Map<string,ReturnType<typeof emptyTotals>>();
    for(const row of await this.matching(actor,{...input,view:'expenses'})) {
      const month=row.date?.slice(0,7)??'';
      const totals=groups.get(month)??emptyTotals();
      addExpense(totals,row);
      groups.set(month,totals);
    }
    const rows=[...groups].map(([month,totals])=>({month,...totals}));
    if(exportCsv)return encodeCsv([['Mes','Registros','Gastos con IVA','IVA incluido','Neto sin IVA'],
      ...rows.map(row=>[row.month,row.count,row.totalPyg,row.incompleteBreakdown?null:row.vatPyg,row.incompleteBreakdown?null:row.netPyg])]);
    const items=rows.slice(input.offset,input.offset+input.limit);
    return {items,limit:input.limit,offset:input.offset,hasMore:input.offset+items.length<rows.length};
  }

  async export(actor:Actor,raw:unknown) {
    authorize(actor,['ADMIN']);
    const rows=await this.matching(actor,filters.parse(raw));
    return encodeCsv([['Fecha','Proveedor','RUC','Comprobante','Concepto','Categoría','Centro de costo','Importe','IVA','Neto','Estado','Origen'],
      ...rows.map(row=>[row.date,row.partyName,row.taxId,row.reference,row.description,row.categoryName,row.centerName,
        row.totalPyg,row.vatPyg,row.netPyg,row.state,row.origin==='IMPORTED'?'Importación':'Carga manual'])]);
  }

  async semester(actor:Actor,raw:unknown) {
    authorize(actor,['ADMIN']);
    const {year}=z.strictObject({year:z.string().regex(/^(19\d{2}|[2-9]\d{3})$/)}).parse(raw);
    const from=year+'-07-01',to=year+'-12-31';
    return this.store.transaction(async()=>{
      const rows=(await this.entries(actor,from,to)).filter(row=>row.date&&row.date>=from&&row.date<=to&&row.state!=='VOID'&&row.nature!=='ASSET');
      const budget=await this.store.one('SELECT SUM(amount_pyg) AS amount FROM procurement_budgets WHERE org_id=? AND month>=? AND month<=?',
        actor.orgId,year+'-07',year+'-12');
      const report=semesterTotals(rows,year,budget?.amount==null?null:Number(budget.amount));
      const candidates=await this.store.all(`${activeImportBatches}
        SELECT b.id,b.filename,b.summary_json FROM procurement_import_batches b
        JOIN active_batches a ON a.id=b.id WHERE b.org_id=? ORDER BY a.activated_at DESC,b.id DESC`,
      actor.orgId,actor.orgId,actor.orgId);
      let comparison=null;
      for(const batch of candidates) {
        const summary=JSON.parse(batch.summary_json) as ReturnType<typeof parseProcurementWorkbook>['summary'];
        let semester=summary.semester;
        if(semester===undefined&&summary.controls?.some(control=>control.from===from&&/^resumen jul[-–]dic/i.test(control.sheet))) {
          const original=await this.store.one('SELECT original_file FROM procurement_import_batches WHERE org_id=? AND id=?',actor.orgId,batch.id);
          if(original)semester=parseProcurementWorkbook(Buffer.from(original.original_file)).summary.semester;
        }
        if(semester?.year!==Number(year))continue;
        const own=rows.filter(row=>row.sourceBatchId===batch.id);
        const scope=semesterTotals(own,year,semester.monthlyBudget===null?null:semester.monthlyBudget*6);
        comparison={filename:batch.filename,sheet:semester.sheet,excel:semester.values,imported:scope.kpis,
          others:{count:report.kpis.count-scope.kpis.count,totalPyg:report.kpis.totalPyg-scope.kpis.totalPyg}};
        break;
      }
      return {year,...report,comparison};
    });
  }

  private async budgetLines(actor:Actor,input:z.infer<typeof filters>) {
    const [entries,defined,categories]=await Promise.all([
      this.matching(actor,{...input,q:'',view:'expenses'}),
      this.store.all('SELECT category_id,month,amount_pyg FROM procurement_budgets WHERE org_id=?',actor.orgId),
      this.store.all('SELECT id,name FROM procurement_categories WHERE org_id=?',actor.orgId),
    ]);
    const names=new Map(categories.map(row=>[row.id,row.name]));
    const lines=new Map<string,BudgetLine>();
    function line(month:string,categoryId:string|null,sourceName:string|null) {
      const categoryName=names.get(categoryId)??sourceName??'Sin clasificar';
      const id=month+'|'+(categoryId??key(categoryName));
      let item=lines.get(id);
      if(!item) {
        item={month,categoryId,categoryName,budgetPyg:null,executedPyg:0,remainingPyg:null};
        lines.set(id,item);
      }
      return item;
    }
    for(const row of defined) {
      if(input.month&&input.month!==row.month||input.from&&row.month<input.from.slice(0,7)||input.to&&row.month>input.to.slice(0,7))continue;
      line(row.month,row.category_id,null).budgetPyg=row.amount_pyg===null?null:Number(row.amount_pyg);
    }
    for(const row of entries) {
      if(!row.date)continue;
      line(row.date.slice(0,7),row.categoryId,row.categoryName).executedPyg+=row.totalPyg??0;
    }
    const text=searchKey(input.q);
    return [...lines.values()].filter(item=>
      (!input.categoryId||input.categoryId===(item.categoryId??'unclassified'))&&(!text||searchKey(item.categoryName).includes(text)))
      .map(item=>({...item,remainingPyg:item.budgetPyg===null?null:item.budgetPyg-item.executedPyg}))
      .sort((a,b)=>b.month.localeCompare(a.month)||a.categoryName.localeCompare(b.categoryName,'es'));
  }

  async budget(actor:Actor,raw:unknown,exportCsv=false) {
    authorize(actor,['ADMIN']);
    const input=filters.parse(raw);
    const rows=await this.budgetLines(actor,input);
    if(exportCsv)return encodeCsv([['Mes','Categoría','Presupuesto','Ejecución','Disponible'],
      ...rows.map(row=>[row.month,row.categoryName,row.budgetPyg,row.executedPyg,row.remainingPyg])]);
    const items=rows.slice(input.offset,input.offset+input.limit);
    const defined=rows.filter(row=>row.budgetPyg!==null);
    return {items,count:rows.length,totalPyg:rows.reduce((sum,row)=>sum+row.executedPyg,0),
      budgetCount:defined.length,budgetTotalPyg:defined.length?defined.reduce((sum,row)=>sum+(row.budgetPyg??0),0):null,
      limit:input.limit,offset:input.offset,hasMore:input.offset+items.length<rows.length};
  }
}

export function installProcurementRegisterRoutes(app:Express,store:Database,auth:(req:Request)=>Promise<Actor>) {
  const registry=new ProcurementRegister(store);
  const path='/api/procurement/register';
  app.get(path,async(req,res)=>res.set('Cache-Control','private, no-store').json(await registry.list(await auth(req),req.query)));
  app.get(path+'.csv',async(req,res)=>{
    res.set('Cache-Control','private, no-store').attachment('compras-y-gastos.csv').type('text/csv')
      .send(await registry.export(await auth(req),req.query));
  });
  app.get(path+'/monthly',async(req,res)=>res.set('Cache-Control','private, no-store').json(await registry.monthly(await auth(req),req.query)));
  app.get(path+'/monthly.csv',async(req,res)=>res.set('Cache-Control','private, no-store').attachment('resumen-mensual.csv').type('text/csv')
    .send(await registry.monthly(await auth(req),req.query,true)));
  app.get(path+'/semester',async(req,res)=>res.set('Cache-Control','private, no-store').json(await registry.semester(await auth(req),req.query)));
  app.get(path+'/budget',async(req,res)=>res.set('Cache-Control','private, no-store').json(await registry.budget(await auth(req),req.query)));
  app.get(path+'/budget.csv',async(req,res)=>res.set('Cache-Control','private, no-store').attachment('presupuesto.csv').type('text/csv')
    .send(await registry.budget(await auth(req),req.query,true)));
}
