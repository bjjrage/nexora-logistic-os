import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Actor} from './auth.ts';
import type {Database,Row} from './database.ts';
import {Logistics} from './domain.ts';
import {Routing} from './routing.ts';
import {ensure} from './errors.ts';
const schema=z.object({commandId:z.uuid(),proposalCommandId:z.uuid(),orderIds:z.array(z.uuid()).min(1).max(1000)}).strict();
/** Only accept points returned by this tenant's saved preflight, after explicit operator review. */
export async function confirmDispatchLocations(db:Database,actor:Actor,input:unknown){
 const body=schema.parse(input),domain=new Logistics(db),routing=new Routing(db);
 return domain.command(actor,'routing.confirmLocations',body,['ADMIN','OPERATIONS'],async()=>{
  const cached=await db.one("SELECT response FROM idempotency WHERE org_id=? AND command_id=? AND actor_id=? AND operation='routing.organizeReserved'",actor.orgId,body.proposalCommandId,actor.id);
  ensure(cached,'STALE_PLAN','La propuesta de ubicaciones ya no está disponible. Volvé a organizar.');
  const suggestions:Row[]=JSON.parse(cached.response).locationSuggestions??[];
  const locations:Row[]=[];ensure(new Set(body.orderIds).size===body.orderIds.length,'VALIDATION_ERROR','Hay ubicaciones repetidas.');
  for(const id of body.orderIds){
   const suggestion=suggestions.find(s=>s.id===id);ensure(suggestion&&['EXACT','STREET','AREA'].includes(suggestion.precision),'VALIDATION_ERROR','Una ubicación seleccionada no pertenece a esta propuesta.');
   const order=await domain.record('inventory_orders',id,actor);
   ensure(order.status==='RESERVED'&&order.destination===suggestion.destination&&order.updated_at===suggestion.updatedAt,'STALE_PLAN','Cambió un pedido de la propuesta. Volvé a organizar antes de confirmar ubicaciones.');
   ensure(!await db.one("SELECT entity_id FROM routing_points WHERE org_id=? AND entity_kind='ORDER' AND entity_id=? AND address=?",actor.orgId,id,order.destination),'STALE_PLAN','Una dirección ya fue ubicada por otra persona. Actualizá la organización.');
   await routing.point(actor,{commandId:randomUUID(),kind:'ORDER',id,latitude:suggestion.latitude,longitude:suggestion.longitude});
   const saved=await db.one("SELECT updated_at FROM routing_points WHERE org_id=? AND entity_kind='ORDER' AND entity_id=?",actor.orgId,id);
   locations.push({id,precision:suggestion.precision,label:suggestion.label,updatedAt:saved!.updated_at});
  }
  return {id:body.commandId,confirmed:body.orderIds.length,locations};
 });
}
