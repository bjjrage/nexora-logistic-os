import test from 'node:test';
import assert from 'node:assert/strict';
import {PostgresStore} from '../server/postgres.ts';
import {checkClientRemoval,checkClientWithBillingIsKept,checkProductRemoval} from './support/client-removal.ts';

test('PostgreSQL aislado: borrado con el rol del OS, historial protegido y separación de clientes',async()=>{
 const url=new URL(process.env.DATABASE_URL??'');
 assert.ok(['127.0.0.1','localhost'].includes(url.hostname)&&url.pathname==='/nexora_test','Se requiere la base local de prueba');
 const db=new PostgresStore(url.toString()),rollback=new Error('ROLLBACK_QA');
 try{
  await db.verify();
  const grants=await db.one(`SELECT
   has_function_privilege('anon','nexora.purge_client(text,text,text,text,text)','EXECUTE') AS anon,
   has_function_privilege('authenticated','nexora.purge_client(text,text,text,text,text)','EXECUTE') AS web,
   has_function_privilege('service_role','nexora.purge_client(text,text,text,text,text)','EXECUTE') AS service_api,
   has_function_privilege('nexora_tracking_worker','nexora.purge_client(text,text,text,text,text)','EXECUTE') AS gps,
   has_table_privilege('nexora_runtime','nexora.inventory_movements','DELETE') AS ledger_delete,
   to_regclass('nexora.client_purge_scope') IS NULL AS scope_removed`);
  assert.deepEqual(grants,{anon:false,web:false,service_api:false,gps:false,ledger_delete:false,scope_removed:true});
  await assert.rejects(db.transaction(async()=>{
   await checkClientRemoval(db);
   await checkClientWithBillingIsKept(db);
   await checkProductRemoval(db);
   throw rollback;
  }),error=>error===rollback);
 }finally{await db.close();}
});
