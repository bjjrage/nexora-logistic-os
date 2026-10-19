import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {PostgresStore} from '../server/postgres.ts';
import {exerciseBilling,billingFixture,cmd} from './support/billing-fixture.ts';
import {emptyIssuer} from '../server/billing.ts';

test('isolated PostgreSQL billing: runtime grants, full story, rollback and private tables',async()=>{
 const url=new URL(process.env.DATABASE_URL??'');assert.ok(['127.0.0.1','localhost'].includes(url.hostname)&&url.pathname==='/nexora_test','Billing fixtures only run locally');
 const store=new PostgresStore(url.toString()),rollback=new Error('ROLLBACK_BILLING_QA');
 try{
  await store.verify();
  await assert.rejects(store.transaction(async()=>{await exerciseBilling(store,false);throw rollback;}),e=>e===rollback);
 }finally{await store.close();}
 const adminUrl=new URL(process.env.PG_TEST_ADMIN_URL??'');assert.ok(['127.0.0.1','localhost'].includes(adminUrl.hostname)&&adminUrl.pathname==='/nexora_test');
 const db=new pg.Client({connectionString:adminUrl.toString()});await db.connect();
 try{await db.query('BEGIN');for(const role of ['anon','authenticated','nexora_tracking_worker']){
  await db.query('SET LOCAL ROLE '+role);
  for(const table of ['billing_issuers','billing_documents','billing_shipment_links']){
   await db.query('SAVEPOINT denied');await assert.rejects(db.query('SELECT * FROM nexora.'+table),(e:any)=>e.code==='42501');await db.query('ROLLBACK TO SAVEPOINT denied');
  }await db.query('RESET ROLE');
 }}finally{await db.query('ROLLBACK');await db.end();}
});

test('isolated PostgreSQL billing: simultaneous requests cannot duplicate a command or overwrite issuer',async()=>{
 const url=new URL(process.env.DATABASE_URL??''),adminUrl=new URL(process.env.PG_TEST_ADMIN_URL??'');
 for(const target of [url,adminUrl])assert.ok(['127.0.0.1','localhost'].includes(target.hostname)&&target.pathname==='/nexora_test','Local test only');
 const store=new PostgresStore(url.toString()),owner=new pg.Client({connectionString:adminUrl.toString()});await owner.connect();
 let orgId:string|undefined;
 try{
  const {actor,billing,input}=await billingFixture(store);orgId=actor.orgId;
  const body={...cmd(),revision:0,data:input};
  const repeated=await Promise.all([billing.save(actor,null,body),billing.save(actor,null,body),billing.save(actor,null,body)]);
  assert.equal(new Set(repeated.map(d=>d.id)).size,1);
  await Promise.all([billing.save(actor,null,{...cmd(),revision:0,data:input}),billing.save(actor,null,{...cmd(),revision:0,data:input})]);
  assert.deepEqual((await billing.list(actor)).items.map(d=>d.reference).sort(),['PF-000001','PF-000002','PF-000003']);
  const changes=await Promise.allSettled([billing.saveIssuer(actor,{...cmd(),revision:0,data:emptyIssuer}),billing.saveIssuer(actor,{...cmd(),revision:0,data:{...emptyIssuer,phone:'QA'}})]);
  assert.equal(changes.filter(v=>v.status==='fulfilled').length,1);
 }finally{
  if(orgId){await owner.query('BEGIN');try{
   for(const table of ['billing_shipment_links','billing_documents','billing_issuers','audit','idempotency','client_profiles','clients','users'])await owner.query('DELETE FROM nexora.'+table+' WHERE org_id=$1',[orgId]);
   await owner.query('DELETE FROM nexora.organizations WHERE id=$1',[orgId]);await owner.query('COMMIT');
  }catch(e){await owner.query('ROLLBACK');throw e;}}
  await owner.end();await store.close();
 }
});
