import {z} from 'zod';
import {authorize,type Actor} from './auth.ts';
import type {Database,Row} from './database.ts';
import {Logistics} from './domain.ts';
import {ensure} from './errors.ts';
import {roadRoute,type Point,type RoadRoute} from './routing-providers.ts';

const inputSchema=z.union([z.object({proposalCommandId:z.uuid(),vehicleId:z.uuid()}).strict(),z.object({routeId:z.uuid()}).strict()]);
const hasPoint=(p:Row|null|undefined):p is Row&Point=>p!=null&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude);
/** Read-only itinerary. A report never approves, geocodes or changes custody. */
export class RouteReports{
 private db:Database;
 private roads:(points:Point[])=>Promise<RoadRoute>;
 private qualities:Map<string,{precision:string;label:string}>|null=null;
 constructor(db:Database,roads:(points:Point[])=>Promise<RoadRoute>=roadRoute){this.db=db;this.roads=roads;}
 async read(actor:Actor,input:unknown){
  const b=inputSchema.parse(input);authorize(actor,'routeId' in b?['ADMIN','OPERATIONS','DEPOT','DRIVER']:['ADMIN','OPERATIONS']);
  const snapshot=await this.db.transaction(async()=>{
   this.qualities=null;
   if('proposalCommandId' in b)return this.proposed(actor,b.proposalCommandId,b.vehicleId);
   return this.actual(actor,b.routeId);
  });
  const warnings:string[]=[];
  if(!snapshot.depot)warnings.push('Falta la ubicación del depósito de salida. Configurala en Empresa y equipo; no se inventó un origen.');
  const missing=snapshot.stops.filter((s:Row)=>!hasPoint(s));
  if(missing.length)warnings.push(`${missing.length} parada(s) sin ubicación verificada. El listado se conserva completo; no se calcula un total parcial como si fuera todo el recorrido.`);
  if(snapshot.stops.some((s:Row)=>s.precision!=='EXACT'&&s.precision!=='CONFIRMED'))warnings.push('Hay ubicaciones aproximadas. Los kilómetros y horarios dependen de confirmar esos puntos.');
  let road:RoadRoute|null=null;
  if(snapshot.depot&&snapshot.stops.length&&!missing.length){
   try{road=await this.roads([snapshot.depot,...snapshot.stops.map((s:Row)=>({latitude:s.latitude,longitude:s.longitude})),snapshot.depot]);}
   catch{warnings.push('El servidor de mapas no pudo trazar el recorrido. Reintentá; no se modificó la distribución.');}
  }
  let elapsed=0;
  const stops:Row[]=snapshot.stops.map((s:Row,index:number)=>{
   const leg=road?.legs[index];if(leg)elapsed+=leg.drivingSeconds;
   // Solver arrivals include delivery-window waiting; do not replace them with driving time.
   if(road&&s.arrivalSeconds!=null)elapsed=Math.max(elapsed,s.arrivalSeconds);
   if(road&&s.windowStartSeconds!=null)elapsed=Math.max(elapsed,s.windowStartSeconds);
   const arrivalAt=road?new Date(Date.parse(snapshot.startAt)+elapsed*1000).toISOString():null;
   if(road)elapsed+=s.serviceSeconds;
   return {...s,sequence:index+1,arrivalAt,distanceMeters:leg?.distanceMeters??null};
  });
  const totalSeconds=road?elapsed+road.legs.at(-1)!.drivingSeconds:null;
  return {...snapshot,stops,geometry:road?.geometry??null,distanceMeters:road?.distanceMeters??null,drivingSeconds:road?.drivingSeconds??null,totalSeconds,returnAt:totalSeconds==null?null:new Date(Date.parse(snapshot.startAt)+totalSeconds*1000).toISOString(),warnings,estimated:true,includesReturn:true};
 }
 private async depot(actor:Actor,locationId?:string){
  if(!locationId)return null;
  const p=await this.db.one("SELECT p.latitude,p.longitude,p.address,l.code,l.name FROM routing_points p JOIN inventory_locations l ON l.id=p.entity_id AND l.org_id=p.org_id WHERE p.org_id=? AND p.entity_kind='LOCATION' AND p.entity_id=?",actor.orgId,locationId);
  return hasPoint(p)?{latitude:p.latitude,longitude:p.longitude,label:p.code+' · '+p.name,address:p.address}:null;
 }
 private async quality(actor:Actor,id:string,point:Row){
  if(!this.qualities){this.qualities=new Map();const entries=await this.db.all("SELECT response FROM idempotency WHERE org_id=? AND operation='routing.confirmLocations'",actor.orgId);for(const entry of entries)for(const p of JSON.parse(entry.response).locations??[])this.qualities.set(p.id+':'+p.updatedAt,{precision:p.precision,label:p.label});}
  return this.qualities.get(id+':'+point.updated_at)??{precision:'CONFIRMED',label:null};
 }
 private async points(actor:Actor,ids:string[]){
  const unique=[...new Set(ids.filter(Boolean))];if(!unique.length)return new Map<string,Row>();
  return new Map((await this.db.all(`SELECT * FROM routing_points WHERE org_id=? AND entity_kind='ORDER' AND entity_id IN(${unique.map(()=>'?').join(',')})`,actor.orgId,...unique)).map(p=>[p.entity_id,p]));
 }
 private async proposed(actor:Actor,id:string,vehicleId:string){
  const entry=await this.db.one("SELECT response FROM idempotency WHERE org_id=? AND command_id=? AND operation='routing.organizeReserved'",actor.orgId,id);
  ensure(entry,'NOT_FOUND','No encontramos ese lote en tu empresa.',404);
  const proposal=JSON.parse(entry.response),route=proposal.proposedRoutes.find((r:Row)=>r.vehicleId===vehicleId);
  ensure(route,'NOT_FOUND','Ese camión no pertenece al lote.',404);
  let locationId:string|undefined,raw:Row[]=route.stops;
  if(route.existingRouteId){const merge=proposal.merges.find((m:Row)=>m.routeId===route.existingRouteId);ensure(merge,'NOT_FOUND','No encontramos la secuencia de este reparto.',404);locationId=merge.locationId;raw=merge.sequence.map((o:Row)=>({...o,orderId:o.id,reference:o.external_id,recipientName:o.recipient_name,destination:o.destination,instructions:o.restrictions,serviceSeconds:(o.service_minutes??10)*60}));}
  else{const plan=await this.db.one('SELECT input FROM routing_plans WHERE org_id=? AND id=?',actor.orgId,route.planId);ensure(plan,'NOT_FOUND','No encontramos el plan de este reparto.',404);locationId=JSON.parse(plan.input).locationId;}
  const stops=[],points=await this.points(actor,raw.map(s=>s.orderId));
  for(const stop of raw){
   const candidate=proposal.locationSuggestions.find((p:Row)=>p.id===stop.orderId);
   const saved=points.get(stop.orderId)?.address===stop.destination?points.get(stop.orderId):null;
   const point=hasPoint(stop)?stop:saved;
   const quality=candidate?{precision:candidate.precision,label:candidate.label}:saved?await this.quality(actor,stop.orderId,saved):{precision:'MISSING',label:null};
   stops.push({...stop,latitude:point?.latitude??null,longitude:point?.longitude??null,serviceSeconds:stop.serviceSeconds??600,...quality});
  }
  const org=await this.db.one('SELECT timezone FROM organizations WHERE id=?',actor.orgId);
  return {title:route.name??'Propuesta de reparto',plate:route.plate,driverName:route.driverName,timezone:org!.timezone,startAt:proposal.schedule.startAt,depot:await this.depot(actor,locationId),stops,proposalCommandId:id,routeId:null};
 }
 private async actual(actor:Actor,id:string){
  const route=await new Logistics(this.db).route(id,actor),vehicle=await this.db.one('SELECT plate FROM vehicles WHERE org_id=? AND id=?',actor.orgId,route.vehicle_id),driver=await this.db.one('SELECT name FROM drivers WHERE org_id=? AND id=?',actor.orgId,route.driver_id),org=await this.db.one('SELECT timezone FROM organizations WHERE id=?',actor.orgId);
  const rows=await this.db.all('SELECT s.id,s.kind,s.state,o.id AS order_id,o.external_id,o.service_minutes,o.window_start,o.restrictions,sh.reference,sh.recipient_name,sh.destination_text FROM stops s JOIN shipments sh ON sh.id=s.shipment_id AND sh.org_id=s.org_id LEFT JOIN inventory_orders o ON o.shipment_id=sh.id AND o.org_id=sh.org_id WHERE s.org_id=? AND s.route_id=? ORDER BY s.sequence',actor.orgId,id);
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:org!.timezone,hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(route.start_at)),part=(key:string)=>Number(parts.find(p=>p.type===key)!.value),startSeconds=part('hour')*3600+part('minute')*60+part('second');
  let locationId:string|undefined;
  const plans=await this.db.all('SELECT input,result FROM routing_plans WHERE org_id=? AND result LIKE ?',actor.orgId,'%'+id+'%');
  for(const p of plans)if(JSON.parse(p.result).routes?.some((r:Row)=>r.id===id)){locationId=JSON.parse(p.input).locationId;break;}
  if(!locationId){const locations=await this.db.all('SELECT DISTINCT op.location_id FROM inventory_order_parcels op JOIN route_assignments a ON a.parcel_id=op.parcel_id AND a.org_id=op.org_id WHERE a.org_id=? AND a.route_id=? AND a.active=1',actor.orgId,id);if(locations.length===1)locationId=locations[0].location_id;}
  const stops=[],points=await this.points(actor,rows.map(s=>s.order_id));
  const orderIds=[...new Set(rows.map(s=>s.order_id).filter(Boolean))];
  const allLines=orderIds.length?await this.db.all(`SELECT l.order_id,l.quantity,p.sku,p.name FROM inventory_order_lines l JOIN inventory_products p ON p.id=l.product_id AND p.org_id=l.org_id WHERE l.org_id=? AND l.order_id IN(${orderIds.map(()=>'?').join(',')}) ORDER BY l.id`,actor.orgId,...orderIds):[];
  for(const row of rows){
   const saved=points.get(row.order_id),point=row.kind==='DELIVERY'&&saved?.address===row.destination_text?saved:null;
   const lines=allLines.filter(l=>l.order_id===row.order_id);
   stops.push({id:row.id,orderId:row.order_id,kind:row.kind,state:row.state,reference:row.external_id??row.reference,recipientName:row.recipient_name,destination:row.destination_text,instructions:row.restrictions,lines,latitude:point?.latitude??null,longitude:point?.longitude??null,serviceSeconds:(row.service_minutes??10)*60,windowStartSeconds:row.window_start?Number(row.window_start.slice(0,2))*3600+Number(row.window_start.slice(3))*60-startSeconds:null,...(point?await this.quality(actor,row.order_id,point):{precision:'MISSING',label:null})});
  }
  return {title:route.name,plate:vehicle!.plate,driverName:driver!.name,timezone:org!.timezone,startAt:route.start_at,depot:await this.depot(actor,locationId),stops,routeId:id,proposalCommandId:null};
 }
}
