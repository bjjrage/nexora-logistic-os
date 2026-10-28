import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Store} from '../server/db.ts';
import {Logistics} from '../server/domain.ts';
import {setup,type Actor} from '../server/auth.ts';
import {TraccarTracking} from '../server/traccar.ts';
const cmd=()=>({commandId:randomUUID()});
async function fixture(t:test.TestContext){
 const store=new Store(':memory:');t.after(()=>store.close());const ids=await setup(store,{organizationName:'QA rutas',timezone:'America/Asuncion',username:'route-edit',password:'QA-Route-Edit-2026!'});
 const actor:Actor={id:ids.userId,orgId:ids.orgId,name:'QA',role:'ADMIN',driverId:null},domain=new Logistics(store),tracking=new TraccarTracking(store);
 const driver=await domain.createDriver(actor,{...cmd(),name:'Chofer uno',username:'driver-one',password:'QA-Driver-2026!'}),otherDriver=await domain.createDriver(actor,{...cmd(),name:'Chofer dos',username:'driver-two',password:'QA-Driver-2026!'});
 const vehicle=await domain.createVehicle(actor,{...cmd(),plate:'ABC-1',capacityWeightGrams:10000,capacityVolumeCm3:10000,odometer:0}),otherVehicle=await domain.createVehicle(actor,{...cmd(),plate:'ABC-2',capacityWeightGrams:10000,capacityVolumeCm3:10000,odometer:0});
 const body={name:'Ruta original',driverId:driver.id,vehicleId:vehicle.id,startAt:new Date(Date.now()-60000).toISOString(),endAt:new Date(Date.now()+3600000).toISOString(),trackingProvider:'TRACCAR'};
 const route=await domain.createRoute(actor,{...cmd(),...body});
 const client=await domain.createClient(actor,{...cmd(),name:'Cliente'});await tracking.clientPolicy(actor,client.id,{...cmd(),deliveryProvider:'NEXORA'});
 const shipment=await domain.createShipment(actor,{...cmd(),clientId:client.id,reference:'ORDER-EDIT',originText:'Deposito',destinationText:'Destino',recipientName:'Receptor',recipientPhone:'',parcelCount:1,weightGrams:100,volumeCm3:100,proofPolicy:'RECEIVER'});
 const parcel=(await store.one('SELECT * FROM parcels WHERE shipment_id=?',shipment.id))!;
 await domain.receive(actor,{...cmd(),shipmentId:shipment.id,codes:[parcel.code],location:'Deposito'});
 await domain.assign(actor,route.id,{...cmd(),expectedVersion:1,parcelIds:[parcel.id],pickup:false});
 const version=async()=> (await domain.route(route.id,actor)).version;
 return {store,actor,domain,tracking,body,route,client,parcel,driver,otherDriver,vehicle,otherVehicle,version};
}
test('editar ruta cambia datos, chofer, vehículo y celular sin perder bultos; idempotencia y permisos',async t=>{
 const f=await fixture(t);await f.store.run('INSERT INTO traccar_devices VALUES(?,?,?,?,?)','77',f.actor.orgId,'NX-EDIT','Celular QA',new Date().toISOString());
 const input={...cmd(),...f.body,name:'Ruta editada',driverId:f.otherDriver.id,vehicleId:f.otherVehicle.id,phoneDeviceId:'77',expectedVersion:await f.version()};
 const result=await f.domain.updateRoute(f.actor,f.route.id,input);assert.deepEqual(await f.domain.updateRoute(f.actor,f.route.id,input),result);
 const saved=await f.domain.route(f.route.id,f.actor);assert.equal(saved.name,'Ruta editada');assert.equal(saved.driver_id,f.otherDriver.id);assert.equal(saved.vehicle_id,f.otherVehicle.id);
 assert.equal((await f.store.one('SELECT device_id FROM traccar_vehicle_bindings WHERE vehicle_id=?',f.otherVehicle.id))!.device_id,'77');
 assert.equal((await f.store.one('SELECT count(*) n FROM route_assignments WHERE route_id=? AND active=1',f.route.id))!.n,1);
 await assert.rejects(async()=>f.domain.updateRoute({...f.actor,role:'DEPOT'},f.route.id,{...input,...cmd(),expectedVersion:await f.version()}),{code:'FORBIDDEN'});
 await assert.rejects(()=>f.domain.updateRoute(f.actor,f.route.id,{...input,...cmd(),expectedVersion:1}),{code:'VERSION_CONFLICT'});
});
test('ruta confirmada permite editar; vehículo cargado exige descargar; ruta despachada conserva su historial',async t=>{
 const f=await fixture(t);
 await f.domain.load(f.actor,f.route.id,{...cmd(),expectedVersion:await f.version(),code:f.parcel.code});
 await f.domain.ready(f.actor,f.route.id,{...cmd(),expectedVersion:await f.version()});
 const before=await f.domain.route(f.route.id,f.actor);
 await assert.rejects(()=>f.domain.updateRoute(f.actor,f.route.id,{...cmd(),...f.body,name:'No guardar',vehicleId:f.otherVehicle.id,expectedVersion:before.version}),{code:'INVALID_TRANSITION'});
 assert.equal((await f.domain.route(f.route.id,f.actor)).name,f.body.name);
 await f.domain.unload(f.actor,f.route.id,{...cmd(),expectedVersion:await f.version(),parcelId:f.parcel.id});
 await f.domain.updateRoute(f.actor,f.route.id,{...cmd(),...f.body,vehicleId:f.otherVehicle.id,driverId:f.otherDriver.id,expectedVersion:await f.version()});
 assert.equal((await f.domain.route(f.route.id,f.actor)).state,'DRAFT');
 await f.store.run("UPDATE routes SET state='IN_PROGRESS' WHERE id=?",f.route.id);
 await assert.rejects(async()=>f.domain.updateRoute(f.actor,f.route.id,{...cmd(),...f.body,expectedVersion:await f.version()}),{code:'INVALID_TRANSITION'});
});
test('editar horario de ruta confirmada detecta chofer y vehículo ocupados y conserva horario anterior',async t=>{
 const f=await fixture(t);await f.domain.load(f.actor,f.route.id,{...cmd(),expectedVersion:await f.version(),code:f.parcel.code});await f.domain.ready(f.actor,f.route.id,{...cmd(),expectedVersion:await f.version()});
 const start=new Date(Date.now()+7200000).toISOString(),end=new Date(Date.now()+10800000).toISOString();
 const other=await f.domain.createRoute(f.actor,{...cmd(),...f.body,name:'Ruta posterior',startAt:start,endAt:end});
 await f.store.run("UPDATE routes SET state='READY' WHERE id=?",other.id);
 await assert.rejects(async()=>f.domain.updateRoute(f.actor,f.route.id,{...cmd(),...f.body,startAt:start,endAt:end,expectedVersion:await f.version()}),(e:any)=>e.code==='VERSION_CONFLICT'&&e.message.includes('Ruta posterior'));
 assert.equal((await f.domain.route(f.route.id,f.actor)).start_at,f.body.startAt);
});
test('guardar el mismo circuito y GPS no falla con una ruta confirmada',async t=>{
 const f=await fixture(t);await f.domain.load(f.actor,f.route.id,{...cmd(),expectedVersion:await f.version(),code:f.parcel.code});await f.domain.ready(f.actor,f.route.id,{...cmd(),expectedVersion:await f.version()});
 assert.equal((await f.tracking.clientPolicy(f.actor,f.client.id,{...cmd(),deliveryProvider:'NEXORA'})).unchanged,true);
 assert.equal((await f.tracking.routePolicy(f.actor,f.route.id,{...cmd(),provider:'TRACCAR'})).unchanged,true);
});
