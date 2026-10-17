import type {Express,Request} from 'express';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Database} from './database.ts';
import {authorize,type Actor} from './auth.ts';
import {ensure} from './errors.ts';
import {Logistics} from './domain.ts';
import {camel} from './db.ts';

export function installLivePortal(app:Express,store:Database,auth:(req:Request)=>Promise<Actor>) {
  const domain=new Logistics(store);
  const admin=async(req:Request)=>{const actor=await auth(req);authorize(actor,['ADMIN']);ensure(store.kind==='postgres','UNAVAILABLE','El portal Google requiere la base real de Supabase.',503);return actor;};
  app.get('/api/customer-google-access',async(req,res)=>{
    const actor=await auth(req);authorize(actor,['ADMIN']);
    if(store.kind!=='postgres'){res.json({available:false,items:[],requests:[]});return;}
    const items=await store.all('SELECT m.user_id,m.status,c.os_client_id AS client_id,c.name AS client_name,m.email FROM public.portal_memberships m JOIN public.portal_companies c ON c.id=m.company_id WHERE c.os_org_id=? ORDER BY c.name,m.email',actor.orgId);
    const requests=await store.all('SELECT r.id,r.reference,r.origin_text,r.destination_text,r.recipient_name,r.recipient_phone,r.parcel_count,r.status,r.created_at,c.name AS client_name FROM public.portal_shipping_requests r JOIN public.portal_companies c ON c.id=r.company_id WHERE c.os_org_id=? ORDER BY r.created_at DESC LIMIT 200',actor.orgId);
    res.json({available:true,items:items.map(camel),requests:requests.map(camel)});
  });
  app.post('/api/customer-google-access',async(req,res)=>{
    const actor=await admin(req),body=z.object({commandId:z.uuid(),clientId:z.uuid(),email:z.email().max(254)}).parse(req.body);
    res.json(await domain.command(actor,'portal.google.grant',body,['ADMIN'],async()=>{
      const client=await domain.record('clients',body.clientId,actor);
      const user=await store.one('SELECT nexora.portal_registered_user(?) AS id',body.email);
      ensure(user?.id,'NOT_FOUND','Esa cuenta debe ingresar primero con Google desde la web de Nexora.',404);
      const existing=await store.one('SELECT m.user_id,c.os_org_id FROM public.portal_memberships m JOIN public.portal_companies c ON c.id=m.company_id WHERE m.user_id=?',user.id);
      ensure(!existing||existing.os_org_id===actor.orgId,'FORBIDDEN','La cuenta ya tiene una vinculación que debe revisar Administración.',403);
      let company=await store.one('SELECT id FROM public.portal_companies WHERE os_org_id=? AND os_client_id=?',actor.orgId,client.id);
      if(!company){company={id:randomUUID()};await store.run('INSERT INTO public.portal_companies(id,name,os_org_id,os_client_id) VALUES(?,?,?,?)',company.id,client.name,actor.orgId,client.id);}
      if(existing)await store.run("UPDATE public.portal_memberships SET company_id=?,status='active',email=? WHERE user_id=?",company.id,body.email.toLowerCase(),user.id);
      else await store.run("INSERT INTO public.portal_memberships(user_id,company_id,status,email) VALUES(?,?,'active',?)",user.id,company.id,body.email.toLowerCase());
      return {userId:user.id,companyId:company.id};
    }));
  });
  app.post('/api/customer-google-access/:id/revoke',async(req,res)=>{
    const actor=await admin(req),id=z.uuid().parse(req.params.id),body=z.object({commandId:z.uuid()}).parse(req.body);
    res.json(await domain.command(actor,`portal.google.${id}.revoke`,body,['ADMIN'],async()=>{
      const account=await store.one('SELECT m.user_id FROM public.portal_memberships m JOIN public.portal_companies c ON c.id=m.company_id WHERE m.user_id=? AND c.os_org_id=?',id,actor.orgId);
      ensure(account,'NOT_FOUND','Acceso no encontrado.',404);
      await store.run("UPDATE public.portal_memberships SET status='suspended' WHERE user_id=?",id);
      return {userId:id,status:'suspended'};
    }));
  });
  app.post('/api/customer-shipping-requests/:id/accept',async(req,res)=>{
    const actor=await admin(req),id=z.uuid().parse(req.params.id);
    const accepted=await store.transaction(async()=>{
    const request=await store.one('SELECT r.*,c.os_client_id FROM public.portal_shipping_requests r JOIN public.portal_companies c ON c.id=r.company_id WHERE r.id=? AND c.os_org_id=?',id,actor.orgId);
    ensure(request,'NOT_FOUND','Solicitud no encontrada.',404);
    ensure(request.status!=='REJECTED','INVALID_TRANSITION','La solicitud fue rechazada.',409);
    if(request.shipment_id)return {id:request.shipment_id};
    const result=await domain.createShipment(actor,{commandId:id,clientId:request.os_client_id,reference:request.reference,originText:request.origin_text,destinationText:request.destination_text,recipientName:request.recipient_name,recipientPhone:request.recipient_phone,parcelCount:request.parcel_count,weightGrams:null,volumeCm3:null,proofPolicy:'RECEIVER'});
    await store.run("UPDATE public.portal_shipping_requests SET status='ACCEPTED',shipment_id=?,updated_at=? WHERE id=?",result.id,new Date().toISOString(),id);
    await store.run('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)',randomUUID(),actor.orgId,actor.id,'portal.requests.accept',id,id,JSON.stringify({shipmentId:result.id}),new Date().toISOString());
    return result;
    });
    res.json(accepted);
  });
}
