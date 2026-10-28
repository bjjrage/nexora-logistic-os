import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import * as XLSX from 'xlsx';
import {Store} from '../server/db.ts';
import {setup,type Actor} from '../server/auth.ts';
import {Logistics} from '../server/domain.ts';
import {Inventory} from '../server/inventory.ts';
import {CatalogImport} from '../server/catalog-import.ts';
import {createApp} from '../server/app.ts';
import {configureDelivery} from './support/delivery-policy.ts';

const password='Audit-Fixes-2026!';
const command=()=>({commandId:randomUUID()});
const errorCode=(code:string)=>(error:any)=>error.code===code;
async function fixture(t:any){
 const store=new Store(':memory:');t.after(()=>store.close());
 const {userId,orgId}=await setup(store,{organizationName:'QA audit fixes',timezone:'UTC',username:'qa.admin',password});
 const actor:Actor={id:userId,orgId,name:'QA',role:'ADMIN',driverId:null};
 const domain=new Logistics(store),inventory=new Inventory(store);
 const clientId=(await domain.createClient(actor,{...command(),name:'QA client'})).id;
 await configureDelivery(store,actor,clientId);
 const driverId=(await domain.createDriver(actor,{...command(),name:'QA driver',username:'qa.driver',password})).id;
 const vehicleId=(await domain.createVehicle(actor,{...command(),plate:'QA audit',capacityWeightGrams:10000,capacityVolumeCm3:10000,odometer:0})).id;
 const version=async(id:string)=>(await store.one('SELECT version FROM routes WHERE id=?',id))!.version;
 const shipment=async(weight=1000,volume=1000,parcelCount=1)=>{
  const id=(await domain.createShipment(actor,{...command(),clientId,reference:randomUUID(),originText:'QA',destinationText:'QA',recipientName:'QA',recipientPhone:'',proofPolicy:'RECEIVER',parcelCount,weightGrams:weight,volumeCm3:volume})).id;
  return (await store.one('SELECT * FROM parcels WHERE shipment_id=?',id))!;
 };
 const route=async(driver=driverId)=>(await domain.createRoute(actor,{...command(),name:'QA route',driverId:driver,vehicleId,startAt:new Date(Date.now()-60000).toISOString(),endAt:new Date(Date.now()+3600000).toISOString()})).id;
 const prepare=async(p:any,parcels=[p])=>{
  const id=await route();
  await domain.receive(actor,{...command(),shipmentId:p.shipment_id,codes:parcels.map(p=>p.code),location:'QA depot'});
  await domain.assign(actor,id,{...command(),expectedVersion:await version(id),parcelIds:parcels.map(p=>p.id),pickup:false});
  for(const parcel of parcels)await domain.load(actor,id,{...command(),expectedVersion:await version(id),code:parcel.code});
  await domain.ready(actor,id,{...command(),expectedVersion:await version(id)});
  await domain.inspect(actor,vehicleId,{...command(),odometer:0,fuelPercent:80,items:[{label:'QA brakes',severity:'OK',note:''}]});
  await domain.dispatch(actor,id,{...command(),expectedVersion:await version(id)});
  return {id,stop:(await store.one("SELECT * FROM stops WHERE route_id=? AND kind='DELIVERY'",id))!};
 };
 const location=async(kind='DEPOT')=>(await inventory.createLocation(actor,{...command(),code:randomUUID(),name:'QA location',kind})).id;
 const product=async(tracking='QUANTITY')=>inventory.createProduct(actor,{...command(),clientId,sku:randomUUID(),name:'QA product',tracking,unit:'unidad',weightGrams:100,volumeCm3:100});
 const http=async()=>{
  const server=createApp(store).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  t.after(()=>new Promise<void>((r,j)=>server.close(e=>e?j(e):r())));
  const base='http://127.0.0.1:'+(server.address() as any).port;
  const post=async(path:string,body:any,cookie='')=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'logistics-os',Cookie:cookie},body:JSON.stringify(body)});
  const login=async(username:string)=>{const r=await post('/api/login',{username,password});assert.equal(r.status,200);return r.headers.get('set-cookie')!.split(';')[0];};
  return {base,post,login};
 };
 return {store,actor,domain,inventory,clientId,driverId,vehicleId,version,shipment,route,prepare,location,product,http};
}

test('H1: deshabilitar personal revoca sesiones, ingreso y recuperación; conserva historial',async t=>{
 const f=await fixture(t),h=await f.http();
 const id=(await f.domain.createUser(f.actor,{...command(),name:'QA depot',username:'qa.depot',password,role:'DEPOT'})).id;
 const admin=await h.login('qa.admin'),staff=await h.login('qa.depot');
 const recovery=await (await h.post('/api/password-recovery/issue',{id,kind:'USER'},admin)).json();
 assert.equal((await h.post('/api/users/'+id+'/access',{...command(),enabled:false},staff)).status,403);
 const body={...command(),enabled:false};
 assert.equal((await h.post('/api/users/'+id+'/access',body,admin)).status,200);
 assert.equal((await h.post('/api/users/'+id+'/access',body,admin)).status,200);
 assert.equal((await fetch(h.base+'/api/bootstrap',{headers:{Cookie:staff}})).status,401);
 assert.equal((await h.post('/api/login',{username:'qa.depot',password})).status,401);
 assert.equal((await h.post('/api/password-recovery/redeem',{token:recovery.token,password})).status,401);
 assert.equal((await h.post('/api/password-recovery/issue',{id,kind:'USER'},admin)).status,404);
 assert.equal((await f.store.one('SELECT COUNT(*) n FROM sessions WHERE user_id=?',id))!.n,0);
 assert.equal((await f.store.one('SELECT id FROM users WHERE id=?',id))!.id,id);
 assert.equal((await h.post('/api/users/'+f.actor.id+'/access',{...command(),enabled:false},admin)).status,409);
 assert.equal((await h.post('/api/users/'+id+'/access',{...command(),enabled:true},admin)).status,200);
 await h.login('qa.depot');
 assert.equal((await fetch(h.base+'/api/bootstrap',{headers:{Cookie:staff}})).status,401);
});

test('H2: la reasignación revoca acceso del chofer anterior sin ocultar su última entrega',async t=>{
 const f=await fixture(t),p=await f.shipment(),r1=await f.route();
 await f.domain.receive(f.actor,{...command(),shipmentId:p.shipment_id,codes:[p.code],location:'QA'});
 await f.domain.assign(f.actor,r1,{...command(),expectedVersion:await f.version(r1),parcelIds:[p.id],pickup:false});
 const driverUser=(await f.store.one('SELECT * FROM users WHERE driver_id=?',f.driverId))!;
 const driver:Actor={...f.actor,id:driverUser.id,role:'DRIVER',driverId:f.driverId};
 await f.store.run('UPDATE route_assignments SET active=0 WHERE route_id=?',r1);
 assert.equal((await f.domain.parcel(p.id,driver)).id,p.id);
 const photo=await f.domain.upload(f.actor,{...command(),parcelId:p.id,filename:'qa.png',mimeType:'image/png',dataBase64:Buffer.from([137,80,78,71,13,10,26,10]).toString('base64')});
 const other=(await f.domain.createDriver(f.actor,{...command(),name:'Other',username:'qa.other',password})).id,r2=await f.route(other);
 await f.domain.assign(f.actor,r2,{...command(),expectedVersion:await f.version(r2),parcelIds:[p.id],pickup:false});
 await assert.rejects(()=>f.domain.parcel(p.id,driver),errorCode('FORBIDDEN'));
 const h=await f.http(),cookie=await h.login('qa.driver');
 for(const path of ['/api/shipments/'+p.shipment_id,'/api/evidence/'+photo.id])assert.equal((await fetch(h.base+path,{headers:{Cookie:cookie}})).status,403);
 const list=await (await fetch(h.base+'/api/shipments',{headers:{Cookie:cookie}})).json();assert.equal(list.items.length,0);
 const boot=await f.domain.bootstrap(driver);assert.equal(boot.parcels.length,0);assert.equal(boot.shipments.length,0);assert.equal(boot.evidence.length,0);
});

for(const dimension of ['weight','volume'])test('H3: la carga real de otras rutas limita '+dimension,async t=>{
 const f=await fixture(t),p=await f.shipment(dimension==='weight'?8000:1000,dimension==='volume'?8000:1000);
 // Custodia pendiente de una jornada anterior, aunque su ventana planificada haya vencido.
 await f.store.run("UPDATE parcels SET state='IN_TRANSIT',custody_type='VEHICLE',custody_id=? WHERE id=?",f.vehicleId,p.id);
 const next=await f.shipment(dimension==='weight'?8000:1000,dimension==='volume'?8000:1000),r=await f.route();
 await f.domain.receive(f.actor,{...command(),shipmentId:next.shipment_id,codes:[next.code],location:'QA'});
 await f.domain.assign(f.actor,r,{...command(),expectedVersion:await f.version(r),parcelIds:[next.id],pickup:false});
 const expectedVersion=await f.version(r);
 await assert.rejects(()=>f.domain.load(f.actor,r,{...command(),expectedVersion,code:next.code}),errorCode('CAPACITY_EXCEEDED'));
 assert.equal((await f.store.one('SELECT state FROM parcels WHERE id=?',next.id))!.state,'RECEIVED');
 // Protección también al despachar datos legacy cargados antes de esta corrección.
 await f.store.run("UPDATE parcels SET state='LOADED',custody_type='VEHICLE',custody_id=? WHERE id=?",f.vehicleId,next.id);
 await f.domain.ready(f.actor,r,{...command(),expectedVersion});
 await assert.rejects(async()=>f.domain.dispatch(f.actor,r,{...command(),expectedVersion:await f.version(r)}),errorCode('CAPACITY_EXCEEDED'));
 assert.equal((await f.store.one('SELECT state FROM routes WHERE id=?',r))!.state,'READY');
});

test('H4: repetir un fallo con otra clave no duplica custodia; reintento explícito conserva dos resultados',async t=>{
 const f=await fixture(t),p=await f.shipment(),r=await f.prepare(p);
 const body={deliveredParcelIds:[],failedParcelIds:[p.id],receiverName:'',evidenceIds:[],reasonCode:'ABSENT',nextAction:'Volver'};
 await f.domain.attempt(f.actor,r.stop.id,{...command(),...body,expectedVersion:await f.version(r.id)});
 const events=(await f.store.one('SELECT COUNT(*) n FROM custody_events'))!.n;
 const failedVersion=await f.version(r.id);
 await assert.rejects(()=>f.domain.attempt(f.actor,r.stop.id,{...command(),...body,expectedVersion:failedVersion}),errorCode('INVALID_TRANSITION'));
 assert.equal((await f.store.one('SELECT COUNT(*) n FROM attempts'))!.n,1);
 assert.equal((await f.store.one('SELECT COUNT(*) n FROM custody_events'))!.n,events);
 await f.domain.retryDelivery(f.actor,r.stop.id,{...command(),expectedVersion:await f.version(r.id)});
 await f.domain.attempt(f.actor,r.stop.id,{...command(),expectedVersion:await f.version(r.id),deliveredParcelIds:[p.id],failedParcelIds:[],receiverName:'QA receiver',evidenceIds:[],reasonCode:'',nextAction:''});
 assert.equal((await f.store.one('SELECT COUNT(*) n FROM attempts'))!.n,2);
 assert.equal((await f.store.one('SELECT state FROM parcels WHERE id=?',p.id))!.state,'DELIVERED');
});

for(const source of ['JSON','CSV'])test('H5: fallo transitorio en historial '+source+' permite reintentar la misma clave',async t=>{
 const f=await fixture(t),product=await f.product(),input=source==='JSON'?{...command(),orders:[{clientId:f.clientId,externalId:'QA order',orderDate:'2026-10-17',destination:'QA',recipientName:'QA',lines:[{productId:product.id,quantity:1}]}]}:{...command(),csv:`clientId,externalId,orderDate,destination,recipientName,sku,quantity\n${f.clientId},QA order,2026-10-17,QA,QA,${product.sku},1`};
 const original=f.store.run.bind(f.store);let fail=true;
 f.store.run=async(sql,...args)=>{if(fail&&sql.includes('INSERT INTO inventory_import_runs')){fail=false;throw new Error('transient QA write failure');}return original(sql,...args);};
 const run=()=>source==='JSON'?f.inventory.importOrders(f.actor,input):f.inventory.importCsv(f.actor,input);
 await assert.rejects(run,/transient QA write failure/);
 assert.equal((await f.store.one('SELECT COUNT(*) n FROM inventory_orders'))!.n,0);
 assert.equal((await f.store.one('SELECT COUNT(*) n FROM inventory_import_runs'))!.n,0);
 const result=await run();assert.equal(result.imported,1);assert.deepEqual(await run(),result);
 assert.equal((await f.store.one('SELECT COUNT(*) n FROM shipments'))!.n,1);
});

test('H6: ajustes no crean disponible en cuarentena o ubicaciones archivadas; series duplicadas son validación',async t=>{
 const f=await fixture(t),p=await f.product(),serial=await f.product('SERIAL'),quarantine=await f.location('QUARANTINE'),archived=await f.location(),active=await f.location();
 await f.inventory.updateLocation(f.actor,archived,{...command(),active:false});
 for(const locationId of [quarantine,archived])for(const product of [p,serial])await assert.rejects(()=>f.inventory.adjust(f.actor,{...command(),clientId:f.clientId,productId:product.id,locationId,quantityDelta:1,serials:product===serial?[{serial:'QA1'}]:undefined,reason:'QA correction'}),errorCode('INVALID_TRANSITION'));
 await f.inventory.receive(f.actor,{...command(),clientId:f.clientId,productId:serial.id,locationId:active,quantity:2,serials:[{serial:'QA1'},{serial:'QA2'}]});
 await assert.rejects(()=>f.inventory.adjust(f.actor,{...command(),clientId:f.clientId,productId:serial.id,locationId:active,quantityDelta:-2,serials:[{serial:'QA1'},{serial:'QA1'}],reason:'QA correction'}),errorCode('VALIDATION_ERROR'));
 assert.equal((await f.store.one("SELECT COUNT(*) n FROM inventory_units WHERE status='AVAILABLE'"))!.n,2);
});

test('H7: XLSX rechaza identificadores numéricos inseguros, sin borrar un código existente',async t=>{
 const f=await fixture(t),p=await f.product(),catalog=new CatalogImport(f.store);
 await f.inventory.updateProduct(f.actor,p.id,{...command(),barcode:'ORIGINAL'});
 for(const format of [undefined,'00000000000000000000']){
  const wb=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([['SKU','Nombre','CodigoBarras'],[p.sku,'QA updated',9007199254740992]]);
  if(format)sheet.C2.z=format;
  XLSX.utils.book_append_sheet(wb,sheet,'Catalogo');
  const input={...command(),clientId:f.clientId,filename:'qa.xlsx',contentBase64:Buffer.from(XLSX.write(wb,{type:'buffer',bookType:'xlsx'})).toString('base64')};
  const preview=await catalog.preview(f.actor,input);assert.equal(preview.valid,false);assert.ok(preview.rowErrors.some(e=>e.field==='barcode'));
  await assert.rejects(()=>catalog.import(f.actor,input),errorCode('VALIDATION_ERROR'));
 }
 assert.equal((await f.store.one('SELECT barcode FROM inventory_products WHERE id=?',p.id))!.barcode,'ORIGINAL');
 const text=await catalog.preview(f.actor,{clientId:f.clientId,csv:`SKU,Nombre,CodigoBarras\n${p.sku},QA updated,9007199254740993`});assert.equal(text.valid,true);assert.equal(text.rows[0].barcode,'9007199254740993');
});

test('H3: carga de pedido de inventario tampoco puede sobrecargar el vehículo',async t=>{
 const f=await fixture(t),aboard=await f.shipment(8000),product=await f.product(),locationId=await f.location();
 await f.store.run("UPDATE parcels SET state='RETURN_PENDING',custody_type='VEHICLE',custody_id=? WHERE id=?",f.vehicleId,aboard.id);
 await f.inventory.updateProduct(f.actor,product.id,{...command(),weightGrams:8000});
 await f.inventory.receive(f.actor,{...command(),clientId:f.clientId,productId:product.id,locationId,quantity:1});
 const order=await f.inventory.createOrder(f.actor,{...command(),clientId:f.clientId,externalId:'QA capacity',orderDate:'2026-10-17',destination:'QA',recipientName:'QA',lines:[{productId:product.id,quantity:1}]});
 const reserved=await f.inventory.reserveOrder(f.actor,order.id,command()),route=await f.route(),parcel=reserved.parcels[0];
 await f.domain.assign(f.actor,route,{...command(),expectedVersion:await f.version(route),parcelIds:[parcel.id],pickup:false});
 const expectedVersion=await f.version(route);
 await assert.rejects(()=>f.inventory.loadOrder(f.actor,order.id,{...command(),routeId:route,expectedVersion,codes:[parcel.code]}),errorCode('CAPACITY_EXCEEDED'));
 assert.equal((await f.store.one('SELECT state FROM parcels WHERE id=?',parcel.id))!.state,'RECEIVED');
 assert.equal((await f.store.one('SELECT status FROM inventory_orders WHERE id=?',order.id))!.status,'RESERVED');
});

test('riesgos menores: API e importador impiden SKU/barcode ambiguos al escanear',async t=>{
 const f=await fixture(t),product=await f.product(),catalog=new CatalogImport(f.store);
 await f.inventory.updateProduct(f.actor,product.id,{...command(),sku:'Audit-SKU'});product.sku='Audit-SKU';
 const body={...command(),clientId:f.clientId,sku:product.sku.toUpperCase(),name:'Other',tracking:'QUANTITY'};
 await assert.rejects(()=>f.inventory.createProduct(f.actor,body),errorCode('VALIDATION_ERROR'));
 await assert.rejects(()=>f.inventory.createProduct(f.actor,{...body,...command(),sku:'OTHER',barcode:product.sku}),errorCode('VALIDATION_ERROR'));
 const other=await f.product();
 await assert.rejects(()=>f.inventory.updateProduct(f.actor,other.id,{...command(),barcode:product.sku}),errorCode('VALIDATION_ERROR'));
 const report=await catalog.preview(f.actor,{clientId:f.clientId,csv:`SKU,Nombre,Seguimiento,CodigoBarras\nOTHER,Other,Cantidad,${product.sku}`});
 assert.equal(report.valid,false);
 const caseReport=await catalog.preview(f.actor,{clientId:f.clientId,csv:`SKU,Nombre,Seguimiento\n${product.sku.toUpperCase()},Other,Cantidad`});assert.equal(caseReport.valid,false);
 assert.equal((await f.store.one('SELECT COUNT(*) n FROM inventory_products'))!.n,2);
});

test('H4: una parada parcial no admite repetir bultos fallidos ni reabrir una devolución autorizada',async t=>{
 const f=await fixture(t),p=await f.shipment(1000,1000,2),parcels=await f.store.all('SELECT * FROM parcels WHERE shipment_id=?',p.shipment_id),r=await f.prepare(p,parcels);
 const body={deliveredParcelIds:[],failedParcelIds:[p.id],receiverName:'',evidenceIds:[],reasonCode:'ABSENT',nextAction:'Volver'};
 await f.domain.attempt(f.actor,r.stop.id,{...command(),...body,expectedVersion:await f.version(r.id)});
 assert.equal((await f.store.one('SELECT state FROM stops WHERE id=?',r.stop.id))!.state,'PARTIAL');
 const expectedVersion=await f.version(r.id);
 await assert.rejects(()=>f.domain.attempt(f.actor,r.stop.id,{...command(),...body,expectedVersion}),errorCode('INVALID_TRANSITION'));
 const incident=(await f.store.one('SELECT id FROM incidents WHERE parcel_id=?',p.id))!;
 await f.domain.authorizeReturn(f.actor,incident.id,command());
 await assert.rejects(()=>f.domain.retryDelivery(f.actor,r.stop.id,{...command(),expectedVersion}),errorCode('INVALID_TRANSITION'));
 await assert.rejects(()=>f.domain.retryDelivery({...f.actor,role:'DEPOT'},r.stop.id,{...command(),expectedVersion}),errorCode('FORBIDDEN'));
 assert.equal((await f.store.one('SELECT COUNT(*) n FROM attempts'))!.n,1);
});

test('H3: dos cargas simultáneas no superan la capacidad compartida',async t=>{
 const f=await fixture(t),entries=[];
 for(let i=0;i<2;i++){
  const parcel=await f.shipment(6000),route=await f.route();
  if(i===0)await f.store.run('UPDATE routes SET start_at=?,end_at=? WHERE id=?',new Date(Date.now()-7200000).toISOString(),new Date(Date.now()-3600000).toISOString(),route);
  await f.domain.receive(f.actor,{...command(),shipmentId:parcel.shipment_id,codes:[parcel.code],location:'QA'});
  await f.domain.assign(f.actor,route,{...command(),expectedVersion:await f.version(route),parcelIds:[parcel.id],pickup:false});
  entries.push({route,parcel,version:await f.version(route)});
 }
 const results=await Promise.allSettled(entries.map(entry=>f.domain.load(f.actor,entry.route,{...command(),expectedVersion:entry.version,code:entry.parcel.code})));
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 assert.equal((results.find(result=>result.status==='rejected') as PromiseRejectedResult).reason.code,'CAPACITY_EXCEEDED');
 assert.equal((await f.store.one("SELECT SUM(weight_grams) n FROM parcels WHERE custody_type='VEHICLE'"))!.n,6000);
});

for(const source of ['JSON','CSV'])test('H5: reintento concurrente '+source+' devuelve el resultado confirmado, aunque su preview vea duplicado',async t=>{
 const f=await fixture(t),product=await f.product(),winner=new Inventory(f.store);
 const input=source==='JSON'?{...command(),orders:[{clientId:f.clientId,externalId:'QA race',orderDate:'2026-10-17',destination:'QA',recipientName:'QA',lines:[{productId:product.id,quantity:1}]}]}:{...command(),csv:`clientId,externalId,orderDate,destination,recipientName,sku,quantity\n${f.clientId},QA race,2026-10-17,QA,QA,${product.sku},1`};
 const method=source==='JSON'?'previewImport':'previewCsvRows',target=f.inventory as any,original=target[method].bind(target);let result:any;
 target[method]=async(...args:any[])=>{result=await(source==='JSON'?winner.importOrders(f.actor,input):winner.importCsv(f.actor,input));return original(...args);};
 const actual=await(source==='JSON'?f.inventory.importOrders(f.actor,input):f.inventory.importCsv(f.actor,input));
 assert.deepEqual(actual,result);assert.equal((await f.store.one('SELECT COUNT(*) n FROM inventory_orders'))!.n,1);
});

test('move/adjust/updateLocation: saldo y movimientos conservan atomicidad y límites de ubicación',async t=>{
 const f=await fixture(t),p=await f.product(),from=await f.location(),to=await f.location(),quarantine=await f.location('QUARANTINE');
 await f.inventory.adjust(f.actor,{...command(),clientId:f.clientId,productId:p.id,locationId:from,quantityDelta:4,reason:'QA conteo'});
 const move={...command(),clientId:f.clientId,productId:p.id,fromLocationId:from,toLocationId:to,quantity:3,reason:'QA traslado'};
 assert.deepEqual(await f.inventory.move(f.actor,move),await f.inventory.move(f.actor,move));
 await assert.rejects(()=>f.inventory.move(f.actor,{...move,...command(),quantity:2}),errorCode('INSUFFICIENT_STOCK'));
 await assert.rejects(()=>f.inventory.move(f.actor,{...move,...command(),toLocationId:quarantine,quantity:1}),errorCode('VALIDATION_ERROR'));
 await assert.rejects(()=>f.inventory.updateLocation(f.actor,to,{...command(),active:false}),errorCode('INVALID_TRANSITION'));
 await assert.rejects(()=>f.inventory.updateLocation(f.actor,to,{...command(),kind:'QUARANTINE'}),errorCode('INVALID_TRANSITION'));
 const balances=await f.store.all("SELECT quantity FROM inventory_balances WHERE status='AVAILABLE'");assert.equal(balances.reduce((sum,row)=>sum+row.quantity,0),4);
});
