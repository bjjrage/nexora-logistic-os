import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Store} from '../server/db.ts';
import {setup,type Actor} from '../server/auth.ts';
import {Logistics} from '../server/domain.ts';
import {Inventory} from '../server/inventory.ts';
import {Routing} from '../server/routing.ts';
import {ReservedDispatch} from '../server/reserved-dispatch.ts';
import {correctDispatchOrders} from '../server/dispatch-corrections.ts';
import {confirmDispatchLocations} from '../server/dispatch-location-review.ts';
import {solveLocal,type RoutingProviders} from '../server/routing-providers.ts';
import {reconcileInventory} from '../server/reconciliation.ts';
import {TraccarTracking} from '../server/traccar.ts';
const cmd=()=>({commandId:randomUUID()});
async function fixture(t:any,real=false){
 const db=new Store(':memory:');t.after(()=>db.close());
 const identity=await setup(db,{organizationName:'Routing QA',timezone:'UTC',username:'routing-admin',password:'Routing-QA-2026!'});
 const actor:Actor={id:identity.userId,orgId:identity.orgId,name:'QA',role:'ADMIN',driverId:null},d=new Logistics(db),inv=new Inventory(db);
 const client=(await d.createClient(actor,{...cmd(),name:'Cliente'})).id;
 await db.run('INSERT INTO client_delivery_policies VALUES(?,?,?,?)',actor.orgId,client,'NEXORA',new Date().toISOString());
 const location=(await inv.createLocation(actor,{...cmd(),code:'CENTRAL',name:'Central'})).id;
 const product=(await inv.createProduct(actor,{...cmd(),clientId:client,sku:'QTY',name:'Producto',tracking:'QUANTITY',weightGrams:100,volumeCm3:100})).id;
 await inv.receive(actor,{...cmd(),clientId:client,productId:product,locationId:location,quantity:3});
 const driver=(await d.createDriver(actor,{...cmd(),name:'Chofer',username:'routing-driver',password:'Driver-QA-2026!'})).id;
 const vehicle=(await d.createVehicle(actor,{...cmd(),plate:'ROUTING',capacityWeightGrams:10000,capacityVolumeCm3:10000,odometer:0})).id;
 const providers:RoutingProviders={search:async()=>[],matrix:async points=>points.map((_,i)=>points.map((_,j)=>i===j?0:60)),solve:real?solveLocal:async m=>({routes:[{vehicleId:vehicle,driverId:driver,durationSeconds:m.orders.length*660+60,stops:m.orders.map((o:any,i:number)=>({orderId:o.id,arrivalSeconds:60+i*660}))}],unassigned:[]})};
 const routing=new Routing(db,providers);
 await routing.point(actor,{...cmd(),kind:'LOCATION',id:location,latitude:-25.3,longitude:-57.6});
 const orders=[];
 for(let i=0;i<2;i++){
  const id=(await inv.createOrder(actor,{...cmd(),clientId:client,externalId:'PLAN-'+i,orderDate:'2026-10-29',destination:'Destino '+i,recipientName:'Receptor '+i,lines:[{productId:product,quantity:2}]})).id;orders.push(id);
  await routing.point(actor,{...cmd(),kind:'ORDER',id,latitude:-25.31+i*.01,longitude:-57.61});
 }
 // Imports may create all orders at the same millisecond. Priority follows insertion order.
 await db.run('UPDATE inventory_orders SET created_at=? WHERE org_id=?','2026-10-29T00:00:00.000Z',actor.orgId);
 const input={date:'2026-10-29',locationId:location,startAt:'2026-10-29T08:00:00.000Z',endAt:'2026-10-29T18:00:00.000Z',fleet:[{vehicleId:vehicle,driverId:driver}]};
 return {db,actor,d,inv,routing,orders,input,client,product,location,vehicle,driver,providers};
}
const automatic=(f:Awaited<ReturnType<typeof fixture>>)=>new ReservedDispatch(f.db,{...f.providers,solve:async m=>({routes:[{vehicleId:m.fleet[0].vehicleId,driverId:m.fleet[0].driverId,durationSeconds:m.orders.length*660+60,stops:m.orders.map((o:any,i:number)=>({orderId:o.id,arrivalSeconds:60+i*660}))}],unassigned:[]})});
const departureDay=new Date(Date.now()+86400000).toISOString().slice(0,10);
const departure={date:departureDay,startAt:departureDay+'T08:00:00Z',endAt:departureDay+'T18:00:00Z'};
// Operational-flow tests now cross the explicit human approval boundary.
async function organizeAndApprove(service:ReservedDispatch,actor:Actor,input:unknown){const proposal=await service.organize(actor,input);if(!proposal.proposed)return proposal;return service.approve(actor,{...cmd(),proposalCommandId:proposal.id});}

test('organizer selects a truck and driver before review, persists the proposal and approves it exactly once',async t=>{
 const f=await fixture(t);await f.inv.reserveOrder(f.actor,f.orders[0],cmd());await f.db.run("DELETE FROM routing_points WHERE entity_kind='ORDER'");await f.db.run('UPDATE inventory_orders SET restrictions=? WHERE id=?','Descargar por acceso lateral',f.orders[0]);
 const service=new ReservedDispatch(f.db,{...f.providers,search:async()=>[{name:'Calle cercana',latitude:-25.31,longitude:-57.61,addressRank:26}]}),proposal=await service.organize(f.actor,{...cmd(),...departure});
 assert.equal(proposal.organized,0);assert.equal(proposal.proposed,1);assert.equal(proposal.proposedRoutes[0].plate,'ROUTING');assert.equal(proposal.proposedRoutes[0].driverName,'Chofer');assert.equal(proposal.proposedRoutes[0].stops[0].instructions,'Descargar por acceso lateral');
 assert.equal((await f.db.one('SELECT COUNT(*) n FROM routes'))!.n,0);assert.equal((await f.db.one("SELECT COUNT(*) n FROM routing_points WHERE entity_kind='ORDER'"))!.n,0);assert.equal((await service.board(f.actor,departure.date)).proposal.id,proposal.id);
 await assert.rejects(f.routing.apply(f.actor,{...cmd(),planId:proposal.planIds[0]}),{code:'APPROVAL_REQUIRED'});
 await assert.rejects(service.approve({...f.actor,role:'DEPOT'},{...cmd(),proposalCommandId:proposal.id}),{code:'FORBIDDEN'});
 await assert.rejects(service.approve({...f.actor,id:randomUUID()},{...cmd(),proposalCommandId:proposal.id}),{code:'NOT_FOUND'});
 await assert.rejects(service.approve({...f.actor,orgId:randomUUID()},{...cmd(),proposalCommandId:proposal.id}),{code:'NOT_FOUND'});
 const body={...cmd(),proposalCommandId:proposal.id},approved=await service.approve(f.actor,body);assert.equal(approved.organized,1);assert.deepEqual(await service.approve(f.actor,body),approved);assert.deepEqual(await service.approve(f.actor,{...cmd(),proposalCommandId:proposal.id}),approved);
 const route=await f.d.route(approved.routes[0].id,f.actor);assert.equal(route.vehicle_id,proposal.proposedRoutes[0].vehicleId);assert.equal(route.driver_id,proposal.proposedRoutes[0].driverId);assert.equal(route.state,'DRAFT');assert.equal((await f.db.one("SELECT COUNT(*) n FROM parcels WHERE state='LOADED'"))!.n,0);assert.equal((await reconcileInventory(f.db,f.actor)).ok,true);
});

test('approval never substitutes a now busy truck and rolls candidate locations back on failure',async t=>{
 const f=await fixture(t);await f.inv.reserveOrder(f.actor,f.orders[0],cmd());await f.db.run("DELETE FROM routing_points WHERE entity_kind='ORDER'");
 const service=new ReservedDispatch(f.db,{...f.providers,search:async()=>[{name:'Calle cercana',latitude:-25.31,longitude:-57.61,addressRank:26}]}),proposal=await service.organize(f.actor,{...cmd(),...departure});
 const busy=await f.d.createRoute(f.actor,{...cmd(),name:'Ocupado después de proponer',driverId:f.driver,vehicleId:f.vehicle,startAt:departure.startAt,endAt:departure.endAt,trackingProvider:'TRACCAR'});await f.db.run("UPDATE routes SET state='IN_PROGRESS' WHERE id=?",busy.id);
 await assert.rejects(service.approve(f.actor,{...cmd(),proposalCommandId:proposal.id}),{code:'VEHICLE_BUSY'});
 assert.equal((await f.db.one('SELECT COUNT(*) n FROM routes'))!.n,1);assert.equal((await f.db.one('SELECT COUNT(*) n FROM route_assignments'))!.n,0);assert.equal((await f.db.one("SELECT COUNT(*) n FROM routing_points WHERE entity_kind='ORDER'"))!.n,0);assert.equal((await f.db.one('SELECT status FROM inventory_orders WHERE id=?',f.orders[0]))!.status,'RESERVED');
});

test('missing circuit has an actionable blocker; configuring it clears stale reasons and preserves external circuits',async t=>{
 const f=await fixture(t),dispatch=automatic(f);await f.inv.reserveOrder(f.actor,f.orders[0],cmd());
 await f.db.run('DELETE FROM client_delivery_policies WHERE client_id=?',f.client);
 let board=await dispatch.board(f.actor,departure.date);assert.equal(board.orders[0].reasonCode,'MISSING_DELIVERY_PROVIDER');assert.equal(board.features.canConfigureDelivery,true);
 assert.equal((await dispatch.board({...f.actor,role:'OPERATIONS'},departure.date)).features.canConfigureDelivery,false);
 const blocked=await organizeAndApprove(dispatch,f.actor,{...cmd(),...departure});assert.equal(blocked.organized,0);assert.equal(blocked.pending[0].reasonCode,'MISSING_DELIVERY_PROVIDER');
 const tracking=new TraccarTracking(f.db,{});await tracking.clientPolicy(f.actor,f.client,{...cmd(),deliveryProvider:'QUADMINDS'});
 board=await dispatch.board(f.actor,departure.date);assert.equal(board.orders[0].reasonCode,'EXTERNAL_DELIVERY_PROVIDER');
 const external=await organizeAndApprove(dispatch,f.actor,{...cmd(),...departure});assert.equal(external.organized,0);assert.equal(external.pending[0].reasonCode,'EXTERNAL_DELIVERY_PROVIDER');
 await tracking.clientPolicy(f.actor,f.client,{...cmd(),deliveryProvider:'NEXORA'});
 board=await dispatch.board(f.actor,departure.date);assert.equal(board.orders[0].reasonCode,null);assert.equal(board.orders[0].reason,'Listo para organizar');
 assert.equal((await organizeAndApprove(dispatch,f.actor,{...cmd(),...departure})).organized,1);
 assert.equal((await f.db.one('SELECT delivery_provider FROM client_delivery_policies WHERE client_id=?',f.client))!.delivery_provider,'NEXORA');
});

test('release multiple reservations from Routes atomically and replay without adding stock twice',async t=>{
 const f=await fixture(t);await f.inv.receive(f.actor,{...cmd(),clientId:f.client,productId:f.product,locationId:f.location,quantity:1});for(const id of f.orders)await f.inv.reserveOrder(f.actor,id,cmd());
 const request={...cmd(),orderIds:f.orders,mode:'RELEASE'},result=await correctDispatchOrders(f.db,f.actor,request);
 assert.equal(result.released,4);assert.deepEqual(await correctDispatchOrders(f.db,f.actor,request),result);
 assert.equal((await f.db.one("SELECT SUM(quantity) AS n FROM inventory_balances WHERE status='AVAILABLE'"))!.n,4);assert.equal((await automatic(f).queue(f.actor,departure.date)).orders.length,0);assert.equal((await reconcileInventory(f.db,f.actor)).ok,true);
});
test('loaded orders need physical confirmation, then can return to planning and be released in the same route flow',async t=>{
 const f=await fixture(t);await f.inv.reserveOrder(f.actor,f.orders[0],cmd());const result=await organizeAndApprove(automatic(f),f.actor,{...cmd(),...departure}),routeId=result.routes[0].id,ids=(await f.db.all('SELECT parcel_id FROM route_assignments WHERE route_id=?',routeId)).map(r=>r.parcel_id);
 await f.d.loadSelected(f.actor,routeId,{...cmd(),expectedVersion:(await f.d.route(routeId,f.actor)).version,parcelIds:ids});
 await assert.rejects(correctDispatchOrders(f.db,f.actor,{...cmd(),orderIds:[f.orders[0]],mode:'RELEASE'}),{code:'PHYSICAL_UNLOAD_REQUIRED'});
 const requeued=await correctDispatchOrders(f.db,f.actor,{...cmd(),orderIds:[f.orders[0]],mode:'REQUEUE',confirmUnloaded:true});assert.equal(requeued.unloaded,2);assert.equal((await automatic(f).board(f.actor,departure.date)).orders.length,1);
 assert.equal((await f.db.one('SELECT status FROM inventory_orders WHERE id=?',f.orders[0]))!.status,'RESERVED');assert.equal((await f.db.one('SELECT COUNT(*) AS n FROM route_assignments WHERE active=1'))!.n,0);
 const organized=await organizeAndApprove(automatic(f),f.actor,{...cmd(),...departure});assert.equal(organized.organized,1);
 const assigned=(await f.db.one('SELECT parcel_id FROM route_assignments WHERE route_id=? AND active=1',organized.routes[0].id))!;
 await f.d.unassign(f.actor,organized.routes[0].id,{...cmd(),expectedVersion:(await f.d.route(organized.routes[0].id,f.actor)).version,parcelId:assigned.parcel_id});
 const partial=(await automatic(f).board(f.actor,departure.date)).routes[0].orders[0];assert.equal(partial.units,1);assert.equal(partial.orderUnits,2);
 const released=await correctDispatchOrders(f.db,f.actor,{...cmd(),orderIds:[f.orders[0]],mode:'RELEASE'});assert.equal(released.released,2);assert.equal((await reconcileInventory(f.db,f.actor)).ok,true);
});
test('a late invalid order rolls back the whole reservation correction and rejects other tenants or roles',async t=>{
 const f=await fixture(t);await f.inv.reserveOrder(f.actor,f.orders[0],cmd());
 await assert.rejects(correctDispatchOrders(f.db,f.actor,{...cmd(),orderIds:f.orders,mode:'RELEASE'}),{code:'INVALID_TRANSITION'});
 assert.equal((await f.db.one('SELECT status FROM inventory_orders WHERE id=?',f.orders[0]))!.status,'RESERVED');
 await assert.rejects(correctDispatchOrders(f.db,{...f.actor,role:'DEPOT'},{...cmd(),orderIds:[f.orders[0]],mode:'RELEASE'}),{code:'FORBIDDEN'});
 await assert.rejects(correctDispatchOrders(f.db,{...f.actor,orgId:randomUUID()},{...cmd(),orderIds:[f.orders[0]],mode:'RELEASE'}),{code:'NOT_FOUND'});assert.equal((await reconcileInventory(f.db,f.actor)).ok,true);
});
test('approximate street proposals can be confirmed together before organization without client-supplied coordinates',async t=>{
 const f=await fixture(t);await f.inv.reserveOrder(f.actor,f.orders[0],cmd());await f.db.run("DELETE FROM routing_points WHERE entity_kind='ORDER'");
 const service=new ReservedDispatch(f.db,{...f.providers,search:async()=>[{name:'Calle de prueba',latitude:-25.31,longitude:-57.61,addressRank:26}]});
 const pending=await service.organize(f.actor,{...cmd(),...departure});assert.equal(pending.organized,0);assert.equal(pending.proposed,1);assert.equal(pending.proposedRoutes[0].plate,'ROUTING');assert.equal(pending.locationSuggestions.length,1);
 await assert.rejects(confirmDispatchLocations(f.db,f.actor,{...cmd(),proposalCommandId:pending.id,orderIds:[randomUUID()]}),{code:'VALIDATION_ERROR'});
 const request={...cmd(),proposalCommandId:pending.id,orderIds:[f.orders[0]]},confirmed=await confirmDispatchLocations(f.db,f.actor,request);assert.equal(confirmed.confirmed,1);assert.deepEqual(await confirmDispatchLocations(f.db,f.actor,request),confirmed);
 assert.equal((await organizeAndApprove(service,f.actor,{...cmd(),...departure})).organized,1);
 const board=await new ReservedDispatch(f.db,f.providers).board(f.actor,departure.date);assert.equal(board.routes[0].orders[0].point.approximate,true);assert.equal(board.routes[0].orders[0].point.name,'Calle de prueba');
});
test('instructions are visible in the proposed truck and changed text invalidates approval',async t=>{
 const f=await fixture(t),text='Bulto frágil: manipular con cuidado.';await f.db.run('UPDATE inventory_orders SET restrictions=? WHERE id=?',text,f.orders[0]);await f.inv.reserveOrder(f.actor,f.orders[0],cmd());
 const service=automatic(f),proposal=await service.organize(f.actor,{...cmd(),...departure});assert.equal(proposal.organized,0);assert.equal(proposal.proposedRoutes[0].stops[0].instructions,text);
 await f.db.run('UPDATE inventory_orders SET restrictions=? WHERE id=?','Instrucción cambiada',f.orders[0]);
 await assert.rejects(service.approve(f.actor,{...cmd(),proposalCommandId:proposal.id}),{code:'STALE_PLAN'});assert.equal((await f.db.one('SELECT COUNT(*) n FROM routes'))!.n,0);
 assert.equal((await organizeAndApprove(service,f.actor,{...cmd(),...departure})).organized,1);
});
test('expired delivery windows propose the next local shift and can be organized there',async t=>{
 const f=await fixture(t);await f.db.run('UPDATE inventory_orders SET window_start=?,window_end=? WHERE id=?','08:00','14:00',f.orders[0]);await f.inv.reserveOrder(f.actor,f.orders[0],cmd());
 const afterDay=new Date(Date.parse(departure.date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
 const pending=await organizeAndApprove(automatic(f),f.actor,{...cmd(),date:departure.date,startAt:departure.date+'T18:00:00Z',endAt:afterDay+'T04:00:00Z'});assert.equal(pending.organized,0);assert.ok(pending.nextDeparture);assert.match(pending.nextDeparture.startAt,/T08:00:00/);
 assert.equal((await organizeAndApprove(automatic(f),f.actor,{...cmd(),date:departure.date,startAt:pending.nextDeparture.startAt,endAt:pending.nextDeparture.endAt})).organized,1);
});
test('reservation needs stock only, and routing queues only confirmed overdue reservations',async t=>{
 const f=await fixture(t);await f.db.run('DELETE FROM routing_points');
 await f.inv.reserveOrder(f.actor,f.orders[0],cmd());
 assert.equal((await f.db.one('SELECT status FROM inventory_orders WHERE id=?',f.orders[0]))!.status,'RESERVED');
 assert.equal((await f.db.one('SELECT COUNT(*) AS n FROM routes'))!.n,0);
 const service=automatic(f),queue=await service.queue(f.actor,departure.date);
 assert.deepEqual(queue.orders.map(o=>o.id),[f.orders[0]]);
 const result=await organizeAndApprove(service,f.actor,{...cmd(),...departure});assert.equal(result.organized,0);assert.match(result.pending[0].reason,/depósito/);
 await assert.rejects(service.queue({...f.actor,role:'DEPOT'}),{code:'FORBIDDEN'});
});
test('automatic distribution assigns reserved orders once without another stock deduction or physical load',async t=>{
 const f=await fixture(t);await f.inv.reserveOrder(f.actor,f.orders[0],cmd());
 const service=automatic(f),request={...cmd(),...departure};const first=await organizeAndApprove(service,f.actor,request);
 assert.equal(first.organized,1);assert.equal(first.routes[0].plate,'ROUTING');
 assert.deepEqual(await organizeAndApprove(service,f.actor,request),first);
 assert.equal((await organizeAndApprove(service,f.actor,{...cmd(),...departure})).organized,0);
 assert.equal((await f.db.one('SELECT COUNT(*) AS n FROM routes'))!.n,1);
 assert.equal((await f.db.one("SELECT SUM(quantity) AS n FROM inventory_balances WHERE status='AVAILABLE'"))!.n,1);
 assert.equal((await f.db.one("SELECT COUNT(*) AS n FROM parcels WHERE custody_type='VEHICLE'"))!.n,0);
 assert.equal((await f.db.one('SELECT status FROM inventory_orders WHERE id=?',f.orders[1]))!.status,'DRAFT');
 await f.inv.unreserveOrder(f.actor,f.orders[0],cmd());assert.equal((await reconcileInventory(f.db,f.actor)).ok,true);
});
test('a missing destination stays reserved while complete destinations are organized',async t=>{
 const f=await fixture(t);await f.inv.receive(f.actor,{...cmd(),clientId:f.client,productId:f.product,locationId:f.location,quantity:1});
 for(const id of f.orders)await f.inv.reserveOrder(f.actor,id,cmd());
 await f.db.run("DELETE FROM routing_points WHERE entity_kind='ORDER' AND entity_id=?",f.orders[1]);
 const result=await organizeAndApprove(automatic(f),f.actor,{...cmd(),...departure});
 assert.equal(result.organized,1);assert.equal(result.pending.length,1);assert.equal(result.pending[0].reasonCode,'MISSING_DELIVERY_LOCATION');
 assert.equal((await f.db.one('SELECT status FROM inventory_orders WHERE id=?',f.orders[1]))!.status,'RESERVED');
 assert.equal((await reconcileInventory(f.db,f.actor)).ok,true);
 const board=await new ReservedDispatch(f.db,f.providers).board(f.actor,departure.date);
 assert.equal(board.routes.length,1);assert.equal(board.orders.length,1);assert.match(board.orders[0].reason,/dirección/);
 await f.routing.point(f.actor,{...cmd(),kind:'ORDER',id:f.orders[1],latitude:-25.32,longitude:-57.62});
 assert.equal((await new ReservedDispatch(f.db,f.providers).board(f.actor,departure.date)).orders[0].reason,'Listo para organizar');
});

test('dispatch board persists every assignment with route, truck, driver, SKU and real load counts',async t=>{
 const f=await fixture(t);await f.inv.reserveOrder(f.actor,f.orders[0],cmd());const service=automatic(f);
 let board=await service.board(f.actor,departure.date);assert.equal(board.orders[0].external_id,'PLAN-0');assert.equal(board.orders[0].lines[0].sku,'QTY');assert.equal(board.routes.length,0);
 const applied=await organizeAndApprove(service,f.actor,{...cmd(),...departure}),routeId=applied.routes[0].id;
 board=await new ReservedDispatch(f.db,f.providers).board(f.actor,departure.date);
 assert.equal(board.orders.length,0);assert.equal(board.routes[0].id,routeId);assert.equal(board.routes[0].plate,'ROUTING');assert.equal(board.routes[0].driverName,'Chofer');
 const order=board.routes[0].orders[0];assert.equal(order.reference,'PLAN-0');assert.equal(order.lines[0].sku,'QTY');assert.equal(order.sequence,1);assert.equal(order.pendingLoad,2);assert.equal(order.units,2);
 const parcel=(await f.db.one('SELECT parcel_id FROM route_assignments WHERE route_id=?',routeId))!.parcel_id;
 await f.d.loadSelected(f.actor,routeId,{...cmd(),expectedVersion:(await f.d.route(routeId,f.actor)).version,parcelIds:[parcel]});
 board=await service.board(f.actor,departure.date);assert.equal(board.routes[0].orders[0].pendingLoad,1);assert.equal(board.routes[0].orders[0].loaded,1);
 const otherOrg=randomUUID();await f.db.run('INSERT INTO organizations VALUES(?,?,?)',otherOrg,'Other','UTC');
 const isolated=await service.board({...f.actor,orgId:otherOrg},departure.date);assert.equal(isolated.orders.length,0);assert.equal(isolated.routes.length,0);
});

test('an approximate building match remains unconfirmed and cannot silently become a routing destination',async t=>{
 const f=await fixture(t);await f.inv.reserveOrder(f.actor,f.orders[0],cmd());await f.db.run("DELETE FROM routing_points WHERE entity_kind='ORDER'");
 const providers={...f.providers,search:async(query:string)=>query==='Destino 0'?[]:[{name:'Nearby building',latitude:-25.31,longitude:-57.61,addressRank:30}]};
 await f.db.run('UPDATE inventory_orders SET destination=? WHERE id=?','Palma 145, Centro, Asunción, Paraguay',f.orders[0]);
 providers.search=async(query:string)=>query.includes('Centro')?[]:[{name:'Nearby building',latitude:-25.31,longitude:-57.61,addressRank:30}];
 const result=await new ReservedDispatch(f.db,providers).organize(f.actor,{...cmd(),...departure});assert.equal(result.organized,0);assert.equal(result.proposed,1);assert.equal(result.locationSuggestions[0].precision,'STREET');
 assert.equal((await f.db.one("SELECT COUNT(*) AS n FROM routing_points WHERE entity_kind='ORDER'"))!.n,0);
});
test('availability automatically replaces an occupied truck/driver and leaves future orders pending',async t=>{
 const f=await fixture(t);await f.inv.reserveOrder(f.actor,f.orders[0],cmd());
 const occupied=await f.d.createRoute(f.actor,{...cmd(),name:'En calle',driverId:f.driver,vehicleId:f.vehicle,startAt:departure.startAt,endAt:departure.endAt,trackingProvider:'TRACCAR'});
 await f.db.run("UPDATE routes SET state='IN_PROGRESS' WHERE id=?",occupied.id);
 const vehicle=(await f.d.createVehicle(f.actor,{...cmd(),plate:'LIBRE',capacityWeightGrams:10000,capacityVolumeCm3:10000,odometer:0})).id;
 const driver=(await f.d.createDriver(f.actor,{...cmd(),name:'Chofer libre',username:'free-routing',password:'Driver-QA-2026!'})).id;
 const result=await organizeAndApprove(automatic(f),f.actor,{...cmd(),...departure});
 assert.equal(result.routes[0].plate,'LIBRE');const route=await f.d.route(result.routes[0].id,f.actor);assert.equal(route.driver_id,driver);assert.equal(route.vehicle_id,vehicle);
});
test('new reservations join a compatible preparing truck without moving loaded cargo',async t=>{
 const f=await fixture(t);await f.inv.receive(f.actor,{...cmd(),clientId:f.client,productId:f.product,locationId:f.location,quantity:1});
 const startAt=new Date().toISOString(),body={date:startAt.slice(0,10),startAt,endAt:new Date(Date.now()+10*3600000).toISOString()};
 await f.inv.reserveOrder(f.actor,f.orders[0],cmd());const service=automatic(f),first=await organizeAndApprove(service,f.actor,{...cmd(),...body});
 const routeId=first.routes[0].id,loaded=(await f.db.all('SELECT parcel_id FROM route_assignments WHERE route_id=?',routeId)).map(p=>p.parcel_id);
 await f.d.loadSelected(f.actor,routeId,{...cmd(),expectedVersion:(await f.d.route(routeId,f.actor)).version,parcelIds:loaded});
 await f.d.ready(f.actor,routeId,{...cmd(),expectedVersion:(await f.d.route(routeId,f.actor)).version});
 await f.inv.reserveOrder(f.actor,f.orders[1],cmd());const second=await organizeAndApprove(service,f.actor,{...cmd(),...body});
 assert.equal(second.organized,1);assert.equal(second.routes[0].id,routeId);assert.equal(second.routes[0].orders,2);
 assert.equal((await f.db.one('SELECT COUNT(*) AS n FROM routes'))!.n,1);
 assert.equal((await f.d.route(routeId,f.actor)).state,'DRAFT');
 assert.equal((await f.db.one('SELECT status FROM inventory_orders WHERE id=?',f.orders[0]))!.status,'LOADED');
 assert.equal((await f.db.one('SELECT status FROM inventory_orders WHERE id=?',f.orders[1]))!.status,'RESERVED');
 for(const id of loaded)assert.equal((await f.db.one('SELECT custody_id FROM parcels WHERE id=?',id))!.custody_id,f.vehicle);
 assert.equal((await reconcileInventory(f.db,f.actor)).ok,true);
});
test('automatic organization rolls back every depot if a later assignment fails',async t=>{
 const f=await fixture(t),location=(await f.inv.createLocation(f.actor,{...cmd(),code:'SECOND',name:'Segundo depósito'})).id;
 await f.routing.point(f.actor,{...cmd(),kind:'LOCATION',id:location,latitude:-25.32,longitude:-57.62});
 await f.inv.receive(f.actor,{...cmd(),clientId:f.client,productId:f.product,locationId:location,quantity:2});
 await f.inv.reserveOrder(f.actor,f.orders[0],{...cmd(),locationId:f.location});
 await f.inv.reserveOrder(f.actor,f.orders[1],{...cmd(),locationId:location});
 await f.d.createVehicle(f.actor,{...cmd(),plate:'SECOND',capacityWeightGrams:10000,capacityVolumeCm3:10000,odometer:0});
 await f.d.createDriver(f.actor,{...cmd(),name:'Segundo chofer',username:'second-routing',password:'Driver-QA-2026!'});
 const original=f.db.run.bind(f.db);let assignments=0;
 f.db.run=async(sql,...params)=>{if(sql.startsWith('INSERT INTO route_assignments')&&++assignments===3)throw new Error('QA_LATE_DEPOT');return original(sql,...params);};
 await assert.rejects(organizeAndApprove(automatic(f),f.actor,{...cmd(),...departure}),/QA_LATE_DEPOT/);
 f.db.run=original;
 assert.equal((await f.db.one('SELECT COUNT(*) AS n FROM routes'))!.n,0);
 assert.equal((await f.db.one('SELECT COUNT(*) AS n FROM route_assignments'))!.n,0);
 assert.equal((await f.db.one("SELECT COUNT(*) AS n FROM inventory_orders WHERE status='RESERVED'"))!.n,2);
 assert.equal((await reconcileInventory(f.db,f.actor)).ok,true);
});
test('future reservations and external circuits are never silently dispatched in the internal circuit',async t=>{
 const f=await fixture(t);await f.inv.receive(f.actor,{...cmd(),clientId:f.client,productId:f.product,locationId:f.location,quantity:1});
 for(const id of f.orders)await f.inv.reserveOrder(f.actor,id,cmd());
 await f.db.run('UPDATE inventory_orders SET order_date=? WHERE id=?',new Date(Date.parse(departure.date+'T00:00:00Z')+86400000).toISOString().slice(0,10),f.orders[1]);
 await f.db.run("UPDATE client_delivery_policies SET delivery_provider='QUADMINDS' WHERE client_id=?",f.client);
 const result=await organizeAndApprove(automatic(f),f.actor,{...cmd(),...departure});
 assert.equal(result.organized,0);assert.equal(result.pending.length,1);assert.equal(result.pending[0].reasonCode,'EXTERNAL_DELIVERY_PROVIDER');
 assert.equal((await reconcileInventory(f.db,f.actor)).ok,true);
});
test('concurrent organizers cannot assign the same reservation twice',async t=>{
 const f=await fixture(t);await f.inv.reserveOrder(f.actor,f.orders[0],cmd());
 const results=await Promise.allSettled([organizeAndApprove(automatic(f),f.actor,{...cmd(),...departure}),organizeAndApprove(automatic(f),f.actor,{...cmd(),...departure})]);
 assert.ok(results.some(r=>r.status==='fulfilled'));
 assert.equal((await f.db.one('SELECT COUNT(*) AS n FROM routes'))!.n,1);
 assert.equal((await reconcileInventory(f.db,f.actor)).ok,true);
});

test('company depot coordinates are shared, survive renaming and require administration to change',async t=>{
 const f=await fixture(t);
 await f.routing.point(f.actor,{...cmd(),kind:'LOCATION',id:f.location,address:'Av. España 123, Asunción',latitude:-25.3,longitude:-57.6});
 const point=(await f.routing.context(f.actor)).points.find(p=>p.kind==='LOCATION'&&p.id===f.location)!;
 assert.equal(point.address,'Av. España 123, Asunción');
 await f.db.run('UPDATE inventory_locations SET name=? WHERE id=?','Central renombrado',f.location);
 assert.ok((await f.routing.preview(f.actor,f.input)).routes.length);
 await assert.rejects(f.routing.point({...f.actor,role:'OPERATIONS'},{...cmd(),kind:'LOCATION',id:f.location,latitude:0,longitude:0}),{code:'FORBIDDEN'});
 assert.equal((await f.routing.context(f.actor)).points.find(p=>p.id===f.location)!.latitude,-25.3);
 await assert.rejects(f.routing.point({...f.actor,orgId:randomUUID()},{...cmd(),kind:'LOCATION',id:f.location,latitude:0,longitude:0}),{code:'NOT_FOUND'});
});

test('inline suggestions remember fleet, restrict selected orders and never reserve unselected stock',async t=>{
 const f=await fixture(t);
 const defaults=(await f.routing.context(f.actor)).defaults;
 assert.equal(defaults.locationId,f.location);assert.deepEqual(defaults.fleet,f.input.fleet);
 const proposal=await f.routing.suggest(f.actor,{...f.input,orderIds:[f.orders[1]]});
 assert.deepEqual(proposal.routes.flatMap((r:any)=>r.stops.map((s:any)=>s.orderId)),[f.orders[1]]);
 const result=await f.routing.apply(f.actor,{...cmd(),planId:proposal.id});
 assert.equal((await f.db.one('SELECT status FROM inventory_orders WHERE id=?',f.orders[0]))!.status,'DRAFT');
 assert.equal((await f.db.one('SELECT status FROM inventory_orders WHERE id=?',f.orders[1]))!.status,'RESERVED');
 assert.deepEqual((await f.routing.context(f.actor)).defaults.fleet,f.input.fleet);
 await assert.rejects(f.routing.suggest(f.actor,{...f.input,orderIds:[f.orders[0]]}),{code:'VEHICLE_BUSY'});
 assert.equal((await f.db.one('SELECT COUNT(*) AS n FROM routes'))!.n,result.routes.length);
});

test('planner allocates shared stock once, applies atomically, preserves physical load and supports unreserve',async t=>{
 const f=await fixture(t),proposal=await f.routing.preview(f.actor,f.input);
 assert.equal(proposal.routes.length,1);assert.equal(proposal.routes[0].stops.length,1);assert.equal(proposal.pending.length,1);
 assert.equal(proposal.routes[0].stops[0].orderId,f.orders[0]);
 const selectedOrder=proposal.routes[0].stops[0].orderId;
 assert.equal((await f.db.one("SELECT SUM(quantity) AS n FROM inventory_balances WHERE status='AVAILABLE'"))!.n,3);
 const command={...cmd(),planId:proposal.id},result=await f.routing.apply(f.actor,command);
 assert.deepEqual(await f.routing.apply(f.actor,command),result);assert.deepEqual(await f.routing.apply(f.actor,{...cmd(),planId:proposal.id}),result);
 assert.equal((await f.db.one('SELECT COUNT(*) AS n FROM routes'))!.n,1);
 assert.equal((await f.db.one("SELECT COUNT(*) AS n FROM parcels WHERE state='LOADED'"))!.n,0);
 const routeId=result.routes[0].id,route=await f.d.route(routeId,f.actor);
 await assert.rejects(f.d.dispatch(f.actor,routeId,{...cmd(),expectedVersion:route.version,dispatchNow:true}),{code:'INVALID_TRANSITION'});
 const parcels=await f.db.all('SELECT parcel_id FROM route_assignments WHERE route_id=? AND active=1',routeId);
 await f.d.loadSelected(f.actor,routeId,{...cmd(),expectedVersion:route.version,parcelIds:parcels.map(p=>p.parcel_id)});
 assert.equal((await f.db.one('SELECT status FROM inventory_orders WHERE id=?',selectedOrder))!.status,'LOADED');
 await f.d.unloadSelected(f.actor,routeId,{...cmd(),expectedVersion:(await f.d.route(routeId,f.actor)).version,parcelIds:parcels.map(p=>p.parcel_id)});
 await f.inv.unreserveOrder(f.actor,selectedOrder,cmd());
 assert.equal((await f.db.one('SELECT COUNT(*) AS n FROM route_assignments WHERE active=1'))!.n,0);
 assert.equal((await f.db.one("SELECT SUM(quantity) AS n FROM inventory_balances WHERE status='AVAILABLE'"))!.n,3);
 assert.equal((await reconcileInventory(f.db,f.actor)).ok,true);
});
test('stale stock or destination never applies a partial plan; roles and tenants are isolated',async t=>{
 const f=await fixture(t),proposal=await f.routing.preview(f.actor,f.input);
 await assert.rejects(f.routing.context({...f.actor,role:'DRIVER'}),{code:'FORBIDDEN'});
 await assert.rejects(f.routing.apply({...f.actor,orgId:randomUUID()},{...cmd(),planId:proposal.id}),{code:'NOT_FOUND'});
 await f.inv.reserveOrder(f.actor,f.orders[1],{...cmd(),locationId:f.location});
 await assert.rejects(f.routing.apply(f.actor,{...cmd(),planId:proposal.id}),{code:'STALE_PLAN'});
 assert.equal((await f.db.one('SELECT COUNT(*) AS n FROM routes'))!.n,0);
 await f.inv.unreserveOrder(f.actor,f.orders[1],cmd());
 const next=await f.routing.preview(f.actor,f.input);
 await f.inv.updateOrder(f.actor,f.orders[0],{...cmd(),destination:'Otra ciudad'});
 await assert.rejects(f.routing.apply(f.actor,{...cmd(),planId:next.id}),{code:'STALE_PLAN'});
 assert.equal((await f.db.one('SELECT COUNT(*) AS n FROM routes'))!.n,0);
});
test('planner excludes external circuits, unknown capacity and reserved stock from another location',async t=>{
 const f=await fixture(t);
 await f.db.run('UPDATE inventory_products SET weight_grams=NULL WHERE id=?',f.product);
 let result=await f.routing.preview(f.actor,f.input);assert.equal(result.routes.length,0);assert.match(result.pending[0].reason,/capacidad/);
 result=await f.routing.preview(f.actor,{...f.input,allowUnknownCapacity:true});assert.equal(result.capacityUnverified,true);
 await f.db.run("UPDATE client_delivery_policies SET delivery_provider='QUADMINDS' WHERE client_id=?",f.client);
 result=await f.routing.preview(f.actor,{...f.input,allowUnknownCapacity:true});assert.equal(result.routes.length,0);assert.match(result.pending[0].reason,/QuadMinds/);
});
test('planner detects occupied fleet and rejects malformed solver output before any inventory changes',async t=>{
 const f=await fixture(t);f.providers.solve=async()=>({routes:[{vehicleId:f.vehicle,driverId:f.driver,durationSeconds:500,stops:[{orderId:f.orders[0],arrivalSeconds:0}]}],unassigned:[]});
 await assert.rejects(f.routing.preview(f.actor,f.input),{code:'INVALID_PLAN'});
 const route=await f.d.createRoute(f.actor,{...cmd(),name:'En curso',driverId:f.driver,vehicleId:f.vehicle,trackingProvider:'TRACCAR',startAt:f.input.startAt,endAt:f.input.endAt});
 await f.db.run("UPDATE routes SET state='IN_PROGRESS' WHERE id=?",route.id);
 await assert.rejects(f.routing.preview(f.actor,f.input),{code:'VEHICLE_BUSY'});
});
test('road matrix API validates scope, finite coordinates and bounded request size',async t=>{
 const f=await fixture(t);
 assert.deepEqual(await f.routing.matrix(f.actor,{points:[{latitude:-25.3,longitude:-57.6},{latitude:-25.31,longitude:-57.61}]}),[[0,60],[60,0]]);
 await assert.rejects(f.routing.matrix({...f.actor,role:'CUSTOMER'},{points:[{latitude:-25,longitude:-57}]}),{code:'FORBIDDEN'});
 await assert.rejects(f.routing.matrix(f.actor,{points:[{latitude:91,longitude:0}]}));
 await assert.rejects(f.routing.matrix(f.actor,{points:Array.from({length:82},()=>({latitude:0,longitude:0}))}));
});
test('real OR-Tools respects full orders, windows and capacity',{skip:!process.env.ROUTING_PYTHON},async t=>{
 const f=await fixture(t,true),result=await f.routing.preview(f.actor,f.input);
 assert.equal(result.routes.length,1);assert.equal(result.routes[0].stops.length,1);
 await f.routing.apply(f.actor,{...cmd(),planId:result.id});
 assert.equal((await reconcileInventory(f.db,f.actor)).ok,true);
});
test('a failed application rolls back every route and reservation in the batch',async t=>{
 const f=await fixture(t);
 await f.inv.receive(f.actor,{...cmd(),clientId:f.client,productId:f.product,locationId:f.location,quantity:3});
 const proposal=await f.routing.preview(f.actor,f.input);
 assert.equal(proposal.routes[0].stops.length,2);
 // Simulate a late storage failure after the first order was already assigned.
 f.db.db.exec("CREATE TRIGGER simulate_failure BEFORE INSERT ON route_assignments WHEN (SELECT COUNT(*) FROM route_assignments)>=2 BEGIN SELECT RAISE(ABORT,'TEST_LATE_FAILURE'); END;");
 await assert.rejects(f.routing.apply(f.actor,{...cmd(),planId:proposal.id}));
 assert.equal((await f.db.one('SELECT COUNT(*) AS n FROM routes'))!.n,0);
 assert.equal((await f.db.one("SELECT SUM(quantity) AS n FROM inventory_balances WHERE status='AVAILABLE'"))!.n,6);
 assert.equal((await f.db.one("SELECT COUNT(*) AS n FROM inventory_orders WHERE status='RESERVED'"))!.n,0);
 assert.equal((await reconcileInventory(f.db,f.actor)).ok,true);
});
test('planned routes continue through load, confirmation, departure and delivery without a second load',async t=>{
 const f=await fixture(t);await f.inv.reserveOrder(f.actor,f.orders[0],cmd());const applied=await organizeAndApprove(automatic(f),f.actor,{...cmd(),...departure});
 const selectedOrder=f.orders[0];
 const id=applied.routes[0].id,version=async()=>(await f.d.route(id,f.actor)).version;
 const parcels=(await f.db.all('SELECT parcel_id FROM route_assignments WHERE route_id=?',id)).map(p=>p.parcel_id);
 await f.d.loadSelected(f.actor,id,{...cmd(),expectedVersion:await version(),parcelIds:parcels});
 await f.d.ready(f.actor,id,{...cmd(),expectedVersion:await version()});
 await f.d.inspect(f.actor,f.vehicle,{...cmd(),odometer:0,fuelPercent:80,items:[{label:'Control QA',severity:'OK',note:''}]});
 await f.d.dispatch(f.actor,id,{...cmd(),expectedVersion:await version(),dispatchNow:true});
 await f.db.run('INSERT INTO organization_test_mode VALUES(?,1)',f.actor.orgId);
 const stop=(await f.db.one('SELECT id FROM stops WHERE route_id=?',id))!;
 await f.d.attempt(f.actor,stop.id,{...cmd(),expectedVersion:await version(),deliveredParcelIds:parcels,failedParcelIds:[],receiverName:'Receptor QA',evidenceIds:[],reasonCode:'',nextAction:''});
 assert.equal((await f.db.one('SELECT status FROM inventory_orders WHERE id=?',selectedOrder))!.status,'DELIVERED');
 await f.d.closeRoute(f.actor,id,{...cmd(),expectedVersion:await version()});
 assert.equal((await reconcileInventory(f.db,f.actor)).ok,true);
});
test('real OR-Tools distributes complete jobs across vehicles and respects delivery windows',{skip:!process.env.ROUTING_PYTHON},async()=>{
 const first=randomUUID(),second=randomUUID(),a=randomUUID(),b=randomUUID();
 const model={horizon:1800,matrix:[[0,60,60],[60,0,60],[60,60,0]],fleet:[{vehicleId:a,driverId:randomUUID(),capacityWeight:4,capacityVolume:4},{vehicleId:b,driverId:randomUUID(),capacityWeight:4,capacityVolume:4}],orders:[{id:first,weight:3,volume:3,window:[0,120],serviceSeconds:120},{id:second,weight:3,volume:3,window:[600,900],serviceSeconds:120}]};
 const result=await solveLocal(model);
 assert.equal(result.routes.length,2);assert.equal(result.unassigned.length,0);
 assert.equal(new Set(result.routes.map((r:any)=>r.vehicleId)).size,2);
 for(const route of result.routes){assert.equal(route.stops.length,1);const stop=route.stops[0],window=model.orders.find(o=>o.id===stop.orderId)!.window;assert.ok(stop.arrivalSeconds>=window[0]&&stop.arrivalSeconds<=window[1]);}
});
