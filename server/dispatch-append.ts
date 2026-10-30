import {createHash,randomUUID} from 'node:crypto';
import type {Database,Row} from './database.ts';
import type {Actor} from './auth.ts';
import {Logistics} from './domain.ts';
import {Routing} from './routing.ts';
import {ensure} from './errors.ts';
export const signature=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
// Append to a preparing truck without moving or reordering its existing cargo.
export async function appendModel(db:Database,actor:Actor,routeId:string,locationId:string,ids:string[]){
 const route=await db.one("SELECT r.*,v.plate,v.capacity_weight_grams,v.capacity_volume_cm3,d.name AS driver_name FROM routes r JOIN vehicles v ON v.id=r.vehicle_id AND v.org_id=r.org_id JOIN drivers d ON d.id=r.driver_id AND d.org_id=r.org_id JOIN route_tracking_settings t ON t.route_id=r.id AND t.org_id=r.org_id WHERE r.id=? AND r.org_id=? AND r.state IN('DRAFT','READY') AND t.provider='TRACCAR' AND v.available=1 AND d.available=1 AND EXISTS(SELECT 1 FROM users u WHERE u.org_id=r.org_id AND u.driver_id=r.driver_id AND u.enabled=1)",routeId,actor.orgId);
 if(!route||Date.parse(route.end_at)<=Date.now())return null;
 if(await db.one("SELECT r.id FROM routes r WHERE r.org_id=? AND r.id<>? AND (r.vehicle_id=? OR r.driver_id=?) AND r.state<>'OPERATIONALLY_CLOSED' AND (r.state='IN_PROGRESS' OR(r.start_at<? AND r.end_at>?)) AND (r.state<>'DRAFT' OR EXISTS(SELECT 1 FROM route_assignments a WHERE a.route_id=r.id AND a.org_id=r.org_id AND a.active=1)) LIMIT 1",actor.orgId,routeId,route.vehicle_id,route.driver_id,route.end_at,route.start_at))return null;
 const stops=await db.all('SELECT * FROM stops WHERE route_id=? AND org_id=? ORDER BY sequence',routeId,actor.orgId);
 if(!stops.length||stops.some(s=>s.kind!=='DELIVERY'||s.state!=='PENDING'))return null;
 const cargo=await db.all('SELECT p.*,a.pickup FROM parcels p JOIN route_assignments a ON a.parcel_id=p.id AND a.org_id=p.org_id WHERE a.route_id=? AND a.org_id=? AND a.active=1 ORDER BY p.id',routeId,actor.orgId);
 if(cargo.some(p=>p.pickup||!['RECEIVED','LOADED'].includes(p.state)||p.state==='RECEIVED'&&(p.custody_type!=='DEPOT'||p.custody_id!==locationId)||p.state==='LOADED'&&(p.custody_type!=='VEHICLE'||p.custody_id!==route.vehicle_id)))return null;
 if(await db.one("SELECT p.id FROM parcels p WHERE p.org_id=? AND p.custody_type='VEHICLE' AND p.custody_id=? AND NOT EXISTS(SELECT 1 FROM route_assignments a WHERE a.org_id=p.org_id AND a.parcel_id=p.id AND a.route_id=? AND a.active=1) LIMIT 1",actor.orgId,route.vehicle_id,routeId))return null;
 const base=await db.one("SELECT latitude,longitude FROM routing_points WHERE org_id=? AND entity_kind='LOCATION' AND entity_id=?",actor.orgId,locationId);if(!base)return null;
 const existing:Row[]=[],fresh:Row[]=[];
 const load=async(id:string,byShipment=false)=>{
  const order=await db.one(`SELECT o.*,c.name AS client_name FROM inventory_orders o JOIN clients c ON c.id=o.client_id AND c.org_id=o.org_id JOIN client_delivery_policies p ON p.client_id=o.client_id AND p.org_id=o.org_id WHERE o.${byShipment?'shipment_id':'id'}=? AND o.org_id=? AND p.delivery_provider='NEXORA'`,id,actor.orgId);if(!order||order.restrictions)return null;
  const point=await db.one("SELECT latitude,longitude FROM routing_points WHERE org_id=? AND entity_kind='ORDER' AND entity_id=? AND address=?",actor.orgId,order.id,order.destination);if(!point)return null;
  const parcels=await db.all('SELECT * FROM inventory_order_parcels WHERE org_id=? AND order_id=? ORDER BY id',actor.orgId,order.id);
  const lines=await db.all('SELECT l.quantity,p.name,p.sku,p.weight_grams,p.volume_cm3 FROM inventory_order_lines l JOIN inventory_products p ON p.id=l.product_id AND p.org_id=l.org_id WHERE l.org_id=? AND l.order_id=? ORDER BY l.id',actor.orgId,order.id);
  if(parcels.length!==lines.reduce((n,l)=>n+l.quantity,0)||parcels.some(p=>p.location_id!==locationId||!['RESERVED','VEHICLE'].includes(p.state)))return null;
  if(byShipment?parcels.some(p=>!cargo.some(c=>c.id===p.parcel_id)):parcels.some(p=>p.state!=='RESERVED'))return null;
  return {...order,...point,lines,parcels};
 };
 for(const stop of stops){const order=await load(stop.shipment_id,true);if(!order)return null;existing.push(order);}
 for(const id of ids){const order=await load(id);if(order)fresh.push(order);}
 if(!fresh.length||existing.length>=80)return null;
 const org=await db.one('SELECT timezone FROM organizations WHERE id=?',actor.orgId);
 return {route,cargo,base,existing,fresh:fresh.slice(0,80-existing.length),timezone:org!.timezone};
}
export async function prepareAppend(db:Database,routing:Routing,actor:Actor,routeId:string,locationId:string,ids:string[]){
 const model=await appendModel(db,actor,routeId,locationId,ids);if(!model)return null;
 const orders=[...model.existing,...model.fresh],matrix=await routing.matrix(actor,{points:[model.base,...orders.map(o=>({latitude:o.latitude,longitude:o.longitude}))]});
 const start=Math.max(Date.now(),Date.parse(model.route.start_at)),horizon=Math.floor((Date.parse(model.route.end_at)-start)/1000);
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:model.timezone,hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(start),p=(key:string)=>Number(parts.find(x=>x.type===key)!.value),startSeconds=p('hour')*3600+p('minute')*60+p('second');
 let time=0,previous=0,weight=0,volume=0,validUntil=Date.parse(model.route.end_at);const accepted:Row[]=[],sequence:Row[]=[];
 for(let i=0;i<orders.length;i++){
  const order=orders[i],w=order.lines.reduce((n:number,l:Row)=>n+(l.weight_grams??0)*l.quantity,0),v=order.lines.reduce((n:number,l:Row)=>n+(l.volume_cm3??0)*l.quantity,0),seconds=(s:string)=>Number(s.slice(0,2))*3600+Number(s.slice(3))*60-startSeconds;
  const arrival=Math.max(time+matrix[previous][i+1],order.window_start?seconds(order.window_start):0),departure=arrival+(order.service_minutes??10)*60;
  const fits=weight+w<=model.route.capacity_weight_grams&&volume+v<=model.route.capacity_volume_cm3&&arrival<=(order.window_end?seconds(order.window_end):horizon)&&departure+matrix[i+1][0]<=horizon;
  if(!fits){if(i<model.existing.length)return null;continue;}
  validUntil=Math.min(validUntil,start+((order.window_end?seconds(order.window_end):horizon)-arrival)*1000);
  time=departure;previous=i+1;weight+=w;volume+=v;sequence.push(order);if(i>=model.existing.length)accepted.push(order);
 }
 validUntil=Math.min(validUntil,Date.parse(model.route.end_at)-(time+matrix[previous][0])*1000);
 return accepted.length?{routeId,locationId,ids,hash:signature(model),accepted,sequence,validUntil}:null;
}
export async function applyAppend(db:Database,actor:Actor,plan:NonNullable<Awaited<ReturnType<typeof prepareAppend>>>){
 const model=await appendModel(db,actor,plan.routeId,plan.locationId,plan.ids);
 ensure(model&&signature(model)===plan.hash&&Date.now()<=plan.validUntil,'STALE_PLAN','Cambió el camión o su margen horario. Volvé a organizar; no se aplicó una distribución parcial.');
 const domain=new Logistics(db);await domain.routeAvailability(model.route,actor,false);
 for(const order of plan.accepted){const route=await domain.route(plan.routeId,actor);await domain.assign(actor,plan.routeId,{commandId:randomUUID(),expectedVersion:route.version,parcelIds:order.parcels.map((p:Row)=>p.parcel_id),pickup:false});}
 await domain.capacity(await domain.route(plan.routeId,actor),actor);
 return {id:plan.routeId,name:model.route.name,plate:model.route.plate,driverName:model.route.driver_name,orders:plan.sequence.length,newOrders:plan.accepted.length,capacityUnverified:plan.sequence.some(o=>o.lines.some((l:Row)=>l.weight_grams==null||l.volume_cm3==null)),stops:plan.sequence.map(o=>({orderId:o.id,recipientName:o.recipient_name,reference:o.external_id,lines:o.lines}))};
}
