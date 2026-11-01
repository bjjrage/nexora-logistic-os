import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PostgresStore} from '../server/postgres.ts';
import {Logistics} from '../server/domain.ts';
import {Inventory} from '../server/inventory.ts';
import {CompanyAdministration} from '../server/company.ts';
import {passwordHash,hash,actorFromRequest,type Actor} from '../server/auth.ts';
import {configureDelivery} from './support/delivery-policy.ts';
import {reconcileInventory} from '../server/reconciliation.ts';
import {createAlertingSink} from '../server/alerts.ts';

test('PostgreSQL aislado: revocación, última asignación, capacidad real y reintento explícito',async()=>{
 const connection=process.env.DATABASE_URL??'',url=new URL(connection);
 assert.ok(['localhost','127.0.0.1'].includes(url.hostname)&&url.pathname==='/nexora_test','Solo nexora_test local');
 const store=new PostgresStore(connection),rollback=new Error('ROLLBACK_AUDIT_FIXES'),orgId=randomUUID(),id=randomUUID(),command=()=>({commandId:randomUUID()});
 try{
  await store.verify();
  await assert.rejects(store.transaction(async()=>{
   await store.run('INSERT INTO organizations VALUES(?,?,?)',orgId,'QA audit isolated','UTC');
   await store.run("INSERT INTO users(id,org_id,username,name,password_hash,role,driver_id) VALUES(?,?,?,?,?,'ADMIN',NULL)",id,orgId,'qa-'+id,'QA admin',passwordHash(randomUUID()));
   const actor:Actor={id,orgId,name:'QA',role:'ADMIN',driverId:null},domain=new Logistics(store),inventory=new Inventory(store),company=new CompanyAdministration(store);
   const user=(await domain.createUser(actor,{...command(),name:'QA depot',username:'qa-'+randomUUID(),password:randomUUID(),role:'DEPOT'})).id;
   const token='a'.repeat(64);await store.run('INSERT INTO sessions VALUES(?,?,?)',hash(token),user,new Date(Date.now()+60000).toISOString());
   const req={headers:{cookie:'logistics_session='+token}} as any;
   assert.equal((await actorFromRequest(store,req))!.id,user);
   await company.setAccess(actor,user,{...command(),enabled:false});assert.equal(await actorFromRequest(store,req),null);
   assert.equal((await store.one('SELECT enabled FROM users WHERE id=?',user))!.enabled,0);
   const clientId=(await domain.createClient(actor,{...command(),name:'QA client'})).id;await configureDelivery(store,actor,clientId);
   const driverId=(await domain.createDriver(actor,{...command(),name:'QA driver',username:'qa-'+randomUUID(),password:randomUUID()})).id;
   const vehicleId=(await domain.createVehicle(actor,{...command(),plate:'QA '+id,capacityWeightGrams:10000,capacityVolumeCm3:10000,odometer:0})).id;
   const shipmentId=(await domain.createShipment(actor,{...command(),clientId,reference:'QA',originText:'QA',destinationText:'QA',recipientName:'QA',recipientPhone:'',proofPolicy:'RECEIVER',parcelCount:1,weightGrams:8000,volumeCm3:1000})).id;
   const p=(await store.one('SELECT * FROM parcels WHERE shipment_id=?',shipmentId))!;
   const routeId=(await domain.createRoute(actor,{...command(),name:'QA route',driverId,vehicleId,startAt:new Date(Date.now()-60000).toISOString(),endAt:new Date(Date.now()+600000).toISOString()})).id;
   const version=async()=>(await store.one('SELECT version FROM routes WHERE id=?',routeId))!.version;
   await domain.receive(actor,{...command(),shipmentId,codes:[p.code],location:'QA'});
   await domain.assign(actor,routeId,{...command(),expectedVersion:await version(),parcelIds:[p.id],pickup:false});
   await domain.load(actor,routeId,{...command(),expectedVersion:await version(),code:p.code});await domain.ready(actor,routeId,{...command(),expectedVersion:await version()});
   await domain.inspect(actor,vehicleId,{...command(),odometer:0,fuelPercent:80,items:[{label:'QA',severity:'OK',note:''}]});
   await domain.dispatch(actor,routeId,{...command(),expectedVersion:await version()});
   const stop=(await store.one("SELECT id FROM stops WHERE route_id=? AND kind='DELIVERY'",routeId))!;
   await domain.attempt(actor,stop.id,{...command(),expectedVersion:await version(),deliveredParcelIds:[],failedParcelIds:[p.id],receiverName:'',evidenceIds:[],reasonCode:'ABSENT',nextAction:'Volver'});
   const failedVersion=await version();
   await assert.rejects(()=>domain.attempt(actor,stop.id,{...command(),expectedVersion:failedVersion,deliveredParcelIds:[],failedParcelIds:[p.id],receiverName:'',evidenceIds:[],reasonCode:'ABSENT',nextAction:'Volver'}),{code:'INVALID_TRANSITION'});
   await domain.retryDelivery(actor,stop.id,{...command(),expectedVersion:await version()});
   await domain.attempt(actor,stop.id,{...command(),expectedVersion:await version(),deliveredParcelIds:[p.id],failedParcelIds:[],receiverName:'QA',evidenceIds:[],reasonCode:'',nextAction:''});
   const driver=(await store.one('SELECT id FROM users WHERE driver_id=?',driverId))!,driverActor:Actor={...actor,id:driver.id,role:'DRIVER',driverId};
   assert.equal((await domain.bootstrap(driverActor)).parcels.length,1);
   const otherDriver=(await domain.createDriver(actor,{...command(),name:'QA second',username:'qa-'+randomUUID(),password:randomUUID()})).id;
   const otherRoute=(await domain.createRoute(actor,{...command(),name:'QA reassigned',driverId:otherDriver,vehicleId,startAt:new Date(Date.now()+3600000).toISOString(),endAt:new Date(Date.now()+7200000).toISOString()})).id;
   await store.run('INSERT INTO route_assignments VALUES(?,?,?,?,0,1)',randomUUID(),orgId,otherRoute,p.id);
   await assert.rejects(()=>domain.parcel(p.id,driverActor),{code:'FORBIDDEN'});
   assert.equal((await domain.bootstrap(driverActor)).parcels.length,0);
   await store.run("UPDATE parcels SET state='IN_TRANSIT',custody_type='VEHICLE',custody_id=? WHERE id=?",vehicleId,p.id);
   await assert.rejects(()=>domain.vehicleCapacity(actor,vehicleId,[{id:'extra',weight_grams:8000,volume_cm3:1000}]),{code:'CAPACITY_EXCEEDED'});
   const locationId=(await inventory.createLocation(actor,{...command(),code:'QA',name:'QA'})).id;
   const product=(await inventory.createProduct(actor,{...command(),clientId,sku:'QA',name:'QA',tracking:'QUANTITY'})).id;
   const input={...command(),orders:[{clientId,externalId:'QA import',orderDate:'2026-10-17',destination:'QA',recipientName:'QA',lines:[{productId:product,quantity:1}]}]};
   const original=store.run.bind(store);let fail=true;
   store.run=async(sql,...args)=>{if(fail&&sql.includes('INSERT INTO inventory_import_runs')){fail=false;throw new Error('QA transient');}return original(sql,...args);};
   await assert.rejects(()=>inventory.importOrders(actor,input),/QA transient/);
   assert.equal((await store.one('SELECT COUNT(*) n FROM inventory_import_runs WHERE org_id=?',orgId))!.n,0);
   assert.equal((await inventory.importOrders(actor,input)).imported,1);
   await inventory.updateLocation(actor,locationId,{...command(),active:false});
   await assert.rejects(()=>inventory.adjust(actor,{...command(),clientId,productId:product,locationId,quantityDelta:1,reason:'QA'}),{code:'INVALID_TRANSITION'});
   throw rollback;
  }),e=>e===rollback);
  assert.equal(await store.one('SELECT id FROM organizations WHERE id=?',orgId),undefined);
 }finally{await store.close();}
});

test('PostgreSQL aislado: sender handover settles quantity and serial inventory atomically',async()=>{
 const connection=process.env.DATABASE_URL??'',url=new URL(connection);
 assert.ok(['localhost','127.0.0.1'].includes(url.hostname)&&url.pathname==='/nexora_test','Only local nexora_test is allowed');
 const store=new PostgresStore(connection),rollback=new Error('ROLLBACK_RETURN_DISPOSITIONS'),orgId=randomUUID(),userId=randomUUID(),command=()=>({commandId:randomUUID()});
 try{
  await store.verify();
  await assert.rejects(store.transaction(async()=>{
   await store.run('INSERT INTO organizations VALUES(?,?,?)',orgId,'QA return disposition isolated','UTC');
   await store.run("INSERT INTO users(id,org_id,username,name,password_hash,role,driver_id) VALUES(?,?,?,?,?,'ADMIN',NULL)",userId,orgId,'qa-'+userId,'QA admin',passwordHash('QA-Return-2026!'));
   const actor:Actor={id:userId,orgId,name:'QA admin',role:'ADMIN',driverId:null},domain=new Logistics(store),inventory=new Inventory(store);
   const clientId=(await domain.createClient(actor,{...command(),name:'QA client'})).id;
   await configureDelivery(store,actor,clientId);
   const stock=(await inventory.createLocation(actor,{...command(),code:'QA-STOCK-'+orgId.slice(0,6),name:'QA stock',kind:'STORAGE'})).id;
   const quarantine=(await inventory.createLocation(actor,{...command(),code:'QA-QRT-'+orgId.slice(0,6),name:'QA quarantine',kind:'QUARANTINE'})).id;
   const upload=async(parcelId:string,suffix:string)=>{
    const bytes=Buffer.from([137,80,78,71,13,10,26,10,...Buffer.from(suffix)]);
    return (await domain.upload(actor,{...command(),parcelId,filename:suffix+'.png',mimeType:'image/png',dataBase64:bytes.toString('base64')})).id as string;
   };
   for(const tracking of ['QUANTITY','SERIAL'] as const){
    const suffix=tracking+'-'+orgId.slice(0,6),product=(await inventory.createProduct(actor,{...command(),clientId,sku:suffix,name:suffix,tracking})).id;
    const serial=tracking==='SERIAL'?'QA-SERIAL-'+orgId.slice(0,8):undefined;
    await inventory.receive(actor,{...command(),clientId,productId:product,locationId:stock,quantity:1,...(serial?{serials:[{serial}]}:{})});
    const order=(await inventory.createOrder(actor,{...command(),clientId,externalId:'QA-'+suffix,orderDate:'2026-10-31',destination:'QA',recipientName:'QA recipient',lines:[{productId:product,quantity:1}]}));
    const reservation=await inventory.reserveOrder(actor,order.id,{...command(),locationId:stock}),parcelId=reservation.parcels[0].id as string;
    const driverId=(await domain.createDriver(actor,{...command(),name:'QA driver',username:'qa-'+randomUUID(),password:'QA-Driver-2026!'})).id;
    const vehicleId=(await domain.createVehicle(actor,{...command(),plate:'QA-'+randomUUID().slice(0,8),capacityWeightGrams:10000,capacityVolumeCm3:10000,odometer:0})).id;
    const route=await domain.createRoute(actor,{...command(),name:'QA return',driverId,vehicleId,startAt:new Date(Date.now()-60000).toISOString(),endAt:new Date(Date.now()+3600000).toISOString()});
    await domain.assign(actor,route.id,{...command(),expectedVersion:route.version,parcelIds:[parcelId],pickup:false});
    await inventory.loadOrder(actor,order.id,{...command(),routeId:route.id,expectedVersion:(await domain.route(route.id,actor)).version,codes:[reservation.parcels[0].code]});
    await domain.ready(actor,route.id,{...command(),expectedVersion:(await domain.route(route.id,actor)).version});
    await domain.inspect(actor,vehicleId,{...command(),odometer:0,fuelPercent:90,items:[{label:'QA',severity:'OK',note:''}]});
    await domain.dispatch(actor,route.id,{...command(),expectedVersion:(await domain.route(route.id,actor)).version});
    await store.run(`INSERT INTO quad_parcel_links(org_id,parcel_id,external_code,poi_id,delivery_date,payload,state,updated_at,provider_result,evidence_state,reported_at,receiver_name)
     VALUES(?,?,?,?,?,?, 'EXPORTED',?,?,?, ?,?)`,orgId,parcelId,'NX-'+randomUUID(),123,'2026-10-31','{}',new Date().toISOString(),'FAILED','PENDING',new Date().toISOString(),'');
    const stop=(await store.one("SELECT id FROM stops WHERE org_id=? AND route_id=? AND kind='DELIVERY'",orgId,route.id))!;
    await domain.attempt(actor,stop.id,{...command(),expectedVersion:(await domain.route(route.id,actor)).version,deliveredParcelIds:[],failedParcelIds:[parcelId],receiverName:'',evidenceIds:[],reasonCode:'ABSENT',nextAction:'Return'});
    const incident=(await store.one('SELECT id FROM incidents WHERE org_id=? AND parcel_id=?',orgId,parcelId))!;
    const returned=await domain.authorizeReturn(actor,incident.id,command());
    await inventory.returnOrder(actor,order.id,{...command(),locationId:quarantine,returns:[{returnId:returned.id,evidenceId:await upload(parcelId,'depot-'+tracking)}]});
    const foreignOrg=randomUUID(),foreignActor=randomUUID();
    await store.run('INSERT INTO organizations VALUES(?,?,?)',foreignOrg,'QA foreign org','UTC');
    await store.run("INSERT INTO users(id,org_id,username,name,password_hash,role,driver_id) VALUES(?,?,?,?,?,'ADMIN',NULL)",foreignActor,foreignOrg,'qa-'+foreignActor,'QA foreign actor',passwordHash(randomUUID()));
    const expectRejectedInsert=(rowOrg:string,rowActor:string)=>store.transaction(()=>store.run(
     'INSERT INTO return_dispositions(return_id,org_id,disposition,actor_id,command_id,created_at) VALUES(?,?,?,?,?,?)',
     returned.id,rowOrg,'SENT_TO_SENDER',rowActor,randomUUID(),new Date().toISOString()));
    await assert.rejects(()=>expectRejectedInsert(orgId,foreignActor),{code:'VALIDATION_ERROR'});
    await assert.rejects(()=>expectRejectedInsert(foreignOrg,foreignActor),{code:'VALIDATION_ERROR'});
    assert.ok(await store.one("SELECT tgname FROM pg_trigger WHERE tgrelid='return_dispositions'::regclass AND NOT tgisinternal AND tgname='return_dispositions_append_only'"));
    assert.ok(await store.one("SELECT tgname FROM pg_trigger WHERE tgrelid='return_dispositions'::regclass AND NOT tgisinternal AND tgname='return_dispositions_no_truncate'"));
    const senderInput={...command(),receiverName:'QA sender',evidenceId:await upload(parcelId,'sender-'+tracking)};
    const sent=await domain.sendReturn(actor,returned.id,senderInput);
    assert.deepEqual(await domain.sendReturn(actor,returned.id,senderInput),sent);
    assert.equal((await store.one('SELECT disposition FROM return_dispositions WHERE return_id=?',returned.id))!.disposition,'SENT_TO_SENDER');
    await assert.rejects(()=>store.transaction(()=>store.run("UPDATE return_dispositions SET disposition='RESTOCKED' WHERE return_id=?",returned.id)),{code:'42501'});
    assert.equal((await store.one("SELECT COUNT(*) AS n FROM inventory_movements WHERE org_id=? AND parcel_id=? AND action='RETURN' AND from_status='QUARANTINE' AND to_status IS NULL",orgId,parcelId))!.n,1);
    if(serial)assert.equal((await store.one('SELECT status FROM inventory_units WHERE org_id=? AND serial=?',orgId,serial))!.status,'ADJUSTED');
    assert.equal((await reconcileInventory(store,actor)).ok,true);
    await assert.rejects(()=>inventory.release(actor,order.id,{...command(),locationId:stock,parcelIds:[parcelId],reason:'Sender already received'}),{code:'INVALID_TRANSITION'});
   }
   const restockProduct=(await inventory.createProduct(actor,{...command(),clientId,sku:'PG-RESTOCK-'+orgId.slice(0,6),name:'PG restock quantity',tracking:'QUANTITY'})).id;
   await inventory.receive(actor,{...command(),clientId,productId:restockProduct,locationId:stock,quantity:1});
   const restockOrder=await inventory.createOrder(actor,{...command(),clientId,externalId:'PG-RESTOCK-'+orgId,orderDate:'2026-10-31',destination:'QA restock',recipientName:'QA recipient',lines:[{productId:restockProduct,quantity:1}]});
   const restockReservation=await inventory.reserveOrder(actor,restockOrder.id,{...command(),locationId:stock}),restockParcelId=restockReservation.parcels[0].id as string;
   const restockDriver=(await domain.createDriver(actor,{...command(),name:'QA restock driver',username:'qa-restock-'+randomUUID(),password:'QA-Return-2026!'})).id;
   const restockVehicle=(await domain.createVehicle(actor,{...command(),plate:'QA-RS-'+randomUUID().slice(0,8),capacityWeightGrams:10000,capacityVolumeCm3:10000,odometer:0})).id;
   const restockRoute=await domain.createRoute(actor,{...command(),name:'QA restock return',driverId:restockDriver,vehicleId:restockVehicle,startAt:new Date(Date.now()-60000).toISOString(),endAt:new Date(Date.now()+3600000).toISOString()});
   await domain.assign(actor,restockRoute.id,{...command(),expectedVersion:restockRoute.version,parcelIds:[restockParcelId],pickup:false});
   await inventory.loadOrder(actor,restockOrder.id,{...command(),routeId:restockRoute.id,expectedVersion:(await domain.route(restockRoute.id,actor)).version,codes:[restockReservation.parcels[0].code]});
   await domain.ready(actor,restockRoute.id,{...command(),expectedVersion:(await domain.route(restockRoute.id,actor)).version});
   await domain.inspect(actor,restockVehicle,{...command(),odometer:0,fuelPercent:90,items:[{label:'QA',severity:'OK',note:''}]});
   await domain.dispatch(actor,restockRoute.id,{...command(),expectedVersion:(await domain.route(restockRoute.id,actor)).version});
   await store.run(`INSERT INTO quad_parcel_links(org_id,parcel_id,external_code,poi_id,delivery_date,payload,state,updated_at,provider_result,evidence_state,reported_at,receiver_name)
    VALUES(?,?,?,?,?,?, 'EXPORTED',?,?,?, ?,?)`,orgId,restockParcelId,'NX-'+randomUUID(),124,'2026-10-31','{}',new Date().toISOString(),'FAILED','PENDING',new Date().toISOString(),'');
   const restockStop=(await store.one("SELECT id FROM stops WHERE org_id=? AND route_id=? AND kind='DELIVERY'",orgId,restockRoute.id))!;
   await domain.attempt(actor,restockStop.id,{...command(),expectedVersion:(await domain.route(restockRoute.id,actor)).version,deliveredParcelIds:[],failedParcelIds:[restockParcelId],receiverName:'',evidenceIds:[],reasonCode:'ABSENT',nextAction:'Restock disposition'});
   const restockIncident=(await store.one('SELECT id FROM incidents WHERE org_id=? AND parcel_id=?',orgId,restockParcelId))!;
   const restockReturn=await domain.authorizeReturn(actor,restockIncident.id,command());
   const restockEvidence=(await domain.upload(actor,{...command(),parcelId:restockParcelId,filename:'depot-restock.png',mimeType:'image/png',dataBase64:Buffer.from([137,80,78,71,13,10,26,10,...Buffer.from('depot-restock')]).toString('base64')})).id as string;
   await inventory.returnOrder(actor,restockOrder.id,{...command(),locationId:quarantine,returns:[{returnId:restockReturn.id,evidenceId:restockEvidence}]});
   assert.equal((await reconcileInventory(store,actor)).ok,true);
   const releaseInput={...command(),locationId:stock,parcelIds:[restockParcelId],reason:'QA restock disposition'};
   assert.deepEqual(await inventory.release(actor,restockOrder.id,releaseInput),{id:restockOrder.id,released:1});
   const restockDisposition=(await store.one("SELECT disposition,command_id FROM return_dispositions WHERE org_id=? AND return_id=?",orgId,restockReturn.id))!;
   assert.equal(restockDisposition.disposition,'RESTOCKED');
   const restockState=(await store.one('SELECT state,custody_id,location_id FROM inventory_order_parcels WHERE org_id=? AND parcel_id=?',orgId,restockParcelId))!;
   assert.equal(restockState.state,'RELEASED');assert.equal(restockState.custody_id,'');assert.equal(restockState.location_id,stock);
   assert.equal((await store.one("SELECT COUNT(*) AS n FROM inventory_movements WHERE org_id=? AND parcel_id=? AND command_id=? AND action='RELEASE' AND from_status='QUARANTINE' AND to_status='AVAILABLE' AND to_location_id=?",orgId,restockParcelId,restockDisposition.command_id,stock))!.n,1);
   assert.equal((await reconcileInventory(store,actor)).ok,true);
   await assert.rejects(()=>domain.sendReturn(actor,restockReturn.id,{...command(),receiverName:'QA sender',evidenceId:randomUUID()}),{code:'INVALID_TRANSITION'});
   throw rollback;
  }),error=>error===rollback);
  assert.equal(await store.one('SELECT id FROM organizations WHERE id=?',orgId),undefined);
 }finally{await store.close();}
});

test('PostgreSQL aislado: alert outbox retries after restart, recovers leases, serializes concurrent workers and restricts grants',async()=>{
 const connection=process.env.DATABASE_URL??'',url=new URL(connection);
 assert.ok(['localhost','127.0.0.1'].includes(url.hostname)&&url.pathname==='/nexora_test'&&url.port,'Solo nexora_test local con puerto explícito');
 const storeA=new PostgresStore(connection),storeB=new PostgresStore(connection),requestA=randomUUID(),requestB=randomUUID();
 let releaseFetch!:()=>void,fetchStarted!:()=>void,concurrentCalls=0,restartCalls=0;
 const alertPayloads:Record<string,unknown>[]=[],outboxLogs:Record<string,unknown>[]=[];
 const started=new Promise<void>(resolve=>{fetchStarted=resolve}),blockedFetch=new Promise<void>(resolve=>{releaseFetch=resolve});
 let firstSink:ReturnType<typeof createAlertingSink>|undefined,restartSink:ReturnType<typeof createAlertingSink>|undefined;
 let workerA:ReturnType<typeof createAlertingSink>|undefined,workerB:ReturnType<typeof createAlertingSink>|undefined;
 try{
  await storeA.verify();
  const grants=await storeA.one(`SELECT c.relrowsecurity AS rls,
    has_table_privilege('nexora_runtime','nexora.alert_outbox','SELECT') AS runtime_select,
    has_table_privilege('nexora_runtime','nexora.alert_outbox','INSERT') AS runtime_insert,
    has_table_privilege('nexora_runtime','nexora.alert_outbox','UPDATE') AS runtime_update,
    has_table_privilege('nexora_runtime','nexora.alert_outbox','DELETE') AS runtime_delete,
    has_table_privilege('anon','nexora.alert_outbox','SELECT') AS anon_select,
    has_table_privilege('authenticated','nexora.alert_outbox','INSERT') AS authenticated_insert
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='nexora' AND c.relname='alert_outbox'`);
  assert.equal(grants?.rls,true);assert.equal(grants?.runtime_select,true);assert.equal(grants?.runtime_insert,true);assert.equal(grants?.runtime_update,true);assert.equal(grants?.runtime_delete,true);assert.equal(grants?.anon_select,false);assert.equal(grants?.authenticated_insert,false);
  assert.equal((await storeA.one("SELECT rolbypassrls FROM pg_roles WHERE rolname='nexora_runtime'"))!.rolbypassrls,false);

  firstSink=createAlertingSink(storeA,entry=>outboxLogs.push(entry),{url:'https://alerts.example.test/hook',autoStart:false,maxAttempts:3,retryDelaysMs:[60_000,60_000],minimumIntervalMs:0,
   fetcher:async(_url,init)=>{alertPayloads.push(JSON.parse(String(init?.body)));return new Response(null,{status:503});}});
  firstSink.handle({event:'server.error',requestId:requestA,errorType:'DatabaseError'});
  await firstSink.flush();
  let persisted=(await storeA.one('SELECT id,attempts,next_attempt_at,lease_until,delivered_at,failed_at,last_status FROM alert_outbox WHERE request_id=?',requestA))!;
  assert.equal(persisted.attempts,1);assert.equal(persisted.last_status,503,JSON.stringify({attempts:persisted.attempts,nextAttemptAt:persisted.next_attempt_at,logs:outboxLogs.map(({event,errorType})=>({event,errorType}))}));assert.equal(persisted.lease_until,null);assert.equal(persisted.delivered_at,null);assert.equal(persisted.failed_at,null);
  firstSink.close();

  // Simulate a process dying after claiming an alert: it has an expired lease and remains durable.
  await storeA.run('UPDATE alert_outbox SET lease_until=?,next_attempt_at=? WHERE id=?',new Date(0).toISOString(),new Date(0).toISOString(),persisted.id);
  restartSink=createAlertingSink(storeB,()=>{},{url:'https://alerts.example.test/hook',autoStart:false,maxAttempts:3,retryDelaysMs:[0,0],minimumIntervalMs:0,
   fetcher:async(_url,init)=>{restartCalls++;alertPayloads.push(JSON.parse(String(init?.body)));return new Response(null,{status:204});}});
  await restartSink.flush();
  persisted=(await storeA.one('SELECT attempts,lease_until,delivered_at,failed_at FROM alert_outbox WHERE id=?',persisted.id))!;
  assert.equal(restartCalls,1);assert.equal(persisted.attempts,2);assert.equal(persisted.lease_until,null);assert.ok(persisted.delivered_at);assert.equal(persisted.failed_at,null);
  assert.equal(alertPayloads.length,2);const alertId=(await storeA.one('SELECT id FROM alert_outbox WHERE request_id=?',requestA))!.id;
  assert.ok(alertPayloads.every(payload=>payload.alertId===alertId),'la referencia del outbox permanece estable entre intentos');
  assert.ok(alertPayloads.every(payload=>payload.requestId===requestA),'la referencia se conserva idéntica entre el POST fallido y el reintento');

  // Two independent pools race on one due row. Only the worker holding its lease may POST.
  workerA=createAlertingSink(storeA,()=>{},{url:'https://alerts.example.test/hook',autoStart:false,maxAttempts:3,retryDelaysMs:[0,0],minimumIntervalMs:0,
   fetcher:async()=>{concurrentCalls++;fetchStarted();await blockedFetch;return new Response(null,{status:204});}});
  workerB=createAlertingSink(storeB,()=>{},{url:'https://alerts.example.test/hook',autoStart:false,maxAttempts:3,retryDelaysMs:[0,0],minimumIntervalMs:0,
   fetcher:async()=>{concurrentCalls++;return new Response(null,{status:204});}});
  workerA.handle({event:'server.fatal',requestId:requestB,errorType:'Error'});
  await started;
  let leased=(await storeB.one('SELECT attempts,lease_until FROM alert_outbox WHERE request_id=?',requestB))!;
  assert.equal(leased.attempts,1);assert.ok(leased.lease_until);
  await workerB.flush();assert.equal(concurrentCalls,1,'el segundo worker no vuelve a reclamar la misma lease activa');
  releaseFetch();await workerA.flush();
  leased=(await storeB.one('SELECT attempts,lease_until,delivered_at FROM alert_outbox WHERE request_id=?',requestB))!;
  assert.equal(concurrentCalls,1);assert.equal(leased.attempts,1);assert.equal(leased.lease_until,null);assert.ok(leased.delivered_at);
 }finally{
  releaseFetch();firstSink?.close();restartSink?.close();workerA?.close();workerB?.close();
  await storeA.run('DELETE FROM alert_outbox WHERE request_id IN (?,?)',requestA,requestB).catch(()=>{});
  await Promise.all([storeA.close(),storeB.close()]);
 }
});
