import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PostgresStore} from '../server/postgres.ts';
import {ingestTraccarPosition} from '../server/traccar-position.ts';
import {Logistics} from '../server/domain.ts';
import {TraccarTracking} from '../server/traccar.ts';
import {QuadMindsTracking} from '../server/quadminds.ts';
import {passwordHash,type Actor} from '../server/auth.ts';

test('Supabase tracking: guardar y releer asignaciones conserva el contrato JSON del formulario; rollback',async()=>{
 const store=new PostgresStore(process.env.DATABASE_URL??''),org=randomUUID(),user=randomUUID(),rollback=new Error('ROLLBACK_TRACKING_FORM'),command=()=>({commandId:randomUUID()});
 try{
  await assert.rejects(store.transaction(async()=>{
   await store.run('INSERT INTO organizations VALUES(?,?,?)',org,'QA contrato tracking rollback','America/Asuncion');
   await store.run("INSERT INTO users VALUES(?,?,?,?,?,'ADMIN',NULL)",user,org,'qa-tracking-'+user,'QA',passwordHash(randomUUID()));
   const actor:Actor={id:user,orgId:org,name:'QA',role:'ADMIN',driverId:null},domain=new Logistics(store),tracking=new TraccarTracking(store);
   const vehicle=(await domain.createVehicle(actor,{...command(),plate:'QA-'+randomUUID(),capacityWeightGrams:1000,capacityVolumeCm3:1000,odometer:0})).id;
   const device=String(Math.floor(Math.random()*1000000000)+2000000000);
   await store.run('INSERT INTO traccar_devices VALUES(?,?,?,?,?)',device,org,'QA-'+randomUUID(),'QA phone',new Date().toISOString());
   await tracking.bind(actor,vehicle,{...command(),deviceId:device});
   const client=(await domain.createClient(actor,{...command(),name:'QA cliente propio'})).id;
   await tracking.clientPolicy(actor,client,{...command(),deliveryProvider:'NEXORA'});
   const driver=(await domain.createDriver(actor,{...command(),name:'QA chofer',username:'qa-'+randomUUID(),password:randomUUID()})).id;
   const route=(await domain.createRoute(actor,{...command(),name:'QA ruta',driverId:driver,vehicleId:vehicle,startAt:new Date(Date.now()-60000).toISOString(),endAt:new Date(Date.now()+3600000).toISOString()})).id;
   await tracking.routePolicy(actor,route,{...command(),provider:'TRACCAR'});
   // New service/read, as when the user reloads or selects the saved vehicle again.
   const readBack=JSON.parse(JSON.stringify(await new TraccarTracking(store).settings(actor)));
   assert.deepEqual(readBack.bindings,[{vehicleId:vehicle,deviceId:device}]);
   assert.deepEqual(readBack.routes,[{routeId:route,provider:'TRACCAR'}]);
   assert.deepEqual(readBack.policies,[{clientId:client,deliveryProvider:'NEXORA'}]);
   const quad=new QuadMindsTracking(store);
   await quad.bind(actor,vehicle,{...command(),externalVehicleId:'QA-VEHICLE'});
   assert.deepEqual((await new QuadMindsTracking(store).bindings(actor)).bindings,[{vehicleId:vehicle,externalVehicleId:'QA-VEHICLE'}]);
   throw rollback;
  }),error=>error===rollback);
  assert.equal(await store.one('SELECT id FROM organizations WHERE id=?',org),undefined);
 }finally{await store.close();}
});
test('Supabase Traccar: persistencia, regresión, revinculación y permisos privados; rollback',async()=>{
 const store=new PostgresStore(process.env.DATABASE_URL??''),rollback=new Error('ROLLBACK_GPS_QA'),org=randomUUID(),vehicle=randomUUID();
 try{
  await store.verify();
  await assert.rejects(store.transaction(async()=>{
   const time=Date.now(),earlier=new Date(time-10000).toISOString();
   await store.run('INSERT INTO organizations VALUES(?,?,?)',org,'QA GPS rollback','UTC');
   await store.run('INSERT INTO vehicles VALUES(?,?,?,?,?,0,1)',vehicle,org,'QA-'+vehicle,1000,1000);
   const device=String(Math.floor(Math.random()*1000000000)+1000000000),revision=randomUUID();
   await store.run('INSERT INTO traccar_devices VALUES(?,?,?,?,?)',device,org,'QA-'+randomUUID(),'QA phone',earlier);
   await store.run('INSERT INTO traccar_vehicle_bindings VALUES(?,?,?,?,?)',org,vehicle,device,revision,earlier);
   const p={deviceId:Number(device),valid:true,latitude:-25.3,longitude:-57.6,accuracy:10,fixTime:new Date(time).toISOString()};
   assert.equal(await ingestTraccarPosition(store,p,time),true);
   assert.equal(await ingestTraccarPosition(store,{...p,latitude:40,fixTime:earlier},time),false);
   assert.equal((await store.one('SELECT latitude FROM traccar_latest WHERE vehicle_id=?',vehicle))!.latitude,-25.3);
   await store.run('UPDATE traccar_vehicle_bindings SET revision=?,updated_at=? WHERE vehicle_id=?',randomUUID(),new Date(time+1).toISOString(),vehicle);
   assert.equal(await ingestTraccarPosition(store,p,time),false);
   assert.equal(await ingestTraccarPosition(store,{...p,fixTime:new Date(time+2).toISOString()},time+2),true);
   const perms=await store.one("SELECT has_table_privilege('anon','nexora.traccar_latest','SELECT') AS anonymous,has_table_privilege('nexora_tracking_worker','nexora.shipments','SELECT') AS orders,has_table_privilege('nexora_tracking_worker','nexora.users','SELECT') AS users");
   assert.equal(perms!.anonymous,false);assert.equal(perms!.orders,false);assert.equal(perms!.users,false);
   throw rollback;
  }),e=>e===rollback);
  assert.equal(await store.one('SELECT id FROM organizations WHERE id=?',org),undefined);
 }finally{await store.close();}
});
