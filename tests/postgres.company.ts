import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PostgresStore} from '../server/postgres.ts';
import {passwordHash,type Actor} from '../server/auth.ts';
import {CompanyAdministration} from '../server/company.ts';
import {Logistics} from '../server/domain.ts';

test('Supabase: empresa, equipo y cliente mantienen su jerarquía y sus identidades; rollback completo',async()=>{
 const store=new PostgresStore(process.env.DATABASE_URL??''),org=randomUUID(),user=randomUUID(),rollback=new Error('ROLLBACK_COMPANY_QA');
 try{
  await assert.rejects(store.transaction(async()=>{
   await store.run('INSERT INTO organizations VALUES(?,?,?)',org,'Universo QA','America/Asuncion');
   await store.run("INSERT INTO users VALUES(?,?,?,?,?,'ADMIN',NULL)",user,org,'qa-company-'+user,'QA',passwordHash(randomUUID()));
   const actor:Actor={id:user,orgId:org,name:'QA',role:'ADMIN',driverId:null},domain=new Logistics(store),company=new CompanyAdministration(store);
   const client=(await domain.createClient(actor,{commandId:randomUUID(),name:'Universo QA'})).id;
   await company.update(actor,{commandId:randomUUID(),name:'Nexora QA',timezone:'America/Asuncion'});
   await domain.updateClient(actor,client,{commandId:randomUUID(),name:'Universo QA actualizado'});
   const read=JSON.parse(JSON.stringify(await company.read(actor)));
   assert.equal(read.organization.id,org);assert.equal(read.organization.name,'Nexora QA');assert.equal(read.team[0].id,user);
   assert.ok(!('password_hash' in read.team[0]));
   const boot=JSON.parse(JSON.stringify(await domain.bootstrap(actor)));assert.equal(boot.clients[0].id,client);assert.equal(boot.clients[0].name,'Universo QA actualizado');
   assert.equal(boot.organization.name,'Nexora QA');assert.equal(boot.organization.supportContacts[0].role,'ADMIN');
   throw rollback;
  }),e=>e===rollback);
  assert.equal(await store.one('SELECT id FROM organizations WHERE id=?',org),undefined);
 }finally{await store.close();}
});
