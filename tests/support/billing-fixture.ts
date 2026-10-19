import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Database} from '../../server/database.ts';
import {passwordHash,type Actor} from '../../server/auth.ts';
import {Logistics} from '../../server/domain.ts';
import {Billing,emptyIssuer} from '../../server/billing.ts';

export const cmd=()=>({commandId:randomUUID()});
export async function billingFixture(store:Database){
 const initial={userId:randomUUID(),orgId:randomUUID()};
 await store.run('INSERT INTO organizations(id,name,timezone) VALUES(?,?,?)',initial.orgId,'Nexora Billing QA','America/Asuncion');
 await store.run('INSERT INTO users(id,org_id,username,name,password_hash,role,driver_id) VALUES(?,?,?,?,?,?,NULL)',initial.userId,initial.orgId,'billing-'+randomUUID(),'QA',passwordHash('QA-Billing-2026!'),'ADMIN');
 const actor:Actor={id:initial.userId,orgId:initial.orgId,name:'QA',role:'ADMIN',driverId:null};
 const domain=new Logistics(store),billing=new Billing(store);
 const client=(await domain.createClient(actor,{...cmd(),name:'Cliente QA',legalName:'Cliente sintético S.A.',taxId:'80012345-1',address:'Dirección de prueba'})).id;
 const input={clientId:client,serviceDate:'2026-10-18',dueDate:null,condition:'CASH' as const,notes:'QA',lines:[{description:'Distribución',quantity:2,unitPrice:55000,vatRate:10 as const,shipmentId:null as string|null}]};
 return {actor,domain,billing,client,input};
}
export async function exerciseBilling(store:Database,concurrent=true){
 const f=await billingFixture(store),{actor,domain,billing,client,input}=f;
 const request={...cmd(),revision:0,data:input};
 const result=await billing.save(actor,null,request);
 assert.deepEqual(await billing.save(actor,null,request),result,'retry returns original');
 assert.equal((await billing.list(actor)).items.length,1);
 const doc=await billing.read(actor,result.id);assert.equal(doc.reference,'PF-000001');assert.equal(doc.total,110000);assert.equal(doc.vat10,10000);assert.equal(doc.customer.taxId,'80012345-1');
 await assert.rejects(()=>billing.transition(actor,doc.id,{...cmd(),revision:1,state:'READY'}),/Completá/);
 const issuer={...emptyIssuer,legalName:'Nexora QA',taxId:'80012346-2',address:'Dirección fiscal de prueba'};
 await billing.saveIssuer(actor,{...cmd(),revision:0,data:issuer});
 if(concurrent){
  const changes=await Promise.allSettled([billing.saveIssuer(actor,{...cmd(),revision:1,data:{...issuer,phone:'A'}}),billing.saveIssuer(actor,{...cmd(),revision:1,data:{...issuer,phone:'B'}})]);
  assert.equal(changes.filter(r=>r.status==='fulfilled').length,1,'optimistic lock protects issuer');
 }else{
  await billing.saveIssuer(actor,{...cmd(),revision:1,data:{...issuer,phone:'A'}});
  await assert.rejects(()=>billing.saveIssuer(actor,{...cmd(),revision:1,data:{...issuer,phone:'B'}}),e=>(e as any).code==='VERSION_CONFLICT');
 }
 await billing.transition(actor,doc.id,{...cmd(),revision:1,state:'READY'});
 await domain.updateClient(actor,client,{...cmd(),name:'Cambio QA',legalName:'Razón social nueva',taxId:'80012345-1',address:'Dirección nueva'});
 assert.equal((await billing.read(actor,doc.id)).customer.legalName,'Cliente sintético S.A.','confirmed snapshot is immutable');
 await assert.rejects(()=>billing.save(actor,doc.id,{...cmd(),revision:2,data:input}),e=>(e as any).code==='VERSION_CONFLICT');
 await assert.rejects(()=>billing.transition(actor,doc.id,{...cmd(),revision:1,state:'VOID'}),e=>(e as any).code==='VERSION_CONFLICT');
 await billing.transition(actor,doc.id,{...cmd(),revision:2,state:'VOID'});
 for(const role of ['OPERATIONS','DEPOT','DRIVER','CUSTOMER'] as const){
  const denied={...actor,role};
  await assert.rejects(()=>billing.list(denied),e=>(e as any).code==='FORBIDDEN');
  await assert.rejects(()=>billing.issuer(denied),e=>(e as any).code==='FORBIDDEN');
  await assert.rejects(()=>billing.save(denied,null,{...cmd(),revision:0,data:input}),e=>(e as any).code==='FORBIDDEN');
 }
 const other=randomUUID();await store.run('INSERT INTO organizations(id,name,timezone) VALUES(?,?,?)',other,'Otra QA','UTC');
 assert.equal((await billing.list({...actor,orgId:other})).items.length,0);
 await assert.rejects(()=>billing.read({...actor,orgId:other},doc.id),e=>(e as any).code==='NOT_FOUND');
 await assert.rejects(()=>billing.save({...actor,orgId:other},null,{...cmd(),revision:0,data:input}),e=>(e as any).code==='NOT_FOUND');
 await assert.rejects(()=>billing.save(actor,null,{...cmd(),revision:0,data:{...input,condition:'CREDIT'}}),/vencimiento/);
 await assert.rejects(()=>billing.save(actor,null,{...cmd(),revision:0,data:{...input,dueDate:'2026-10-17'}}),/anterior/);
 const shipment=(await domain.createShipment(actor,{...cmd(),clientId:client,reference:'QA-BILLING',originText:'QA',destinationText:'QA',recipientName:'QA',recipientPhone:'',proofPolicy:'RECEIVER',parcelCount:1,weightGrams:null,volumeCm3:null})).id;
 const linked={...input,lines:[{...input.lines[0],shipmentId:shipment}]};
 await assert.rejects(()=>billing.save(actor,null,{...cmd(),revision:0,data:linked}),/entregados/);
 await store.run("UPDATE parcels SET state='DELIVERED' WHERE shipment_id=? AND org_id=?",shipment,actor.orgId);
 assert.equal((await billing.candidates(actor,client)).length,1);
 const reserved=await billing.save(actor,null,{...cmd(),revision:0,data:linked});
 assert.equal((await billing.candidates(actor,client)).length,0);
 await assert.rejects(()=>billing.save(actor,null,{...cmd(),revision:0,data:linked}),/otra proforma/);
 assert.equal((await billing.list(actor)).items.length,2,'failed duplicate rolls back document and number');
 await billing.transition(actor,reserved.id,{...cmd(),revision:1,state:'VOID'});
 assert.equal((await billing.candidates(actor,client)).length,1);
 const next=await billing.save(actor,null,{...cmd(),revision:0,data:linked});
 assert.equal((await billing.read(actor,next.id)).reference,'PF-000003');
 assert.equal(billing.readiness().canIssue,false);
 return f;
}
