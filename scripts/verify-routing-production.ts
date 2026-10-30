import {randomUUID,randomBytes} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from '@playwright/test';
import {PostgresStore} from '../server/postgres.ts';
import {passwordHash,hash,type Actor} from '../server/auth.ts';
import {Logistics} from '../server/domain.ts';
import {Inventory} from '../server/inventory.ts';
import {Routing} from '../server/routing.ts';
import {solveLocal} from '../server/routing-providers.ts';
import {reconcileInventory} from '../server/reconciliation.ts';

// Explicit opt-in. All operational fixtures are rolled back, including audit/custody events.
if(process.env.ROUTING_PRODUCTION_VERIFY!=='1')throw new Error('Requiere ROUTING_PRODUCTION_VERIFY=1 y la configuración privada del OS.');
const origin=new URL(process.env.ROUTING_VERIFY_ORIGIN??'https://nexora-logistic-os.vercel.app');
if(origin.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(origin.hostname))throw new Error('Origen no autorizado para verificar.');
const db=new PostgresStore(process.env.DATABASE_URL??'',process.env.DATABASE_SCHEMA??'nexora');
const actor:Actor={id:randomUUID(),orgId:randomUUID(),name:'QA ROUTING TEMPORAL',role:'ADMIN',driverId:null};
const token=randomBytes(32).toString('hex'),cmd=()=>({commandId:randomUUID()}),folder='.local/routing-production-verification';
mkdirSync(folder,{recursive:true});
writeFileSync(folder+'/cleanup.json',JSON.stringify({orgId:actor.orgId,userId:actor.id}));
const report:Record<string,unknown>={origin:origin.origin,operationalFixtures:'ROLLBACK',startedAt:new Date().toISOString()};
async function api(path:string,body?:unknown){
 const r=await fetch(new URL(path,origin),{method:body===undefined?'GET':'POST',headers:{Cookie:'logistics_session='+token,Origin:origin.origin,'X-Requested-With':'logistics-os','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
 const data=await r.json();if(!r.ok)throw new Error(`${path}: ${r.status} ${data.error?.message??''}`);return data;
}
let identity=false;
try{
 await db.verify();
 await db.transaction(async()=>{
  await db.run('INSERT INTO organizations(id,name,timezone) VALUES(?,?,?)',actor.orgId,'QA ROUTING TEMPORAL','UTC');
  await db.run('INSERT INTO users(id,org_id,username,name,password_hash,role) VALUES(?,?,?,?,?,?)',actor.id,actor.orgId,'qa-routing-'+actor.id,actor.name,passwordHash(randomBytes(24).toString('hex')),'ADMIN');
  await db.run('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)',hash(token),actor.id,new Date(Date.now()+30*60000).toISOString());
 });identity=true;
 const context=await api('/api/routing/context');
 if(!context.configured.roads||!context.configured.addresses)throw new Error('Faltan servicios de mapas en el servidor publicado.');
 if(context.locations.length||context.vehicles.length||context.drivers.length)throw new Error('La organización QA no está aislada.');
 const places:Array<{name:string;latitude:number;longitude:number}>=[];
 for(const address of ['Avenida España, Asunción, Paraguay','Avenida Brasilia, Asunción, Paraguay','Avenida Mariscal López, Asunción, Paraguay']){
  const matches=await api('/api/routing/search',{address});if(!matches.length)throw new Error('No se encontró la dirección QA: '+address);
  places.push(matches[0]);
 }
 report.geocoding=places.map(p=>({name:p.name,latitude:p.latitude,longitude:p.longitude}));
 const matrix=await api('/api/routing/matrix',{points:places.map(p=>({latitude:p.latitude,longitude:p.longitude}))});
 if(matrix.length!==3||matrix.some((r:number[])=>r.length!==3)||matrix[0][1]<=0)throw new Error('La matriz real no contiene tiempos viales válidos.');report.realRoadSeconds=matrix;
 const browser=await chromium.launch({headless:true});
 try{
  const browserContext=await browser.newContext({viewport:{width:1365,height:900},timezoneId:'UTC'});
  await browserContext.addCookies([{name:'logistics_session',value:token,url:origin.origin,httpOnly:true,secure:origin.protocol==='https:',sameSite:'Strict'}]);
  const page=await browserContext.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin.origin);await page.getByRole('button',{name:'Pedidos',exact:true}).click();await page.getByRole('button',{name:'Organizar reparto',exact:true}).click();
  await page.getByRole('region',{name:'Organizar reparto'}).getByRole('heading',{name:'Organizar reparto',exact:true}).waitFor();
  await page.screenshot({path:folder+'/published-panel.png',fullPage:true});
  if(errors.length)throw new Error('Errores en la pantalla publicada: '+errors.join(';'));report.browser='PASS';
 }finally{await browser.close();}
 const rollback=new Error('ROLLBACK_ROUTING_VERIFICATION');
 try{await db.transaction(async()=>{
  const domain=new Logistics(db),inv=new Inventory(db),date=new Date().toISOString().slice(0,10);
  const client=(await domain.createClient(actor,{...cmd(),name:'Cliente QA de ruteo'})).id;
  await db.run('INSERT INTO client_delivery_policies VALUES(?,?,?,?)',actor.orgId,client,'NEXORA',new Date().toISOString());
  const product=(await inv.createProduct(actor,{...cmd(),clientId:client,sku:'QA-ROUTING',name:'Artículo QA',tracking:'QUANTITY',weightGrams:100,volumeCm3:100})).id;
  const location=(await inv.createLocation(actor,{...cmd(),code:'QA',name:'Base QA'})).id;
  await inv.receive(actor,{...cmd(),clientId:client,productId:product,locationId:location,quantity:4});
  const fleet=[];
  for(let i=0;i<2;i++){
   const driverId=(await domain.createDriver(actor,{...cmd(),name:'Chofer QA '+i,username:'qa-'+randomUUID(),password:randomBytes(20).toString('hex')})).id;
   const vehicleId=(await domain.createVehicle(actor,{...cmd(),plate:'QA-'+i,capacityWeightGrams:250,capacityVolumeCm3:250,odometer:0})).id;fleet.push({driverId,vehicleId});
  }
  const routing=new Routing(db,{search:address=>api('/api/routing/search',{address}),matrix:points=>api('/api/routing/matrix',{points}),solve:solveLocal});
  await routing.point(actor,{...cmd(),kind:'LOCATION',id:location,latitude:places[0].latitude,longitude:places[0].longitude});
  for(let i=1;i<3;i++){
   const order=(await inv.createOrder(actor,{...cmd(),clientId:client,externalId:'QA-'+i,orderDate:date,destination:places[i].name,recipientName:'Receptor QA '+i,lines:[{productId:product,quantity:2}]})).id;
   await routing.point(actor,{...cmd(),kind:'ORDER',id:order,latitude:places[i].latitude,longitude:places[i].longitude});
  }
  const proposal=await routing.preview(actor,{date,locationId:location,startAt:date+'T08:00:00Z',endAt:date+'T18:00:00Z',fleet});
  if(proposal.routes.length!==2||proposal.pending.length)throw new Error('La planificación real no distribuyó los dos pedidos completos.');
  const applied=await routing.apply(actor,{...cmd(),planId:proposal.id});
  const replay=await routing.apply(actor,{...cmd(),planId:proposal.id});if(JSON.stringify(applied)!==JSON.stringify(replay))throw new Error('La aplicación no es idempotente.');
  await db.run('INSERT INTO organization_test_mode VALUES(?,1)',actor.orgId);
  for(const planned of applied.routes){
   const version=async()=>(await domain.route(planned.id,actor)).version;
   const ids=(await db.all('SELECT parcel_id FROM route_assignments WHERE org_id=? AND route_id=?',actor.orgId,planned.id)).map(p=>p.parcel_id);
   const route=await domain.route(planned.id,actor);
   await domain.loadSelected(actor,route.id,{...cmd(),expectedVersion:await version(),parcelIds:ids});
   await domain.ready(actor,route.id,{...cmd(),expectedVersion:await version()});
   await domain.inspect(actor,route.vehicle_id,{...cmd(),odometer:0,fuelPercent:80,items:[{label:'QA',severity:'OK',note:''}]});
   await domain.dispatch(actor,route.id,{...cmd(),expectedVersion:await version(),dispatchNow:true});
   const stop=(await db.one('SELECT id FROM stops WHERE org_id=? AND route_id=?',actor.orgId,route.id))!;
   await domain.attempt(actor,stop.id,{...cmd(),expectedVersion:await version(),deliveredParcelIds:ids,failedParcelIds:[],receiverName:'Receptor QA',evidenceIds:[],reasonCode:'',nextAction:''});
   await domain.closeRoute(actor,route.id,{...cmd(),expectedVersion:await version()});
  }
  if(!(await reconcileInventory(db,actor)).ok)throw new Error('El inventario no reconcilia.');
  report.flow={routes:2,units:4,reserve:true,assign:true,load:true,confirm:true,dispatch:true,deliver:true,close:true,reconcile:true};
  throw rollback;
 });}catch(error){if(error!==rollback)throw error;}
 report.status='PASS';
}catch(error){report.status='FAIL';report.error=error instanceof Error?error.message:'Error desconocido';process.exitCode=1;}
finally{
 if(identity)await db.transaction(async()=>{await db.run('DELETE FROM sessions WHERE user_id=?',actor.id);await db.run('DELETE FROM users WHERE id=? AND org_id=?',actor.id,actor.orgId);await db.run('DELETE FROM organizations WHERE id=?',actor.orgId);});
 await db.close();report.cleanedUp=true;report.finishedAt=new Date().toISOString();writeFileSync(folder+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
