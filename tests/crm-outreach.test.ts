import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {Store} from '../server/db.ts';
import {createApp} from '../server/app.ts';
import {hash} from '../server/auth.ts';

test('CRM-02: borradores, aprobación humana, aislamiento, no contactar y migración faltante',async()=>{
  const db=new Store(':memory:'), server=createApp(db).listen(0,'127.0.0.1');
  await once(server,'listening');
  const root='http://127.0.0.1:'+(server.address() as AddressInfo).port;
  const call=async (url:string,cookie:string,data?:object,method='POST')=>{
    const result=await fetch(root+url,{method:data?method:'GET',headers:{Cookie:cookie,'X-Requested-With':'logistics-os','Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});
    return {status:result.status,body:await result.json()};
  };
  const id=()=>randomUUID(), command=()=>({commandId:id()});
  try{
    const org=id(),other=id();
    for(const o of [org,other])await db.run('INSERT INTO organizations(id,name,timezone) VALUES (?,?,?)',o,'CRM fixture','America/Asuncion');
    const credentials=async (o:string,role:string)=>{
      const user=id(),token=randomBytes(32).toString('hex');
      await db.run('INSERT INTO users (id,org_id,username,name,password_hash,role) VALUES (?,?,?,?,?,?)',user,o,user,'QA','unused',role);
      await db.run('INSERT INTO sessions VALUES (?,?,?)',hash(token),user,'2099-01-01T00:00:00.000Z');
      return {id:user,cookie:'logistics_session='+token};
    };
    const a=await credentials(org,'ADMIN'),b=await credentials(other,'ADMIN'),d=await credentials(org,'DEPOT');
    const lead=await call('/api/crm/prospects',a.cookie,{...command(),name:'Tienda ejemplo',city:'Luque',department:'Central'});
    assert.equal(lead.status,201);
    const contact=await call('/api/crm/prospects/'+lead.body.id+'/contacts',a.cookie,{
      ...command(),name:'Comercial',email:'ventas@ejemplo.test',preferredChannel:'EMAIL',
    });
    assert.equal(contact.status,201,JSON.stringify(contact.body));
    const thread=await call('/api/crm/outreach/threads',a.cookie,{...command(),prospectId:lead.body.id,contactId:contact.body.id,channel:'EMAIL'});
    assert.equal(thread.status,201,JSON.stringify(thread.body));
    const duplicated=await call('/api/crm/outreach/threads',a.cookie,{...command(),prospectId:lead.body.id,contactId:contact.body.id,channel:'EMAIL'});
    assert.equal(duplicated.body.id,thread.body.id);
    const denied=await call('/api/crm/outreach/threads',d.cookie);
    assert.equal(denied.status,403);
    const foreign=await call('/api/crm/outreach/threads/'+thread.body.id+'/messages',b.cookie);
    assert.equal(foreign.status,404);
    const data={...command(),body:'Hola, ¿te interesa conocer nuestros servicios?'};
    const first=await call('/api/crm/outreach/threads/'+thread.body.id+'/drafts',a.cookie,data);
    assert.equal(first.status,201);
    const retry=await call('/api/crm/outreach/threads/'+thread.body.id+'/drafts',a.cookie,data);
    assert.equal(retry.body.id,first.body.id);
    assert.equal((await call('/api/crm/outreach/threads/'+thread.body.id+'/messages',a.cookie)).body.total,1);
    const review=await call('/api/crm/outreach/messages/'+first.body.id+'/request-approval',a.cookie,command());
    assert.equal(review.body.state,'PENDING_APPROVAL');
    const approved=await call('/api/crm/outreach/messages/'+first.body.id+'/approve',a.cookie,command());
    assert.equal(approved.body.state,'APPROVED');
    assert.equal((await call('/api/crm/outreach/threads/'+thread.body.id+'/messages',a.cookie)).body.rows[0].state,'APPROVED');
    const prospect=await call('/api/crm/prospects/'+lead.body.id,a.cookie);
    const c=prospect.body.contacts[0];
    const optout=await call('/api/crm/prospects/'+lead.body.id+'/contacts/'+c.id,a.cookie,{
      ...command(),name:c.name,jobTitle:'',email:c.email,phone:'',facebook:'',instagram:'',preferredChannel:'EMAIL',noContact:true,expectedVersion:c.version,
    },'PUT');
    assert.equal(optout.status,200,JSON.stringify(optout.body));
    assert.equal((await call('/api/crm/outreach/threads/'+thread.body.id+'/drafts',a.cookie,{...command(),body:'Segundo mensaje'})).body.error.code,'CRM_DO_NOT_CONTACT');
    await db.run('DELETE FROM schema_migrations WHERE version=25');
    const notReady=await call('/api/crm/outreach/threads',a.cookie);
    assert.equal(notReady.status,503);
    assert.equal(notReady.body.error.code,'CRM_OUTREACH_NOT_READY');
    assert.equal((await call('/api/crm/prospects',a.cookie)).status,200);
  }finally{
    server.closeAllConnections();
    await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
    await db.close();
  }
});
