import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Actor} from './auth.ts';
import type {Database} from './database.ts';
import {Logistics} from './domain.ts';
import {Inventory} from './inventory.ts';
import {ensure} from './errors.ts';
const schema=z.object({commandId:z.uuid(),orderIds:z.array(z.uuid()).min(1).max(100),mode:z.enum(['RELEASE','REQUEUE']),confirmUnloaded:z.boolean().default(false)}).strict();
export async function correctDispatchOrders(db:Database,actor:Actor,input:unknown){
 const body=schema.parse(input),domain=new Logistics(db),inventory=new Inventory(db);
 ensure(new Set(body.orderIds).size===body.orderIds.length,'VALIDATION_ERROR','Hay pedidos repetidos en la selección.');
 return domain.command(actor,'routing.correctOrders',body,['ADMIN','OPERATIONS'],async()=>{
  let unloaded=0,released=0;const orders=[];
  for(const id of body.orderIds){
   const order=await domain.record('inventory_orders',id,actor);
   ensure(['RESERVED','PARTIALLY_LOADED','LOADED'].includes(order.status),'INVALID_TRANSITION',`El pedido ${order.external_id} ya no admite esta corrección. Una entrega despachada requiere un retorno.`);
   const assignments=await db.all(`SELECT a.route_id,a.parcel_id,r.state AS route_state,p.state,p.custody_type FROM route_assignments a JOIN parcels p ON p.id=a.parcel_id AND p.org_id=a.org_id JOIN routes r ON r.id=a.route_id AND r.org_id=a.org_id WHERE a.org_id=? AND p.shipment_id=? AND a.active=1 ORDER BY a.route_id,a.parcel_id`,actor.orgId,order.shipment_id);
   ensure(assignments.every(a=>['DRAFT','READY'].includes(a.route_state)),'INVALID_TRANSITION',`El pedido ${order.external_id} pertenece a un reparto que ya salió. Registrá su retorno.`);
   const loaded=assignments.filter(a=>a.state==='LOADED');
   ensure(!loaded.length||body.confirmUnloaded,'PHYSICAL_UNLOAD_REQUIRED','Confirmá que bajaste físicamente los bultos al depósito antes de cambiar la reserva.');
   for(const routeId of new Set(loaded.map(a=>a.route_id))){
    const ids=loaded.filter(a=>a.route_id===routeId).map(a=>a.parcel_id);
    for(let i=0;i<ids.length;i+=200)await domain.unloadSelected(actor,routeId,{commandId:randomUUID(),expectedVersion:(await domain.route(routeId,actor)).version,parcelIds:ids.slice(i,i+200)});
   }
   unloaded+=loaded.length;
   if(body.mode==='RELEASE'){const result=await inventory.unreserveOrder(actor,id,{commandId:randomUUID()});released+=result.released;}
   else for(const routeId of new Set(assignments.map(a=>a.route_id))){
    const ids=assignments.filter(a=>a.route_id===routeId).map(a=>a.parcel_id);
    for(let i=0;i<ids.length;i+=200)await domain.unassignSelected(actor,routeId,{commandId:randomUUID(),expectedVersion:(await domain.route(routeId,actor)).version,parcelIds:ids.slice(i,i+200)});
   }
   orders.push({id,reference:order.external_id});
  }
  return {id:body.commandId,orders,unloaded,released,mode:body.mode};
 });
}
