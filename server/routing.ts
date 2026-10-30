import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Database,Row} from './database.ts';
import {authorize,type Actor} from './auth.ts';
import {ensure} from './errors.ts';
import {Logistics} from './domain.ts';
import {Inventory} from './inventory.ts';
import {routingProviders,type RoutingProviders} from './routing-providers.ts';
const roles:Actor['role'][]=['ADMIN','OPERATIONS'];
const timestamp=()=>new Date().toISOString();
const digest=(data:unknown)=>createHash('sha256').update(JSON.stringify(data)).digest('hex');
const inputSchema=z.object({date:z.iso.date(),locationId:z.uuid(),clientId:z.uuid().optional(),orderIds:z.array(z.uuid()).min(1).max(80).optional(),startAt:z.iso.datetime({offset:true}),endAt:z.iso.datetime({offset:true}),allowUnknownCapacity:z.boolean().default(false),fleet:z.array(z.object({vehicleId:z.uuid(),driverId:z.uuid()})).min(1).max(8)}).superRefine((v,c)=>{
 if(new Set(v.fleet.map(f=>f.vehicleId)).size!==v.fleet.length||new Set(v.fleet.map(f=>f.driverId)).size!==v.fleet.length)c.addIssue({code:'custom',message:'Cada vehículo y chofer debe aparecer una sola vez.'});
 const duration=Date.parse(v.endAt)-Date.parse(v.startAt);if(duration<=0||duration>16*3600000)c.addIssue({code:'custom',message:'La jornada debe durar entre 1 minuto y 16 horas.'});
});
const pointSchema=z.object({commandId:z.uuid(),kind:z.enum(['ORDER','LOCATION']),id:z.uuid(),latitude:z.number().finite().min(-90).max(90),longitude:z.number().finite().min(-180).max(180)});
const outputSchema=z.object({routes:z.array(z.object({vehicleId:z.uuid(),driverId:z.uuid(),durationSeconds:z.number().int().nonnegative(),stops:z.array(z.object({orderId:z.uuid(),arrivalSeconds:z.number().int().nonnegative()})).min(1)})),unassigned:z.array(z.uuid())});
export class Routing {
 private store:Database;
 private providers:RoutingProviders;
 constructor(store:Database,providers:RoutingProviders=routingProviders){this.store=store;this.providers=providers;}
 async context(actor:Actor){
  authorize(actor,roles);
  const locations=await this.store.all("SELECT id,code,name FROM inventory_locations WHERE org_id=? AND active=1 AND kind<>'QUARANTINE' ORDER BY code",actor.orgId);
  const vehicles=await this.store.all('SELECT id,plate FROM vehicles WHERE org_id=? AND available=1 ORDER BY plate',actor.orgId);
  const drivers=await this.store.all('SELECT d.id,d.name FROM drivers d WHERE d.org_id=? AND d.available=1 AND EXISTS(SELECT 1 FROM users u WHERE u.org_id=d.org_id AND u.driver_id=d.id AND u.enabled=1) ORDER BY d.name',actor.orgId);
  const last=await this.store.one('SELECT input FROM routing_plans WHERE org_id=? ORDER BY created_at DESC LIMIT 1',actor.orgId);
  const defaults=last?JSON.parse(last.input):{};
  const fleet=[];const used=new Set<string>();
  for(const vehicle of vehicles){
   const previous=await this.store.one('SELECT driver_id FROM routes WHERE org_id=? AND vehicle_id=? ORDER BY start_at DESC,id DESC LIMIT 1',actor.orgId,vehicle.id);
   const driverId=previous?.driver_id??defaults.fleet?.find((f:Row)=>f.vehicleId===vehicle.id)?.driverId;
   if(driverId&&drivers.some(d=>d.id===driverId)&&!used.has(driverId)){fleet.push({vehicleId:vehicle.id,driverId});used.add(driverId);}
  }
  if(!fleet.length&&vehicles.length===1&&drivers.length===1)fleet.push({vehicleId:vehicles[0].id,driverId:drivers[0].id});
  return {locations,vehicles,drivers,defaults:{locationId:defaults.locationId??(locations.length===1?locations[0].id:''),fleet},points:await this.store.all('SELECT entity_kind AS kind,entity_id AS id,address,latitude,longitude FROM routing_points WHERE org_id=?',actor.orgId),configured:{roads:!!process.env.ROUTING_OSRM_URL,addresses:!!process.env.ROUTING_NOMINATIM_URL}};
 }
 async point(actor:Actor,input:unknown){
  authorize(actor,roles);const b=pointSchema.parse(input),domain=new Logistics(this.store);
  return domain.command(actor,'routing.point',b,roles,async()=>{
   const row=await domain.record(b.kind==='ORDER'?'inventory_orders':'inventory_locations',b.id,actor);
   if(b.kind==='ORDER')ensure(['DRAFT','RESERVED'].includes(row.status),'INVALID_TRANSITION','El pedido ya fue cargado o despachado.');
   const address=b.kind==='ORDER'?row.destination:row.code+' · '+row.name;
   await this.store.run('INSERT INTO routing_points VALUES(?,?,?,?,?,?,?) ON CONFLICT(org_id,entity_kind,entity_id) DO UPDATE SET address=excluded.address,latitude=excluded.latitude,longitude=excluded.longitude,updated_at=excluded.updated_at',actor.orgId,b.kind,b.id,address,b.latitude,b.longitude,timestamp());
   return {id:b.id};
  });
 }
 async search(actor:Actor,input:unknown){authorize(actor,roles);const b=z.object({address:z.string().trim().min(3).max(500)}).parse(input);return this.providers.search(b.address);}
 async suggest(actor:Actor,input:unknown){
  authorize(actor,roles);const b=inputSchema.parse(input);
  const fleet=[];
  for(const pair of b.fleet){
   const busy=await this.store.one("SELECT id FROM routes WHERE org_id=? AND state<>'OPERATIONALLY_CLOSED' AND (vehicle_id=? OR driver_id=?) AND (state='IN_PROGRESS' OR (start_at<? AND end_at>?)) AND (state<>'DRAFT' OR EXISTS(SELECT 1 FROM route_assignments a WHERE a.route_id=routes.id AND a.org_id=routes.org_id AND a.active=1)) LIMIT 1",actor.orgId,pair.vehicleId,pair.driverId,b.endAt,b.startAt);
   const onboard=await this.store.one("SELECT id FROM parcels WHERE org_id=? AND custody_type='VEHICLE' AND custody_id=? LIMIT 1",actor.orgId,pair.vehicleId);
   if(!busy&&!onboard)fleet.push(pair);
  }
  ensure(fleet.length,'VEHICLE_BUSY','Los camiones o choferes seleccionados están ocupados. Cambiá la selección o el horario aquí mismo.');
  const eligible=await this.orders(actor,b.date,b.clientId);
  const deadline=Date.now()+15000;
  for(const order of eligible.filter(o=>!b.orderIds||b.orderIds.includes(o.id))){
   if(Date.now()>deadline)break;
   const saved=await this.store.one("SELECT latitude,longitude FROM routing_points WHERE org_id=? AND entity_kind='ORDER' AND entity_id=? AND address=?",actor.orgId,order.id,order.destination);
   if(saved)continue;
   const reused=await this.store.one("SELECT latitude,longitude FROM routing_points WHERE org_id=? AND entity_kind='ORDER' AND address=? LIMIT 1",actor.orgId,order.destination);
   let match=reused;
   if(!match){try{const matches=await this.providers.search(order.destination);if(matches.length===1&&matches[0].addressRank>=30)match=matches[0];}catch{/* Keep the order pending for location review. */}}
   if(match)await this.point(actor,{commandId:randomUUID(),kind:'ORDER',id:order.id,latitude:match.latitude,longitude:match.longitude});
  }
  return this.preview(actor,{...b,fleet});
 }
 async matrix(actor:Actor,input:unknown){
  authorize(actor,roles);
  const b=z.object({points:z.array(z.object({latitude:z.number().finite().min(-90).max(90),longitude:z.number().finite().min(-180).max(180)})).min(1).max(81)}).parse(input);
  return this.providers.matrix(b.points);
 }
 async orders(actor:Actor,date:string,clientId?:string){
  authorize(actor,roles);z.iso.date().parse(date);if(clientId)z.uuid().parse(clientId);
  const rows=await this.store.all(`SELECT o.*,c.name AS client_name,p.delivery_provider FROM inventory_orders o JOIN clients c ON c.id=o.client_id AND c.org_id=o.org_id LEFT JOIN client_delivery_policies p ON p.org_id=o.org_id AND p.client_id=o.client_id WHERE o.org_id=? AND o.order_date=? AND o.status IN('DRAFT','RESERVED') ${clientId?'AND o.client_id=?':''} AND NOT EXISTS(SELECT 1 FROM route_assignments a JOIN parcels p ON p.id=a.parcel_id AND p.org_id=a.org_id WHERE a.org_id=o.org_id AND p.shipment_id=o.shipment_id AND a.active=1) ORDER BY o.created_at,o.rowid LIMIT 81`,...[actor.orgId,date,...(clientId?[clientId]:[])]);
  ensure(rows.length<=80,'PLAN_LIMIT','Hay más de 80 pedidos pendientes. Filtrá por cliente para planificar este lote.');
  return rows;
 }
 async model(actor:Actor,input:unknown){
  authorize(actor,roles);const b=inputSchema.parse(input),domain=new Logistics(this.store);
  const location=await domain.record('inventory_locations',b.locationId,actor);ensure(location.active&&location.kind!=='QUARANTINE','VALIDATION_ERROR','Elegí un depósito o sector activo.');
  const point=await this.store.one("SELECT * FROM routing_points WHERE org_id=? AND entity_kind='LOCATION' AND entity_id=?",actor.orgId,b.locationId);ensure(point&&point.address===location.code+' · '+location.name,'MISSING_DEPOT_POINT','Ubicá el depósito antes de organizar el reparto.');
  const organization=await this.store.one('SELECT * FROM organizations WHERE id=?',actor.orgId);
  const local=new Intl.DateTimeFormat('en-CA',{timeZone:organization!.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(b.startAt));
  const part=(name:string)=>local.find(p=>p.type===name)!.value;
  ensure(`${part('year')}-${part('month')}-${part('day')}`===b.date,'VALIDATION_ERROR','El inicio debe corresponder al día de los pedidos en la zona horaria de la empresa.');
  const startSeconds=Number(part('hour'))*3600+Number(part('minute'))*60+Number(part('second')),horizon=Math.floor((Date.parse(b.endAt)-Date.parse(b.startAt))/1000);
  const fleet=[];
  for(const pair of b.fleet){
   const vehicle=await domain.record('vehicles',pair.vehicleId,actor),driver=await domain.record('drivers',pair.driverId,actor);
   ensure(vehicle.available&&driver.available&&await this.store.one('SELECT id FROM users WHERE org_id=? AND driver_id=? AND enabled=1',actor.orgId,pair.driverId),'INVALID_TRANSITION','Elegí vehículos disponibles y choferes con acceso activo.');
   const busy=await this.store.one("SELECT r.name FROM routes r WHERE r.org_id=? AND r.state<>'OPERATIONALLY_CLOSED' AND (r.vehicle_id=? OR r.driver_id=?) AND (r.state='IN_PROGRESS' OR (r.start_at<? AND r.end_at>?)) AND (r.state<>'DRAFT' OR EXISTS(SELECT 1 FROM route_assignments a WHERE a.org_id=r.org_id AND a.route_id=r.id AND a.active=1)) LIMIT 1",actor.orgId,pair.vehicleId,pair.driverId,b.endAt,b.startAt);
   ensure(!busy,'VEHICLE_BUSY',`El chofer o el vehículo tiene la ruta «${busy?.name}» en ese horario.`);
   ensure(!await this.store.one("SELECT id FROM parcels WHERE org_id=? AND custody_type='VEHICLE' AND custody_id=? LIMIT 1",actor.orgId,pair.vehicleId),'VEHICLE_BUSY','El vehículo todavía tiene bultos a bordo.');
   fleet.push({...pair,plate:vehicle.plate,driverName:driver.name,capacityWeight:vehicle.capacity_weight_grams,capacityVolume:vehicle.capacity_volume_cm3});
  }
  const pending:Row[]=[],orders:Row[]=[],stock=new Map<string,number>();
  const eligible=await this.orders(actor,b.date,b.clientId);
  if(b.orderIds)ensure(b.orderIds.every(id=>eligible.some(o=>o.id===id)),'STALE_PLAN','Un pedido seleccionado ya tiene ruta o cambió de estado. Actualizá la lista.');
  const raw=b.orderIds?eligible.filter(o=>b.orderIds!.includes(o.id)):eligible;
  for(const row of raw){
   const item:Row={id:row.id,reference:row.external_id,clientName:row.client_name,recipientName:row.recipient_name,destination:row.destination,updatedAt:row.updated_at};
   const p=await this.store.one("SELECT * FROM routing_points WHERE org_id=? AND entity_kind='ORDER' AND entity_id=?",actor.orgId,row.id);
   let reason=row.delivery_provider!=='NEXORA'?'Circuito externo o sin definir':!p||p.address!==row.destination?'Confirmar ubicación del destinatario':row.restrictions?'Revisar restricciones especiales':null;
   const lines=await this.store.all('SELECT l.*,p.sku,p.name,p.tracking,p.active,p.weight_grams,p.volume_cm3 FROM inventory_order_lines l JOIN inventory_products p ON p.id=l.product_id AND p.org_id=l.org_id WHERE l.org_id=? AND l.order_id=? ORDER BY l.id',actor.orgId,row.id);
   item.lines=lines.map(l=>({name:l.name,sku:l.sku,quantity:l.quantity}));
   let weight=0,volume=0,unknown=false;const deductions:Array<[string,number]>=[];
   for(const line of lines){
    const key=row.client_id+':'+line.product_id;
    if(row.status==='DRAFT'){
     if(!stock.has(key)){
      const available=line.tracking==='SERIAL'?await this.store.one("SELECT COUNT(*) AS n FROM inventory_units WHERE org_id=? AND client_id=? AND product_id=? AND location_id=? AND status='AVAILABLE'",actor.orgId,row.client_id,line.product_id,b.locationId):await this.store.one("SELECT COALESCE(SUM(quantity),0) AS n FROM inventory_balances WHERE org_id=? AND client_id=? AND product_id=? AND location_id=? AND status='AVAILABLE' AND order_id=''",actor.orgId,row.client_id,line.product_id,b.locationId);
      stock.set(key,Number(available?.n??0));
     }
     if(stock.get(key)!<line.quantity)reason??='Falta stock completo en este depósito';
     deductions.push([key,line.quantity]);
    }else{
     const n=await this.store.one("SELECT COUNT(*) AS n FROM inventory_order_parcels WHERE org_id=? AND order_id=? AND product_id=? AND location_id=? AND state='RESERVED'",actor.orgId,row.id,line.product_id,b.locationId);
     if(Number(n?.n)!==line.quantity)reason??='La reserva está en otro depósito o incompleta';
    }
    if(!line.active)reason??='Producto archivado';
    unknown||=line.weight_grams==null||line.volume_cm3==null;weight+=(line.weight_grams??0)*line.quantity;volume+=(line.volume_cm3??0)*line.quantity;
   }
   if(unknown&&!b.allowUnknownCapacity)reason??='Revisar capacidad: faltan peso o volumen';
   const seconds=(s:string)=>Number(s.slice(0,2))*3600+Number(s.slice(3))*60-startSeconds;
   const window=[row.window_start?Math.max(0,seconds(row.window_start)):0,row.window_end?Math.min(horizon,seconds(row.window_end)):horizon];
   if(window[1]<window[0])reason??='Horario de entrega fuera de la jornada';
   if(reason){pending.push({...item,reason});continue;}
   for(const [key,n] of deductions)stock.set(key,stock.get(key)!-n);
   orders.push({...item,latitude:p!.latitude,longitude:p!.longitude,weight,volume,unknown,serviceSeconds:(row.service_minutes??10)*60,window});
  }
  return {input:b,point:{latitude:point.latitude,longitude:point.longitude},fleet,orders,pending,horizon};
 }
 async preview(actor:Actor,input:unknown){
  const model=await this.store.transaction(()=>this.model(actor,input));
  if(!model.orders.length)return {id:null,routes:[],pending:model.pending,capacityUnverified:false};
  const matrix=await this.providers.matrix([model.point,...model.orders.map(o=>({latitude:o.latitude,longitude:o.longitude}))]);
  const solution=outputSchema.parse(await this.providers.solve({...model,matrix}));
  const assigned=solution.routes.flatMap(r=>r.stops.map(s=>s.orderId));
  ensure(new Set(assigned).size===assigned.length&&new Set(solution.routes.map(r=>r.vehicleId)).size===solution.routes.length&&solution.routes.every(r=>model.fleet.some(f=>f.vehicleId===r.vehicleId&&f.driverId===r.driverId))&&assigned.every(id=>model.orders.some(o=>o.id===id)),'INVALID_PLAN','El optimizador devolvió una asignación inválida.');
  for(const route of solution.routes){
   let time=0,previous=0,weight=0,volume=0;
   for(const stop of route.stops){
    const index=model.orders.findIndex(o=>o.id===stop.orderId),order=model.orders[index];
    time=Math.max(time+matrix[previous][index+1],order.window[0]);
    ensure(stop.arrivalSeconds>=time&&stop.arrivalSeconds<=order.window[1],'INVALID_PLAN','El recorrido no respeta el horario del destinatario.');
    time=stop.arrivalSeconds+order.serviceSeconds;previous=index+1;weight+=order.weight;volume+=order.volume;
   }
   const vehicle=model.fleet.find(v=>v.vehicleId===route.vehicleId)!;
   ensure(time+matrix[previous][0]<=route.durationSeconds&&route.durationSeconds<=model.horizon&&weight<=vehicle.capacityWeight&&volume<=vehicle.capacityVolume,'INVALID_PLAN','El recorrido excede la jornada o la capacidad del vehículo.');
  }
  const proposal={routes:solution.routes.map(r=>({...r,...model.fleet.find(f=>f.vehicleId===r.vehicleId),stops:r.stops.map(s=>({...s,...model.orders.find(o=>o.id===s.orderId)}))})),pending:[...model.pending,...model.orders.filter(o=>!assigned.includes(o.id)).map(o=>({...o,reason:'Sin vehículo o tiempo suficiente para este reparto'}))],capacityUnverified:model.orders.some(o=>assigned.includes(o.id)&&o.unknown)};
  const id=randomUUID();await this.store.run('INSERT INTO routing_plans VALUES(?,?,?,?,?,?,?,?,?)',id,actor.orgId,actor.id,JSON.stringify(model.input),digest(model),JSON.stringify(proposal),timestamp(),null,null);
  return {id,...proposal};
 }
 async apply(actor:Actor,input:unknown){
  authorize(actor,roles);const b=z.object({commandId:z.uuid(),planId:z.uuid()}).parse(input),domain=new Logistics(this.store),inv=new Inventory(this.store);
  return domain.command(actor,'routing.apply',b,roles,async()=>{
   if(this.store.kind==='postgres')await this.store.one('SELECT id FROM organizations WHERE id=? FOR UPDATE',actor.orgId);
   const plan=await domain.record('routing_plans',b.planId,actor);
   if(plan.applied_at)return JSON.parse(plan.result);
   ensure(Date.now()-Date.parse(plan.created_at)<30*60000,'STALE_PLAN','La propuesta venció. Calculá nuevamente.');
   const model=await this.model(actor,JSON.parse(plan.input));ensure(digest(model)===plan.snapshot_hash,'STALE_PLAN','Cambió el stock, la ubicación o la disponibilidad. Calculá nuevamente antes de aplicar.');
   const proposal=JSON.parse(plan.proposal);ensure(proposal.routes.length,'NO_ELIGIBLE_ORDERS','No hay rutas para aplicar.');
   const routes=[];
   for(const proposed of proposal.routes){
    const route=await domain.createRoute(actor,{commandId:randomUUID(),name:`Reparto ${model.input.date} · ${proposed.plate}`,driverId:proposed.driverId,vehicleId:proposed.vehicleId,trackingProvider:'TRACCAR',startAt:model.input.startAt,endAt:model.input.endAt});
    for(const stop of proposed.stops){
     const order=await domain.record('inventory_orders',stop.orderId,actor);
     if(order.status==='DRAFT')await inv.reserveOrder(actor,order.id,{commandId:randomUUID(),locationId:model.input.locationId});
     const parcels=await this.store.all("SELECT parcel_id FROM inventory_order_parcels WHERE org_id=? AND order_id=? AND state='RESERVED' ORDER BY id",actor.orgId,order.id);
     const current=await domain.route(route.id,actor);
     await domain.assign(actor,route.id,{commandId:randomUUID(),expectedVersion:current.version,parcelIds:parcels.map(p=>p.parcel_id),pickup:false});
    }
    await domain.capacity(await domain.route(route.id,actor),actor);
    routes.push({id:route.id,name:`Reparto ${model.input.date} · ${proposed.plate}`,orders:proposed.stops.length});
   }
   const result={id:b.planId,routes};await this.store.run('UPDATE routing_plans SET applied_at=?,result=? WHERE org_id=? AND id=?',timestamp(),JSON.stringify(result),actor.orgId,b.planId);return result;
  });
 }
}
