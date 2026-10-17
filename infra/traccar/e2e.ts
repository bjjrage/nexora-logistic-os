// Live transport acceptance with temporary, labelled fixtures. Always cleans the business DB.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import {PostgresStore} from '../../server/postgres.ts';
import {TraccarTracking} from '../../server/traccar.ts';
import {Logistics} from '../../server/domain.ts';
import {passwordHash,type Actor} from '../../server/auth.ts';
import {lookupOrder} from '../../web-publica/public/tracking.js';
const store=new PostgresStore(process.env.DATABASE_URL??''),org=randomUUID(),user=randomUUID(),command=()=>({commandId:randomUUID()});
const actor:Actor={id:user,orgId:org,name:'QA GPS temporal',role:'ADMIN',driverId:null};
const domain=new Logistics(store),tracking=new TraccarTracking(store),devices:string[]=[],samples:any[]=[];
const configContext:any={window:{}};vm.runInNewContext(readFileSync('web-publica/public/auth-config.js','utf8'),configContext);const config=configContext.window.NEXORA_AUTH_CONFIG;
const gateway=process.env.TRACCAR_GATEWAY_URL!,secret=process.env.TRACCAR_GATEWAY_SECRET!,phone=process.env.TRACCAR_PHONE_URL!;
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const call=async(path:string,body:any,method='POST')=>{const response=await fetch(gateway+path,{method,headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});assert.ok(response.ok,'Gateway status '+response.status);return response.json();};
async function send(identifier:string,latitude:number,longitude:number){const response=await fetch(phone,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({id:identifier,lat:String(latitude),lon:String(longitude),timestamp:new Date().toISOString(),accuracy:'12'}),signal:AbortSignal.timeout(15000)});assert.ok(response.ok,'OsmAnd status '+response.status);}
const lookup=(code:string)=>lookupOrder(code,{config});
try{
 await store.verify();
 await store.transaction(async()=>{
  await store.run('INSERT INTO organizations VALUES(?,?,?)',org,'QA GPS LIVE TEMPORAL','America/Asuncion');
  await store.run("INSERT INTO users VALUES(?,?,?,?,?,'ADMIN',NULL)",user,org,'qa-gps-'+user,'QA GPS',passwordHash(randomUUID()));
 });
 for(let i=0;i<2;i++){
  const client=(await domain.createClient(actor,{...command(),name:'QA GPS cliente temporal '+i})).id;
  await tracking.clientPolicy(actor,client,{...command(),deliveryProvider:'NEXORA'});
  const driver=(await domain.createDriver(actor,{...command(),name:'QA GPS chofer '+i,username:'qa-gps-driver-'+randomUUID(),password:randomUUID()})).id;
  const vehicle=(await domain.createVehicle(actor,{...command(),plate:'QA-GPS-'+randomUUID(),capacityWeightGrams:1000,capacityVolumeCm3:1000,odometer:0})).id;
  const route=(await domain.createRoute(actor,{...command(),name:'QA GPS ruta '+i,driverId:driver,vehicleId:vehicle,startAt:new Date(Date.now()-60000).toISOString(),endAt:new Date(Date.now()+3600000).toISOString()})).id;
  await tracking.routePolicy(actor,route,{...command(),provider:'TRACCAR'});
  const shipment=(await domain.createShipment(actor,{...command(),clientId:client,reference:'QA-GPS-'+randomUUID(),originText:'QA temporal',destinationText:'QA temporal',recipientName:'QA',recipientPhone:'',parcelCount:1,weightGrams:1,volumeCm3:1,proofPolicy:'RECEIVER'})).id;
  const parcel=(await store.one('SELECT * FROM parcels WHERE shipment_id=?',shipment))!;
  // Explicit fixture state for transport/privacy tests; operational transitions have their own domain tests.
  await store.transaction(async()=>{
   await store.run("UPDATE parcels SET state='IN_TRANSIT',custody_type='VEHICLE',custody_id=? WHERE id=?",vehicle,parcel.id);
   await store.run("UPDATE routes SET state='IN_PROGRESS' WHERE id=?",route);
   await store.run('INSERT INTO route_assignments(id,org_id,route_id,parcel_id,pickup,active) VALUES(?,?,?,?,0,1)',randomUUID(),org,route,parcel.id);
   await store.run("INSERT INTO stops(id,org_id,route_id,shipment_id,sequence,kind,state) VALUES(?,?,?,?,1,'DELIVERY','PENDING')",randomUUID(),org,route,shipment);
   await store.run('INSERT INTO custody_events VALUES(?,?,?,?,?,?,?,?,?,?,?)',randomUUID(),org,parcel.id,user,'DEPOT','QA','VEHICLE',vehicle,'DISPATCHED',new Date(Date.now()-1000).toISOString(),randomUUID());
  });
  const device=await call('/devices',{...command(),orgId:org,name:'QA GPS temporal '+i});devices.push(device.id);
  await tracking.bind(actor,vehicle,{...command(),deviceId:device.id});
  assert.equal((await lookup(parcel.code)).gps.status,'NO_POSITION');
  await send(device.identifier,-25.3-i*.1,-57.6-i*.1);
  samples.push({code:parcel.code,parcelId:parcel.id,vehicle,route,device:device.id,identifier:device.identifier,latitude:-25.3-i*.1});
 }
 for(const sample of samples){
  let found;for(let attempt=0;attempt<20;attempt++){found=await lookup(sample.code);if(found?.gps?.position)break;await delay(1000);}
  assert.equal(found?.gps.status,'FRESH');assert.ok(Math.abs(found.gps.position.latitude-sample.latitude)<1e-7);
  assert.deepEqual(Object.keys(found.gps.position).sort(),['accuracy','latitude','longitude','measuredAt','receivedAt']);
  assert.ok(Math.abs((await tracking.route(actor,sample.route)).position.latitude-sample.latitude)<1e-7);
 }
 console.log('PASS: OsmAnd HTTPS → Traccar → WebSocket → Supabase → OS y RPC público, dos vehículos aislados.');
 writeFileSync('.local/traccar/live-qa.json',JSON.stringify({org,samples:samples.map(({identifier,...sample})=>sample)}));
 if(process.argv.includes('--hold')){
  console.log('QA_LINK https://nexoralogisticpy.netlify.app/seguimiento/#codigo='+samples[0].code);
  const deadline=Date.now()+600000;while(!existsSync('.local/traccar/continue-qa')&&Date.now()<deadline)await delay(1000);
 }
 const first=samples[0];await tracking.bind(actor,first.vehicle,{...command(),deviceId:null});assert.equal((await lookup(first.code)).gps.position,null);
 console.log('PASS: desvincular elimina inmediatamente la ubicación pública.');
 await tracking.bind(actor,first.vehicle,{...command(),deviceId:first.device});assert.equal((await lookup(first.code)).gps.position,null);
 await send(first.identifier,-25.31,-57.61);for(let n=0;n<20;n++){if((await lookup(first.code)).gps.position)break;await delay(1000);}
 assert.equal((await lookup(first.code)).gps.position.latitude,-25.31);
 const stop=(await store.one('SELECT id FROM stops WHERE route_id=?',first.route))!;
 await domain.attempt(actor,stop.id,{...command(),expectedVersion:(await domain.route(first.route,actor)).version,deliveredParcelIds:[first.parcelId],failedParcelIds:[],receiverName:'QA temporal',evidenceIds:[],reasonCode:'',nextAction:''});
 assert.equal((await lookup(first.code)).gps.status,'INACTIVE');assert.equal((await lookup(first.code)).gps.position,null);
 await store.run('UPDATE route_assignments SET active=0 WHERE parcel_id=?',samples[1].parcelId);assert.equal((await lookup(samples[1].code)).gps.status,'INACTIVE');
 assert.equal(await lookup('B-00000000000000000000'),null);
 console.log('PASS: entrega, retirada de ruta y códigos desconocidos no revelan GPS.');
}catch(error){console.error('Fallo de la prueba GPS:',error);throw error;}finally{
 await store.run('DELETE FROM traccar_vehicle_bindings WHERE org_id=?',org);
 for(const id of devices){try{await call('/devices/'+id,{orgId:org},'DELETE');}catch{console.error('Pendiente retirar dispositivo QA de Traccar: '+id);}}
 const tables=['traccar_latest','traccar_devices','route_tracking_settings','client_delivery_policies','route_assignments','attempts','custody_events','incidents','stops','parcels','shipments','routes','vehicle_documents','inspections','defects','maintenance','vehicles','audit','idempotency','driver_documents','users','drivers','clients'];
 const cleanup=`BEGIN;\nDO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM nexora.organizations WHERE id='${org}' AND name='QA GPS LIVE TEMPORAL') THEN RAISE EXCEPTION 'Fixture no encontrado'; END IF; END $$;\nDELETE FROM nexora.attempt_items WHERE attempt_id IN(SELECT id FROM nexora.attempts WHERE org_id='${org}');\n`+tables.map(table=>`DELETE FROM nexora.${table} WHERE org_id='${org}';`).join('\n')+`\nDELETE FROM nexora.organizations WHERE id='${org}';\nCOMMIT;`;
 writeFileSync('.local/traccar/cleanup.sql',cleanup);await store.close();console.log('Dispositivos QA retirados. Ejecutar cleanup.sql con el conector administrativo: el historial permanece append-only para el OS.');
}
