import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PostgresStore} from '../server/postgres.ts';
import {Logistics} from '../server/domain.ts';
import {passwordHash,type Actor} from '../server/auth.ts';

test('Supabase: ficha privada, contrato JSON, actualización parcial y permisos; rollback',async()=>{
 const store=new PostgresStore(process.env.DATABASE_URL??''),orgId=randomUUID(),userId=randomUUID(),rollback=new Error('ROLLBACK_CLIENT_PROFILE_QA');
 try{
  await store.verify();
  await assert.rejects(store.transaction(async()=>{
   await store.run('INSERT INTO organizations VALUES(?,?,?)',orgId,'QA ficha cliente rollback','America/Asuncion');
   await store.run('INSERT INTO users VALUES(?,?,?,?,?,?,NULL)',userId,orgId,'qa-profile-'+userId,'QA',passwordHash(randomUUID()),'ADMIN');
   const actor:Actor={id:userId,orgId,name:'QA',role:'ADMIN',driverId:null},domain=new Logistics(store);
   const body={commandId:randomUUID(),name:'Cliente QA',legalName:'Empresa ficticia QA',taxId:'QA-'+randomUUID(),contactName:'Contacto ficticio',phone:'+595000000000',email:'qa@example.test',address:'Dirección ficticia',city:'QA',notes:'Prueba de privacidad'};
   const client=await domain.createClient(actor,body);assert.deepEqual(await domain.createClient(actor,body),client);
   let boot=JSON.parse(JSON.stringify(await domain.bootstrap(actor)));assert.equal(boot.clients[0].legalName,body.legalName);assert.equal(boot.clients[0].contactName,body.contactName);assert.equal(boot.clients[0].taxId,body.taxId);assert.equal(Number(boot.clients[0].catalogProductCount),0);
   await domain.updateClient(actor,client.id,{commandId:randomUUID(),name:'Cliente QA actualizado',phone:'+595000000001'});
   boot=JSON.parse(JSON.stringify(await domain.bootstrap(actor)));assert.equal(boot.clients[0].email,body.email);assert.equal(boot.clients[0].phone,'+595000000001');
   const depot=JSON.parse(JSON.stringify(await domain.bootstrap({...actor,role:'DEPOT'})));assert.ok(!('email' in depot.clients[0]));assert.ok(!('taxId' in depot.clients[0]));
   const grants=await store.one("SELECT has_table_privilege('anon','nexora.client_profiles','SELECT') AS anonymous,has_table_privilege('authenticated','nexora.client_profiles','SELECT') AS customer,has_table_privilege('nexora_tracking_worker','nexora.client_profiles','SELECT') AS gps,has_table_privilege('nexora_runtime','nexora.client_profiles','DELETE') AS deletable");
   assert.deepEqual(grants,{anonymous:false,customer:false,gps:false,deletable:false});
   const rls=await store.one("SELECT relrowsecurity FROM pg_class WHERE oid='nexora.client_profiles'::regclass");assert.equal(rls!.relrowsecurity,true);
   throw rollback;
  }),error=>error===rollback);
  assert.equal(await store.one('SELECT id FROM organizations WHERE id=?',orgId),undefined);
 }finally{await store.close();}
});
