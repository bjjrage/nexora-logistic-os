import type {Database,Row} from './database.ts';
import type {Actor} from './auth.ts';
import {ensure} from './errors.ts';
import {deliveryBlock} from './delivery-block.ts';
import {signature} from './dispatch-append.ts';
export async function orderLines(db:Database,actor:Actor,ids:string[]){
 if(!ids.length)return [];
 return db.all(`SELECT l.order_id,p.name,p.sku,l.quantity FROM inventory_order_lines l JOIN inventory_products p ON p.id=l.product_id AND p.org_id=l.org_id WHERE l.org_id=? AND l.order_id IN(${ids.map(()=>'?').join(',')}) ORDER BY l.order_id,l.id`,actor.orgId,...ids);
}
/** Read the actual assignments, rather than relying on a previous browser response. */
export async function dispatchBoard(db:Database,actor:Actor,queue:Row){
 const rows=await db.all(`SELECT r.id AS route_id,r.name AS route_name,r.state AS route_state,r.start_at,r.end_at,v.plate,d.name AS driver_name,sh.id AS shipment_id,COALESCE(o.id,sh.id) AS order_id,COALESCE(o.external_id,sh.reference) AS reference,sh.recipient_name,sh.destination_text AS destination,c.name AS client_name,s.sequence,s.kind,o.status AS order_status,p.state AS parcel_state,p.weight_grams,p.volume_cm3,pr.sku AS product_sku,pr.name AS product_name
 FROM routes r JOIN vehicles v ON v.id=r.vehicle_id AND v.org_id=r.org_id JOIN drivers d ON d.id=r.driver_id AND d.org_id=r.org_id JOIN route_assignments a ON a.route_id=r.id AND a.org_id=r.org_id AND a.active=1 JOIN parcels p ON p.id=a.parcel_id AND p.org_id=a.org_id JOIN shipments sh ON sh.id=p.shipment_id AND sh.org_id=p.org_id JOIN clients c ON c.id=sh.client_id AND c.org_id=sh.org_id LEFT JOIN inventory_orders o ON o.shipment_id=sh.id AND o.org_id=sh.org_id LEFT JOIN inventory_order_parcels op ON op.parcel_id=p.id AND op.org_id=p.org_id LEFT JOIN inventory_products pr ON pr.id=op.product_id AND pr.org_id=op.org_id LEFT JOIN stops s ON s.route_id=r.id AND s.org_id=r.org_id AND s.shipment_id=sh.id AND s.kind=CASE WHEN a.pickup=1 THEN 'PICKUP' ELSE 'DELIVERY' END
 WHERE r.org_id=? AND r.state IN('DRAFT','READY','IN_PROGRESS') ORDER BY r.start_at DESC,r.id,s.sequence,p.id LIMIT 10001`,actor.orgId);
 ensure(rows.length<=10000,'BOARD_LIMIT','Hay demasiados bultos en rutas activas. Cerrá los repartos terminados para consultar la organización.');
 const routes=new Map<string,Row>(),orders=new Map<string,Row>();
 for(const row of rows){
  if(!routes.has(row.route_id))routes.set(row.route_id,{id:row.route_id,name:row.route_name,state:row.route_state,plate:row.plate,driverName:row.driver_name,startAt:row.start_at,endAt:row.end_at,capacityUnverified:false,orders:[]});
  if(row.weight_grams==null||row.volume_cm3==null)routes.get(row.route_id)!.capacityUnverified=true;
  const key=`${row.route_id}:${row.shipment_id}:${row.kind}`;
  if(!orders.has(key)){const order={id:row.order_id,reference:row.reference,recipientName:row.recipient_name,destination:row.destination,clientName:row.client_name,sequence:row.sequence,kind:row.kind,status:row.order_status,lines:[],units:0,pendingLoad:0,loaded:0,delivered:0};orders.set(key,order);routes.get(row.route_id)!.orders.push(order);}
  const order=orders.get(key)!;order.units++;if(['EXPECTED','RECEIVED'].includes(row.parcel_state))order.pendingLoad++;if(['LOADED','IN_TRANSIT','RETURN_PENDING'].includes(row.parcel_state))order.loaded++;if(row.parcel_state==='DELIVERED')order.delivered++;
  if(row.product_sku){const line=order.lines.find((l:Row)=>l.sku===row.product_sku);if(line)line.quantity++;else order.lines.push({name:row.product_name,sku:row.product_sku,quantity:1});}
 }
 const points=await db.all("SELECT entity_kind,entity_id,address,latitude,longitude,updated_at FROM routing_points WHERE org_id=?",actor.orgId);
 const confirmations=await db.all("SELECT i.response FROM idempotency i JOIN audit a ON a.org_id=i.org_id AND a.command_id=i.command_id WHERE i.org_id=? AND i.operation='routing.confirmLocations' ORDER BY a.created_at DESC,a.id DESC",actor.orgId),approximate=new Map<string,Row>();
 for(const entry of confirmations)for(const location of JSON.parse(entry.response).locations??[]){const point=points.find(p=>p.entity_kind==='ORDER'&&p.entity_id===location.id);if(point&&point.updated_at===location.updatedAt&&!approximate.has(location.id))approximate.set(location.id,location);}
 const orderPoint=(id:string,address:string)=>{const point=points.find(p=>p.entity_kind==='ORDER'&&p.entity_id===id&&p.address===address);const quality=approximate.get(id);return point?{...point,...(quality?{approximate:quality.precision!=='EXACT',precision:quality.precision,name:quality.label}:{})}:null;};
 for(const route of routes.values())for(const order of route.orders)order.point=orderPoint(order.id,order.destination);
 const inventoryIds=[...new Set(rows.filter(r=>r.order_status).map(r=>r.order_id))];
 const totals=inventoryIds.length?await db.all(`SELECT op.order_id,COUNT(*) AS units,SUM(CASE WHEN p.state='LOADED' THEN 1 ELSE 0 END) AS loaded FROM inventory_order_parcels op JOIN parcels p ON p.id=op.parcel_id AND p.org_id=op.org_id WHERE op.org_id=? AND op.order_id IN(${inventoryIds.map(()=>'?').join(',')}) AND op.state IN('RESERVED','VEHICLE') GROUP BY op.order_id`,actor.orgId,...inventoryIds):[];
 for(const route of routes.values())for(const order of route.orders){const total=totals.find(t=>t.order_id===order.id);if(total){order.orderUnits=total.units;order.orderLoaded=total.loaded;}}
 const last=await db.one("SELECT i.response,i.actor_id FROM idempotency i JOIN audit a ON a.org_id=i.org_id AND a.command_id=i.command_id WHERE i.org_id=? AND i.operation='routing.organizeReserved' ORDER BY a.created_at DESC,a.id DESC LIMIT 1",actor.orgId);
 const result=last?JSON.parse(last.response):null,previous:Row[]=result?.pending??[];
 const proposal=result?.proposedRoutes?.length&&last!.actor_id===actor.id&&Date.parse(result.validUntil)>Date.now()&&result.queueSignature===signature(queue.orders)&&!result.locationSuggestions.some((p:Row)=>orderPoint(p.id,p.destination))?result:null;
 const proposed=new Map<string,Row>();for(const route of proposal?.proposedRoutes??[])for(const stop of route.stops)proposed.set(stop.orderId,route);
 return {...queue,proposal,features:{batchCorrections:true,bulkLocationReview:true,proposalApproval:true,canConfigureDelivery:actor.role==='ADMIN'},orders:queue.orders.map((order:Row)=>{
  const point=orderPoint(order.id,order.destination),previousOrder=previous.find(p=>p.id===order.id);
  const staleCircuit=previousOrder?.reasonCode?.endsWith('DELIVERY_PROVIDER')||previousOrder?.reason==='Circuito externo o sin definir';
  const oldReason=staleCircuit||point&&previousOrder?.reasonCode==='MISSING_DELIVERY_LOCATION'?null:previousOrder?.reason,circuit=deliveryBlock(order.delivery_provider);
  const truck=proposed.get(order.id);
  return {...order,point:point??null,proposedVehicle:truck?{plate:truck.plate,driverName:truck.driverName}:null,reasonCode:circuit?.reasonCode??(truck||!oldReason?null:previousOrder?.reasonCode??null),reason:circuit?.reason??(truck?`Propuesto para ${truck.plate} · ${truck.driverName}`:oldReason&&!(point&&oldReason.includes('ubicación del destinatario'))?oldReason:point?'Listo para organizar':'Ubicación por confirmar')};
 }),routes:[...routes.values()]};
}
