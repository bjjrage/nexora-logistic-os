import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import type {Actor} from '../server/auth.ts';
import {hash} from '../server/auth.ts';
import {createApp} from '../server/app.ts';
import {Store} from '../server/db.ts';
import {PostgresStore} from '../server/postgres.ts';
import {ProcurementReads} from '../server/procurement-reads.ts';
import type {Database} from '../server/database.ts';

const time='2026-11-15T14:00:00.000Z';

async function organization(store: Database, role: Actor['role']='ADMIN'): Promise<Actor> {
  const orgId=randomUUID(), id=randomUUID();
  await store.run('INSERT INTO organizations(id,name,timezone) VALUES(?,?,?)',orgId,'Organización sintética','America/Asuncion');
  await store.run('INSERT INTO users(id,org_id,username,name,password_hash,role,driver_id) VALUES(?,?,?,?,?,?,NULL)',
    id,orgId,id,'Administración sintética','test-only',role);
  return {id,orgId,role,name:'Administración sintética',driverId:null};
}

async function fixture(store: Database) {
  const actor=await organization(store);
  const {orgId,id:actorId}=actor;
  const party=randomUUID(), category=randomUUID(), noBudget=randomUUID(), center=randomUUID(), account=randomUUID();
  const expense=randomUUID(), unclassified=randomUUID(), asset=randomUUID(), payment=randomUUID(), advance=randomUUID(), credit=randomUUID();
  await store.run("INSERT INTO procurement_parties(org_id,id,name,kind,active,created_at) VALUES(?,?,?,'SUPPLIER',1,?)",orgId,party,'Proveedor sintético',time);
  await store.run('INSERT INTO procurement_categories(org_id,id,name) VALUES(?,?,?),(?,?,?)',
    orgId,category,'Servicios',orgId,noBudget,'Sin presupuesto');
  await store.run('INSERT INTO procurement_centers(org_id,id,name) VALUES(?,?,?)',orgId,center,'Depósito');
  await store.run("INSERT INTO procurement_accounts(org_id,id,name,kind) VALUES(?,?,?,'BANK')",orgId,account,'Banco sintético');
  const document = (doc: string, kind: string, cat: string|null, reference: string, amount: number) =>
    store.run(`INSERT INTO procurement_documents(org_id,id,party_id,nature,category_id,center_id,document_date,due_date,
      condition,reference,description,total_pyg,vat_pyg,net_pyg,actor_id,created_at)
      VALUES(?,?,?,?,?,?,'2026-10-01','2026-10-30','CREDIT',?,'Trabajo sintético',?,0,?,?,?)`,
    orgId,doc,party,kind,cat,center,reference,amount,amount,actorId,time);
  await document(expense,'EXPENSE',category,'=ABC-1',1_000_000);
  await document(unclassified,'EXPENSE',null,'QA-2',80_000);
  await document(asset,'ASSET',category,'QA-3',650_000);
  const settlement = (value: string, kind: string, amount: number, origin: string|null, method: string|null) =>
    store.run(`INSERT INTO procurement_settlements(org_id,id,party_id,kind,amount_pyg,event_date,account_id,method,
      actor_id,created_at) VALUES(?,?,?,?,?,'2026-11-01',?,?,?,?)`,orgId,value,party,kind,amount,origin,method,actorId,time);
  await settlement(payment,'PAYMENT',400_000,account,'Transferencia');
  await settlement(advance,'ADVANCE',300_000,account,'Transferencia');
  await settlement(credit,'CREDIT',100_000,null,null);
  for (const [settlementId, amount] of [[payment,400_000],[advance,200_000],[credit,100_000]] as const) {
    await store.run(`INSERT INTO procurement_applications(org_id,id,party_id,settlement_id,document_id,amount_pyg,actor_id,created_at)
      VALUES(?,?,?,?,?,?,?,?)`,orgId,randomUUID(),party,settlementId,expense,amount,actorId,time);
  }
  for (const [settlementId, amount] of [[payment,-400_000],[advance,-300_000]] as const) {
    await store.run(`INSERT INTO procurement_movements(org_id,id,account_id,settlement_id,kind,amount_pyg,event_date,reference,actor_id,created_at)
      VALUES(?,?,?,?,'EXIT',?,'2026-11-01','Prueba',?,?)`,orgId,randomUUID(),account,settlementId,amount,actorId,time);
  }
  await store.run("INSERT INTO procurement_budgets(org_id,category_id,month,amount_pyg) VALUES(?,?,'2026-10',0)",orgId,category);
  return {actor,party,category,noBudget,center,account,expense,asset,payment,advance,credit,
    reads:new ProcurementReads(store,()=>new Date(time))};
}

async function exerciseReportReads(store: Database) {
  const {reads,actor,category,noBudget,center,account,party,expense,asset}=await fixture(store);
  const expenses=await reads.report(actor,{view:'expenses',from:'2026-10-01',to:'2026-10-31',limit:1});
  assert.equal(expenses.total,1_080_000);
  assert.equal(expenses.count,2);
  assert.equal(expenses.items.length,1);
  assert.equal(expenses.hasMore,true);
  const drilldown=await reads.report(actor,{view:'expenses',categoryId:category,centerId:center,partyId:party,month:'2026-10'});
  assert.deepEqual(drilldown.items.map(row=>row.id),[expense]);
  const csv=await reads.export(actor,{view:'expenses',categoryId:category,centerId:center,partyId:party,month:'2026-10'});
  assert.match(csv,new RegExp(expense));
  assert.match(csv,/'=ABC-1/);
  assert.doesNotMatch(csv,new RegExp(asset));
  assert.equal((await reads.report(actor,{view:'expenses',categoryId:'unclassified'})).total,80_000);
  assert.equal((await reads.report(actor,{view:'payables'})).total,1_030_000);
  const overdue=await reads.report(actor,{view:'overdue',categoryId:category,nature:'EXPENSE'});
  assert.equal(overdue.total,300_000);
  const detail=await reads.detail(actor,'documents',expense);
  assert.deepEqual([detail.paidPyg,detail.creditPyg,detail.balancePyg],[600_000,100_000,300_000]);
  assert.equal((await reads.report(actor,{view:'payments',month:'2026-10'})).total,0);
  assert.equal((await reads.report(actor,{view:'payments',month:'2026-11',categoryId:category})).total,700_000);
  assert.equal((await reads.report(actor,{view:'advances'})).total,100_000);
  assert.equal((await reads.report(actor,{view:'assets'})).total,650_000);
  assert.equal((await reads.report(actor,{view:'movements',accountId:account,categoryId:category,state:'APPLIED'})).total,-400_000);
  const current=await reads.detail(actor,'accounts',account);
  assert.equal(current.openingPyg,null);
  assert.equal(current.hasOpening,false);
  assert.equal(current.movementPyg,-700_000);
  const opening=randomUUID();
  await store.run(`INSERT INTO procurement_movements(org_id,id,account_id,kind,amount_pyg,event_date,reference,actor_id,created_at)
    VALUES(?,?,?,'OPENING',0,'2026-10-01','Apertura',?,?)`,actor.orgId,opening,account,actor.id,time);
  const withOpening=await reads.detail(actor,'accounts',account);
  assert.equal(withOpening.openingPyg,0);
  assert.equal(withOpening.hasOpening,true);
  assert.equal(withOpening.movementPyg,-700_000);
  const reversal=randomUUID();
  await store.run(`INSERT INTO procurement_movements(org_id,id,account_id,kind,amount_pyg,event_date,reference,actor_id,created_at,reversal_of)
    VALUES(?,?,?,'REVERSAL',0,'2026-11-01','Apertura',?,?,?)`,actor.orgId,reversal,account,actor.id,time,opening);
  const corrected=await reads.detail(actor,'accounts',account);
  assert.equal(corrected.openingPyg,null);
  assert.equal(corrected.hasOpening,false);
  assert.equal(corrected.movementPyg,-700_000);
  const openingHistory=await reads.detail(actor,'movements',opening);
  assert.equal(openingHistory.reversed,true);
  assert.deepEqual(openingHistory.related.map((row:{id:string})=>row.id),[reversal]);
  const budget=await reads.report(actor,{view:'budgets',month:'2026-10'});
  assert.equal(budget.total,1_080_000);
  assert.equal(budget.budgetTotalPyg,0);
  assert.equal(budget.budgetCount,1);
  assert.equal(budget.items.find(row=>row.categoryId===category)?.budgetPyg,0);
  assert.equal(budget.items.find(row=>row.categoryId===noBudget)?.budgetPyg,null);
  assert.equal(budget.items.find(row=>row.categoryId===null)?.categoryName,'Sin clasificar');
}

test('procurement reports use the same rows for totals, drilldown and exports', async t=>{
  const store=new Store(':memory:');
  t.after(()=>store.close());
  await exerciseReportReads(store);
});

test('isolated PostgreSQL procurement reports reconcile their export and drilldown', {
  skip: process.env.NX_PROCUREMENT_READS_POSTGRES!=='1',
}, async t=>{
  const url=new URL(process.env.DATABASE_URL ?? '');
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname) && url.pathname==='/nexora_test','Local PostgreSQL test only');
  const store=new PostgresStore(url.toString());
  t.after(()=>store.close());
  const rollback=new Error('ROLLBACK_PROCUREMENT_READS');
  await assert.rejects(store.transaction(async()=>{
    await exerciseReportReads(store);
    throw rollback;
  }), error=>error===rollback);
});

test('procurement attachments are private, validated and audited',async t=>{
  const store=new Store(':memory:');
  t.after(()=>store.close());
  const {actor,expense,reads}=await fixture(store);
  const other=await organization(store);
  const token='a'.repeat(64), otherToken='b'.repeat(64);
  for (const [account,secret] of [[actor,token],[other,otherToken]] as const) {
    await store.run('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)',hash(secret),account.id,new Date(Date.now()+60_000).toISOString());
  }
  const server=createApp(store).listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  const address=server.address() as {port:number};
  const api='http://127.0.0.1:'+address.port+'/api/procurement';
  const headers={'Content-Type':'application/json','X-Requested-With':'logistics-os',Cookie:'logistics_session='+token};
  const data=Buffer.from('%PDF-1.4\n% adjunto sintético\n%%EOF\n');
  const body={commandId:randomUUID(),filename:'Comprobante Ñ.pdf',mimeType:'application/pdf',dataBase64:data.toString('base64')};
  const route=api+'/documents/'+expense+'/attachments';
  const upload=(attachment:typeof body)=>fetch(route,{headers,method:'POST',body:JSON.stringify(attachment)});
  const invalid=await upload({...body,dataBase64:Buffer.from('<html>').toString('base64')});
  assert.equal(invalid.status,400);
  const response=await upload(body);
  assert.equal(response.status,201,await response.clone().text());
  const attachment=await response.json();
  assert.deepEqual(await (await upload(body)).json(),attachment);
  assert.deepEqual(await (await upload({...body,commandId:randomUUID()})).json(),attachment);
  const detail=await reads.detail(actor,'documents',expense);
  assert.equal(detail.attachments.length,1);
  assert.equal(detail.events.filter(event=>event.action==='ATTACH').length,1);
  const download=api+'/attachments/'+attachment.id;
  assert.equal((await fetch(download)).status,401);
  assert.equal((await fetch(download,{headers:{Cookie:'logistics_session='+otherToken}})).status,404);
  assert.equal((await fetch(api+'/documents/'+expense,{headers:{Cookie:'logistics_session='+otherToken}})).status,404);
  assert.equal((await fetch(route,{method:'POST',headers:{...headers,Cookie:'logistics_session='+otherToken},
    body:JSON.stringify({...body,commandId:randomUUID()})})).status,404);
  const allowed=await fetch(download,{headers});
  assert.equal(allowed.status,200);
  assert.match(allowed.headers.get('content-disposition') ?? '',/^attachment;/);
  assert.equal(allowed.headers.get('content-type'),'application/pdf');
  assert.equal(allowed.headers.get('cache-control'),'private, no-store');
  assert.deepEqual(Buffer.from(await allowed.arrayBuffer()),data);
  await store.run("UPDATE users SET role='OPERATIONS' WHERE id=?",actor.id);
  assert.equal((await fetch(download,{headers})).status,403);
  assert.equal((await fetch(api+'/reports',{headers})).status,403);
  assert.equal((await fetch(api+'/export.csv',{headers})).status,403);
});
