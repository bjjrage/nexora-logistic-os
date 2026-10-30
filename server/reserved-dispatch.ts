import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {authorize,type Actor} from './auth.ts';
import type {Database,Row} from './database.ts';
import {ensure} from './errors.ts';
import {Logistics} from './domain.ts';
import {Routing} from './routing.ts';
import type {RoutingProviders} from './routing-providers.ts';
import {dispatchBoard,orderLines} from './dispatch-board.ts';
import {prepareAppend,applyAppend} from './dispatch-append.ts';
const roles:Actor['role'][]=['ADMIN','OPERATIONS'];
const inputSchema=z.object({commandId:z.uuid(),reviewedInstructions:z.array(z.object({orderId:z.uuid(),text:z.string().max(4000)})).max(1000).default([]),date:z.iso.date().optional(),startAt:z.iso.datetime({offset:true}).optional(),endAt:z.iso.datetime({offset:true}).optional()}).strict();
const fingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function morning(date:string,timezone:string){
 const target=Date.parse(date+'T08:00:00Z');let instant=target;
 for(let i=0;i<3;i++){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(instant);const p=(name:string)=>parts.find(x=>x.type===name)!.value;const wall=Date.parse(`${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}:${p('second')}Z`);instant+=target-wall;}
 return new Date(instant).toISOString();
}
export class ReservedDispatch{
 private routing:Routing;
 private db:Database;
 constructor(db:Database,providers?:RoutingProviders){this.db=db;this.routing=new Routing(db,providers);}
 async queue(actor:Actor,date?:string){
  authorize(actor,roles);
  const org=await this.db.one('SELECT timezone FROM organizations WHERE id=?',actor.orgId);
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:org!.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  date=z.iso.date().parse(date??today);
  const orders=await this.db.all(`SELECT o.id,o.client_id,o.external_id,o.recipient_name,o.destination,o.order_date,o.updated_at,o.restrictions,c.name AS client_name,p.delivery_provider FROM inventory_orders o JOIN clients c ON c.id=o.client_id AND c.org_id=o.org_id LEFT JOIN client_delivery_policies p ON p.client_id=o.client_id AND p.org_id=o.org_id WHERE o.org_id=? AND o.status='RESERVED' AND o.order_date<=? AND NOT EXISTS(SELECT 1 FROM route_assignments a JOIN parcels q ON q.id=a.parcel_id AND q.org_id=a.org_id WHERE a.org_id=o.org_id AND q.shipment_id=o.shipment_id AND a.active=1) ORDER BY o.created_at,o.rowid LIMIT 1001`,actor.orgId,date);
  ensure(orders.length<=1000,'PLAN_LIMIT','Hay más de 1000 reservas pendientes. Organizá por jornadas para reducir el lote.');
  const ids=orders.map(o=>o.id),lines=await orderLines(this.db,actor,ids);
  const locations=ids.length?await this.db.all(`SELECT DISTINCT order_id,location_id FROM inventory_order_parcels WHERE org_id=? AND state='RESERVED' AND order_id IN(${ids.map(()=>'?').join(',')}) ORDER BY order_id,location_id`,actor.orgId,...ids):[];
  for(const order of orders){const places=locations.filter(l=>l.order_id===order.id);order.locationId=places.length===1?places[0].location_id:null;order.lines=lines.filter(l=>l.order_id===order.id);}
  return {date,today,timezone:org!.timezone,orders};
 }
 async board(actor:Actor,date?:string){return dispatchBoard(this.db,actor,await this.queue(actor,date));}
 private async free(actor:Actor,field:'vehicle_id'|'driver_id',id:string,start:string,end:string){
  const route=await this.db.one(`SELECT r.id FROM routes r WHERE r.org_id=? AND r.${field}=? AND r.state<>'OPERATIONALLY_CLOSED' AND (r.state='IN_PROGRESS' OR(r.start_at<? AND r.end_at>?)) AND (r.state<>'DRAFT' OR EXISTS(SELECT 1 FROM route_assignments a WHERE a.org_id=r.org_id AND a.route_id=r.id AND a.active=1)) LIMIT 1`,actor.orgId,id,end,start);
  if(route)return false;
  return field!=='vehicle_id'||!await this.db.one("SELECT id FROM parcels WHERE org_id=? AND custody_type='VEHICLE' AND custody_id=? LIMIT 1",actor.orgId,id);
 }
 async organize(actor:Actor,input:unknown){
  authorize(actor,roles);const body=inputSchema.parse(input),domain=new Logistics(this.db);
  // Resolve idempotency before geocoding/solving. Reused keys still validate actor and payload.
  if(await this.db.one('SELECT command_id FROM idempotency WHERE org_id=? AND command_id=?',actor.orgId,body.commandId))return domain.command(actor,'routing.organizeReserved',body,roles,()=>{throw new Error('Missing cached response');});
  const queue=await this.queue(actor,body.date),context=await this.routing.context(actor);
  ensure(queue.date>=queue.today||body.startAt,'VALIDATION_ERROR','Elegí hoy o una fecha futura para la salida. Los pedidos atrasados se incluyen automáticamente.');
  const start=body.startAt??(queue.date===queue.today?new Date().toISOString():morning(queue.date,queue.timezone));
  const end=body.endAt??new Date(Date.parse(start)+10*3600000).toISOString();
  const locationSuggestions:Row[]=[],pending:Row[]=[],plans:Row[]=[],merges:NonNullable<Awaited<ReturnType<typeof prepareAppend>>>[]=[],usedVehicles=new Set<string>(),usedDrivers=new Set<string>();
  const groups=new Map<string,Row[]>();
  for(const order of queue.orders){
   const reason=order.delivery_provider!=='NEXORA'?'Circuito externo o sin definir':!order.locationId?'La reserva está repartida entre sectores; consolidá la mercadería antes de organizar':!context.locations.some(l=>l.id===order.locationId)?'Depósito inactivo':!context.points.some(p=>p.kind==='LOCATION'&&p.id===order.locationId)?'Configurar ubicación del depósito en Mi empresa':null;
   if(reason){pending.push({...order,reason});continue;}
   groups.set(order.locationId,[...(groups.get(order.locationId)??[]),order]);
  }
  for(const [locationId,group] of groups){
   const orders:Row[]=[],deadline=Date.now()+45000;
   for(const order of group){
    let point=await this.db.one("SELECT latitude,longitude FROM routing_points WHERE org_id=? AND entity_kind='ORDER' AND entity_id=? AND address=?",actor.orgId,order.id,order.destination);
    if(!point&&Date.now()<deadline){try{const matches=await this.routing.search(actor,{address:order.destination});if(matches.length===1&&matches[0].addressRank>=30&&!matches[0].approximate){point=matches[0];await this.routing.point(actor,{commandId:randomUUID(),kind:'ORDER',id:order.id,latitude:matches[0].latitude,longitude:matches[0].longitude});}else{const street=matches.find(m=>m.precision==='STREET'||m.precision==='AREA'&&m.addressRank>=21);if(street)locationSuggestions.push({id:order.id,reference:order.external_id,recipientName:order.recipient_name,destination:order.destination,updatedAt:order.updated_at,label:street.name,latitude:street.latitude,longitude:street.longitude,precision:street.precision});}}catch{/* Leave uncertain destinations pending. */}}
    if(point)orders.push(order);else pending.push({...order,reason:'Confirmar ubicación del destinatario'});
   }
   const candidates=await this.db.all("SELECT id,vehicle_id,driver_id FROM routes WHERE org_id=? AND state IN('DRAFT','READY') AND start_at<? AND end_at>? ORDER BY start_at,id",actor.orgId,end,start);
   for(const route of candidates){
    if(!orders.length)break;if(usedVehicles.has(route.vehicle_id)||usedDrivers.has(route.driver_id))continue;
    const merge=await prepareAppend(this.db,this.routing,actor,route.id,locationId,orders.map(o=>o.id),body.reviewedInstructions);
    if(merge){merges.push(merge);usedVehicles.add(route.vehicle_id);usedDrivers.add(route.driver_id);for(const accepted of merge.accepted){const i=orders.findIndex(o=>o.id===accepted.id);if(i>=0)orders.splice(i,1);}}
   }
   for(let offset=0;offset<orders.length;offset+=80){
    const batch=orders.slice(offset,offset+80),fleet:Array<{vehicleId:string;driverId:string}>=[];
    const drivers=[];
    for(const driver of context.drivers)if(!usedDrivers.has(driver.id)&&await this.free(actor,'driver_id',driver.id,start,end))drivers.push(driver);
    for(const vehicle of context.vehicles){
     if(fleet.length===8)break;
     if(usedVehicles.has(vehicle.id)||!await this.free(actor,'vehicle_id',vehicle.id,start,end))continue;
     const preferred=context.defaults.fleet.find(f=>f.vehicleId===vehicle.id)?.driverId;
     const driver=drivers.find(d=>d.id===preferred&&!fleet.some(f=>f.driverId===d.id))??drivers.find(d=>!fleet.some(f=>f.driverId===d.id));
     if(driver)fleet.push({vehicleId:vehicle.id,driverId:driver.id});
    }
    if(!fleet.length){pending.push(...batch.map(o=>({...o,reason:'No hay camión y chofer disponibles para esta salida'})));continue;}
    const plan=await this.routing.suggest(actor,{date:queue.date,locationId,orderIds:batch.map(o=>o.id),reservedOnly:true,reviewedInstructions:body.reviewedInstructions,startAt:start,endAt:end,fleet,allowUnknownCapacity:true});
    pending.push(...plan.pending);
    if(plan.id&&plan.routes.length){plans.push(plan);for(const route of plan.routes){usedVehicles.add(route.vehicleId);usedDrivers.add(route.driverId);}}
   }
  }
  return domain.command(actor,'routing.organizeReserved',body,roles,async()=>{
   ensure(fingerprint((await this.queue(actor,queue.date)).orders)===fingerprint(queue.orders),'STALE_PLAN','Cambiaron las reservas mientras se organizaba. Volvé a organizar; no se aplicó una distribución parcial.');
   const routes:Row[]=[];
   for(const merge of merges)routes.push(await applyAppend(this.db,actor,merge));
   for(const plan of plans){const applied=await this.routing.apply(actor,{commandId:randomUUID(),planId:plan.id});routes.push(...applied.routes.map((r:Row,i:number)=>({...r,plate:plan.routes[i].plate,driverName:plan.routes[i].driverName,stops:plan.routes[i].stops,capacityUnverified:plan.capacityUnverified})));}
   const nextDay=new Date(Date.parse(queue.today+'T00:00:00Z')+86400000).toISOString().slice(0,10),nextStart=morning(nextDay,queue.timezone);
   const nextDeparture=pending.some(p=>p.reason?.includes('Horario de entrega fuera'))?{startAt:nextStart,endAt:new Date(Date.parse(nextStart)+10*3600000).toISOString(),label:new Intl.DateTimeFormat('es-PY',{timeZone:queue.timezone,dateStyle:'short',timeStyle:'short'}).format(new Date(nextStart))}:null;
   return {id:body.commandId,date:queue.date,locationSuggestions,nextDeparture,organized:routes.reduce((n,r)=>n+(r.newOrders??r.orders),0),routes,pending};
  });
 }
}
