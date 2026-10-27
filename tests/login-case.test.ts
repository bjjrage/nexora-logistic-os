import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Store} from '../server/db.ts';
import {setup,passwordHash,type Actor} from '../server/auth.ts';
import {Logistics} from '../server/domain.ts';
import {createApp} from '../server/app.ts';

test('staff and customer login accept username case variations without weakening password checks or guessing ambiguous identities',async t=>{
 const store=new Store(':memory:');t.after(()=>store.close());
 const base=await setup(store,{organizationName:'QA',timezone:'America/Asuncion',username:'Magy',password:'QA-secret-123'});
 const actor:Actor={id:base.userId,orgId:base.orgId,name:'QA',role:'ADMIN',driverId:null},domain=new Logistics(store),command=()=>({commandId:randomUUID()});
 await domain.createUser(actor,{...command(),name:'QA admin',username:'Marcelo',password:'QA-Password-456',role:'ADMIN'});
 await assert.rejects(()=>domain.createUser(actor,{...command(),name:'Otro',username:'marcelo',password:'QA-Password-456',role:'ADMIN'}),(e:any)=>e.code==='VALIDATION_ERROR');
 const client=(await domain.createClient(actor,{...command(),name:'Cliente QA'})).id;
 await store.run('INSERT INTO customer_accounts(id,org_id,client_id,name,username,password_hash,enabled,created_at) VALUES(?,?,?,?,?,?,1,?)',randomUUID(),actor.orgId,client,'Cliente QA','ClienteQA',passwordHash('QA-Cliente-789'),new Date().toISOString());
 const server=createApp(store).listen(0,'127.0.0.1');t.after(()=>new Promise<void>(r=>server.close(()=>r())));await new Promise<void>(r=>server.once('listening',r));
 const url='http://127.0.0.1:'+(server.address() as {port:number}).port+'/api/login';
 const login=async(username:string,password:string)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'logistics-os'},body:JSON.stringify({username,password})});
 assert.equal((await login('marcelo','QA-Password-456')).status,200);
 assert.equal((await login('MARCelo','QA-Password-456')).status,200);
 assert.equal((await login('marcelo','wrong-password')).status,401);
 assert.equal((await login('clienteqa','QA-Cliente-789')).status,200);
 await store.run('INSERT INTO users(id,org_id,username,name,password_hash,role,driver_id) VALUES(?,?,?,?,?,?,NULL)',randomUUID(),actor.orgId,'MARCelo','Colisión histórica',passwordHash('QA-Other-123'),'ADMIN');
 assert.equal((await login('mArcelo','QA-Password-456')).status,401);
 assert.equal((await login('Marcelo','QA-Password-456')).status,200);
});
