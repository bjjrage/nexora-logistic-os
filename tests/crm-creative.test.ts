import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {Store} from '../server/db.ts';
import {createApp} from '../server/app.ts';
import {hash} from '../server/auth.ts';
import {editorialStoryboard} from '../server/crm-creative.ts';

test('Studio editorial: variantes, tiempos y claims sin llamadas pagas',()=>{
  const b={id:randomUUID(),campaign:'Interior',objective:'Captación',audience:'Comerciantes',idea:'Mostrar el valor de vender online con almacenamiento y logística de Nexora.',duration_seconds:19,aspect_ratio:'9:16',version:1,state:'DRAFT'};
  const p=editorialStoryboard(b);
  assert.equal(p.engine,'EDITORIAL_TEMPLATE_NO_AI');
  assert.equal(p.concepts.length,3);
  for(const c of p.concepts) {
    assert.equal(c.scenes.reduce((n,s)=>n+s.seconds,0),19);
    assert.ok(c.scenes.every(s=>s.imagePrompt.includes('No embedded lettering')));
  }
  assert.equal(p.modelSelection,'PENDING_FAL_SCHEMA_VERIFICATION');
});
test('Studio CRM: aislamiento, permisos, idempotencia y aprobación',async()=>{
  const db=new Store(':memory:'),server=createApp(db).listen(0,'127.0.0.1');
  await once(server,'listening');
  const root='http://127.0.0.1:'+(server.address() as AddressInfo).port;
  const id=()=>randomUUID(),command=()=>({commandId:id()});
  const call=async(url:string,cookie:string,body?:object)=>{
    const result=await fetch(root+url,{method:body?'POST':'GET',headers:{Cookie:cookie,'X-Requested-With':'logistics-os','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    return {status:result.status,body:await result.json()};
  };
  try{
    const org=id(),other=id();
    for(const o of [org,other])await db.run('INSERT INTO organizations (id,name,timezone) VALUES (?,?,?)',o,'Fixture','America/Asuncion');
    const user=async(o:string,role:string)=>{
      const uid=id(),token=randomBytes(32).toString('hex');
      await db.run('INSERT INTO users (id,org_id,username,name,password_hash,role) VALUES (?,?,?,?,?,?)',uid,o,uid,'QA','unused',role);
      await db.run('INSERT INTO sessions VALUES (?,?,?)',hash(token),uid,'2099-01-01T00:00:00.000Z');
      return 'logistics_session='+token;
    };
    const a=await user(org,'ADMIN'),b=await user(other,'ADMIN'),depot=await user(org,'DEPOT');
    assert.equal((await call('/api/crm/creative/status',a)).body.paidRendering,false);
    const payload={...command(),campaign:'NEXORA',idea:'Un comerciante necesita almacenamiento y delivery para gestionar pedidos sin distraerse de sus clientes.',durationSeconds:20,aspectRatio:'9:16'};
    const result=await call('/api/crm/creative/briefs',a,payload);
    assert.equal(result.status,201,JSON.stringify(result.body));
    assert.equal((await call('/api/crm/creative/briefs',b)).body.total,0);
    assert.equal((await call('/api/crm/creative/briefs',depot)).status,403);
    assert.equal((await call('/api/crm/creative/briefs/'+result.body.id,b)).status,404);
    const detail=await call('/api/crm/creative/briefs/'+result.body.id,a);
    const plan=await call('/api/crm/creative/briefs/'+result.body.id+'/plan',a,{...command(),expectedVersion:detail.body.version});
    assert.equal(plan.body.engine,'EDITORIAL_TEMPLATE_NO_AI');
    const planned=await call('/api/crm/creative/briefs/'+result.body.id,a);
    assert.equal(planned.body.state,'PLANNED');
    assert.equal(planned.body.plan.concepts.length,3);
    const approved=await call('/api/crm/creative/briefs/'+result.body.id+'/approve',a,{...command(),expectedVersion:planned.body.version});
    assert.equal(approved.body.state,'APPROVED');
    const invalid=await call('/api/crm/creative/briefs/'+result.body.id+'/plan',a,{...command(),expectedVersion:planned.body.version});
    assert.equal(invalid.status,409);
    await db.run('DELETE FROM schema_migrations WHERE version=26');
    const unavailable=await call('/api/crm/creative/briefs',a);
    assert.equal(unavailable.status,503);
    assert.equal((await call('/api/crm/prospects',a)).status,200);
  }finally{
    server.closeAllConnections();
    await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
    await db.close();
  }
});
