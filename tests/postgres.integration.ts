import { configureDelivery } from './support/delivery-policy.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { PostgresStore } from '../server/postgres.ts';
import { Logistics } from '../server/domain.ts';
import { passwordHash, type Actor } from '../server/auth.ts';
import { createDriverDocument, renewDriverDocument } from '../server/driver-documents.ts';
import { createApp } from '../server/app.ts';
import { warehouseStory } from './warehouse-story.ts';
import { Inventory } from '../server/inventory.ts';
import { CatalogImport } from '../server/catalog-import.ts';
import { reconcileInventory } from '../server/reconciliation.ts';

test('PostgreSQL: future confirmed routes allow departure, overlapping plans and double departure remain blocked', async () => {
 const db=new PostgresStore(process.env.DATABASE_URL??''),rollback=new Error('ROLLBACK_DISPATCH_WINDOWS'),orgId=randomUUID(),userId=randomUUID(),cmd=()=>({commandId:randomUUID()});
 try { await assert.rejects(db.transaction(async()=>{
  await db.run('INSERT INTO organizations VALUES(?,?,?)',orgId,'QA dispatch windows','UTC');
  await db.run('INSERT INTO users(id,org_id,username,name,password_hash,role,driver_id) VALUES(?,?,?,?,?,?,NULL)',userId,orgId,'qa-'+randomUUID(),'QA',passwordHash('QA-Dispatch-2026!'),'ADMIN');
  const actor:Actor={id:userId,orgId,name:'QA',role:'ADMIN',driverId:null},domain=new Logistics(db);
  const driverId=(await domain.createDriver(actor,{...cmd(),name:'QA driver',username:'qa-'+randomUUID(),password:'QA-Driver-2026!'})).id;
  const vehicleId=(await domain.createVehicle(actor,{...cmd(),plate:'QA-'+randomUUID(),capacityWeightGrams:10000,capacityVolumeCm3:10000,odometer:0})).id;
  const make=async(offset:number)=>(await domain.createRoute(actor,{...cmd(),name:'QA route',driverId,vehicleId,startAt:new Date(Date.now()+offset).toISOString(),endAt:new Date(Date.now()+offset+3600000).toISOString()})).id;
  const today=await make(-60000),future=await make(86400000),overlap=await make(0);
  await db.run("UPDATE routes SET state='READY' WHERE id=?",today);
  await db.run("UPDATE routes SET state='READY' WHERE id=?",future);
  // A savepoint allows testing constraint failures without aborting the fixture transaction.
  await db.run('SAVEPOINT conflicting_plan');
  await assert.rejects(db.run("UPDATE routes SET state='READY' WHERE id=?",overlap),(error:any)=>error.code==='VERSION_CONFLICT');
  await db.run('ROLLBACK TO SAVEPOINT conflicting_plan');
  await domain.routeAvailability((await db.one('SELECT * FROM routes WHERE id=?',today))!,actor,true);
  await db.run("UPDATE routes SET state='IN_PROGRESS' WHERE id=?",today);
  await db.run('SAVEPOINT double_departure');
  await assert.rejects(db.run("UPDATE routes SET state='IN_PROGRESS' WHERE id=?",future),(error:any)=>error.code==='VERSION_CONFLICT');
  await db.run('ROLLBACK TO SAVEPOINT double_departure');
  assert.equal((await db.one('SELECT state FROM routes WHERE id=?',future))!.state,'READY');
  throw rollback;
 }),error=>error===rollback); } finally {await db.close();}
});

test('PostgreSQL: agregar un segundo pedido a una ruta confirmada conserva la carga y exige nueva confirmación',async()=>{
 const db=new PostgresStore(process.env.DATABASE_URL??''),rollback=new Error('ROLLBACK_MULTI_ORDER'),orgId=randomUUID(),userId=randomUUID(),cmd=()=>({commandId:randomUUID()});
 try{await assert.rejects(db.transaction(async()=>{
  await db.run('INSERT INTO organizations VALUES(?,?,?)',orgId,'QA varias entregas','UTC');
  await db.run('INSERT INTO users(id,org_id,username,name,password_hash,role,driver_id) VALUES(?,?,?,?,?,?,NULL)',userId,orgId,'qa-'+randomUUID(),'QA',passwordHash('QA-Multiple-2026!'),'ADMIN');
  const actor:Actor={id:userId,orgId,name:'QA',role:'ADMIN',driverId:null},domain=new Logistics(db),inv=new Inventory(db);
  const client=(await domain.createClient(actor,{...cmd(),name:'Cliente'})).id;await configureDelivery(db,actor,client,'NEXORA');
  const location=(await inv.createLocation(actor,{...cmd(),code:'DEP',name:'Depósito'})).id;
  const product=(await inv.createProduct(actor,{...cmd(),clientId:client,sku:'MULTI',name:'Artículo',tracking:'QUANTITY',weightGrams:100,volumeCm3:100})).id;
  await inv.receive(actor,{...cmd(),clientId:client,productId:product,locationId:location,quantity:2});
  const parcels=[];
  for(let i=0;i<2;i++){
   const order=(await inv.createOrder(actor,{...cmd(),clientId:client,externalId:'QA-'+i,orderDate:'2026-10-28',destination:'Destino',recipientName:'Receptor',lines:[{productId:product,quantity:1}]})).id;
   parcels.push((await inv.reserveOrder(actor,order,cmd())).parcels[0].id);
  }
  const driver=(await domain.createDriver(actor,{...cmd(),name:'Chofer',username:'qa-'+randomUUID(),password:'QA-Driver-2026!'})).id;
  const vehicle=(await domain.createVehicle(actor,{...cmd(),plate:'QA-'+randomUUID(),capacityWeightGrams:10000,capacityVolumeCm3:10000,odometer:0})).id;
  const route=(await domain.createRoute(actor,{...cmd(),name:'Ruta',driverId:driver,vehicleId:vehicle,trackingProvider:'TRACCAR',startAt:new Date(Date.now()-60000).toISOString(),endAt:new Date(Date.now()+3600000).toISOString()})).id;
  const version=async()=>(await domain.route(route,actor)).version;
  await domain.assign(actor,route,{...cmd(),expectedVersion:await version(),parcelIds:[parcels[0]],pickup:false});
  await domain.loadSelected(actor,route,{...cmd(),expectedVersion:await version(),parcelIds:[parcels[0]]});
  await domain.ready(actor,route,{...cmd(),expectedVersion:await version()});
  await domain.assign(actor,route,{...cmd(),expectedVersion:await version(),parcelIds:[parcels[1]],pickup:false});
  assert.equal((await domain.route(route,actor)).state,'DRAFT');
  assert.equal((await db.one('SELECT state FROM parcels WHERE id=?',parcels[0]))!.state,'LOADED');
  await assert.rejects(domain.ready(actor,route,{...cmd(),expectedVersion:await version()}),{code:'INVALID_TRANSITION'});
  await domain.loadSelected(actor,route,{...cmd(),expectedVersion:await version(),parcelIds:[parcels[1]]});
  assert.equal((await domain.route(route,actor)).state,'DRAFT');
  await domain.inspect(actor,vehicle,{...cmd(),odometer:0,fuelPercent:90,items:[{label:'Control QA',severity:'OK',note:''}]});
  const futureStart=new Date(Date.now()+7200000).toISOString(),futureEnd=new Date(Date.now()+10800000).toISOString();
  await db.run('UPDATE routes SET start_at=?,end_at=? WHERE id=?',futureStart,futureEnd,route);
  const departure=await domain.dispatch(actor,route,{...cmd(),expectedVersion:await version(),dispatchNow:true});
  assert.equal(departure.previousStartAt,futureStart);assert.equal((await domain.route(route,actor)).state,'IN_PROGRESS');
  const stop=(await db.one('SELECT id FROM stops WHERE route_id=? ORDER BY sequence',route))!;
  const attempt=()=>({...cmd(),expectedVersion:0,deliveredParcelIds:[parcels[0]],failedParcelIds:[],receiverName:'QA',evidenceIds:[],reasonCode:'',nextAction:''});
  const absent=attempt();absent.expectedVersion=await version();
  await assert.rejects(domain.attempt(actor,stop.id,absent),{code:'EVIDENCE_REQUIRED'});
  await db.run('INSERT INTO organization_test_mode(org_id,enabled) VALUES(?,1)',orgId);
  const testAttempt=attempt();testAttempt.expectedVersion=await version();
  await domain.attempt(actor,stop.id,testAttempt);
  assert.ok(await db.one('SELECT parcel_id FROM test_delivery_proofs WHERE org_id=? AND parcel_id=? AND command_id=?',orgId,parcels[0],testAttempt.commandId));
  assert.equal((await reconcileInventory(db,actor)).ok,true);
  throw rollback;
 }),error=>error===rollback);}finally{await db.close();}
});

test('PostgreSQL: desreserva de ruta confirmada revierte stock y permite reservar de nuevo; rollback',async()=>{
 const db=new PostgresStore(process.env.DATABASE_URL??''),rollback=new Error('ROLLBACK_UNRESERVE'),orgId=randomUUID(),userId=randomUUID(),cmd=()=>({commandId:randomUUID()});
 try{await assert.rejects(db.transaction(async()=>{
  await db.run('INSERT INTO organizations VALUES(?,?,?)',orgId,'QA desreserva','UTC');
  await db.run('INSERT INTO users(id,org_id,username,name,password_hash,role,driver_id) VALUES(?,?,?,?,?,?,NULL)',userId,orgId,'qa-'+randomUUID(),'QA',passwordHash('QA-Inventory-Postgres-2026!'),'ADMIN');
  const actor:Actor={id:userId,orgId,name:'QA',role:'ADMIN',driverId:null},domain=new Logistics(db),inv=new Inventory(db);
  const client=(await domain.createClient(actor,{...cmd(),name:'Cliente'})).id;await configureDelivery(db,actor,client);
  const loc=(await inv.createLocation(actor,{...cmd(),code:'DEP',name:'Deposito'})).id;
  const product=(await inv.createProduct(actor,{...cmd(),clientId:client,sku:'SKU',name:'Producto',tracking:'QUANTITY'})).id;
  await inv.receive(actor,{...cmd(),clientId:client,productId:product,locationId:loc,quantity:2});
  const order=(await inv.createOrder(actor,{...cmd(),clientId:client,externalId:'UNRES-PG',orderDate:'2026-10-27',destination:'Destino',recipientName:'Receptor',lines:[{productId:product,quantity:2}]})).id;
  const reserved=await inv.reserveOrder(actor,order,cmd());
  const driver=(await domain.createDriver(actor,{...cmd(),name:'Chofer',username:'d-'+randomUUID(),password:'QA-Driver-Postgres-2026!'})).id;
  const vehicle=(await domain.createVehicle(actor,{...cmd(),plate:'QA-'+randomUUID().slice(0,8),capacityWeightGrams:10000,capacityVolumeCm3:10000,odometer:0})).id;
  const route=await domain.createRoute(actor,{...cmd(),name:'Ruta',driverId:driver,vehicleId:vehicle,startAt:new Date(Date.now()-60000).toISOString(),endAt:new Date(Date.now()+3600000).toISOString()});
  await domain.assign(actor,route.id,{...cmd(),expectedVersion:route.version,parcelIds:reserved.parcels.map((p:any)=>p.id),pickup:false});
  await domain.loadSelected(actor,route.id,{...cmd(),expectedVersion:(await db.one('SELECT version FROM routes WHERE id=?',route.id))!.version,parcelIds:reserved.parcels.map((p:any)=>p.id)});
  await domain.ready(actor,route.id,{...cmd(),expectedVersion:(await db.one('SELECT version FROM routes WHERE id=?',route.id))!.version});
  assert.equal((await db.one('SELECT status FROM inventory_orders WHERE id=?',order))!.status,'LOADED');
  const currentVersion=(await db.one('SELECT version FROM routes WHERE id=?',route.id))!.version;
  await assert.rejects(domain.unloadSelected(actor,route.id,{...cmd(),expectedVersion:currentVersion,parcelIds:[reserved.parcels[0].id,randomUUID()]}));
  assert.equal((await db.one('SELECT loaded_quantity FROM inventory_order_lines WHERE order_id=?',order))!.loaded_quantity,2);
  const unload={...cmd(),expectedVersion:currentVersion,parcelIds:reserved.parcels.map((p:any)=>p.id)};
  const unloaded=await domain.unloadSelected(actor,route.id,unload);assert.deepEqual(await domain.unloadSelected(actor,route.id,unload),unloaded);
  await domain.unassignSelected(actor,route.id,{...cmd(),expectedVersion:(await db.one('SELECT version FROM routes WHERE id=?',route.id))!.version,parcelIds:reserved.parcels.map((p:any)=>p.id)});
  assert.equal((await db.one('SELECT COUNT(*) AS n FROM stops WHERE route_id=?',route.id))!.n,0);
  assert.equal((await reconcileInventory(db,actor)).ok,true);
  await inv.unreserveOrder(actor,order,cmd());
  assert.equal((await db.one('SELECT state FROM routes WHERE id=?',route.id))!.state,'DRAFT');
  assert.equal((await db.one("SELECT quantity FROM inventory_balances WHERE product_id=? AND status='AVAILABLE'",product))!.quantity,2);
  assert.equal((await reconcileInventory(db,actor)).ok,true);
  await inv.reserveOrder(actor,order,cmd());assert.equal((await inv.order(actor,order)).parcels.length,2);
  throw rollback;
 }),error=>error===rollback);}finally{await db.close();}
});

test('Supabase: catálogo masivo preserva ceros, idempotencia, stock y totales; rollback', async()=>{
  const store=new PostgresStore(process.env.DATABASE_URL??''),rollback=new Error('ROLLBACK_CATALOG_QA'),orgId=randomUUID(),userId=randomUUID();
  try {
    await assert.rejects(store.transaction(async()=>{
      await store.run('INSERT INTO organizations VALUES(?,?,?)',orgId,'QA catálogo temporal','UTC');
      await store.run('INSERT INTO users(id,org_id,username,name,password_hash,role,driver_id) VALUES(?,?,?,?,?,?,NULL)',userId,orgId,'qa-'+randomUUID(),'QA catálogo',passwordHash('QA-Catalog-Postgres-2026!'),'ADMIN');
      const actor:Actor={id:userId,orgId,name:'QA catálogo',role:'ADMIN',driverId:null},inventory=new Inventory(store),catalog=new CatalogImport(store),domain=new Logistics(store);
      const clientId=(await domain.createClient(actor,{commandId:randomUUID(),name:'QA catálogo dueño'})).id;
      const header='sku,nombre,codigoBarras,seguimiento,unidad,pesoKg,volumenM3,Marca,Stock';
      const input={commandId:randomUUID(),clientId,defaultTracking:'QUANTITY',csv:`${header}\n00001,Heladera ficticia,0000012345678,,unidad,50,0.4,Marca ficticia,900\n00002,Motor ficticio,0000012345679,SERIAL,unidad,1,0.002,Marca ficticia,900`};
      const report=await catalog.import(actor,input);assert.equal(report.createCount,2);assert.deepEqual(report.ignoredColumns,['Marca','Stock']);assert.deepEqual(await catalog.import(actor,input),report);
      const product=await store.one('SELECT * FROM inventory_products WHERE org_id=? AND client_id=? AND sku=?',orgId,clientId,'00001');assert.ok(product);assert.equal(product.barcode,'0000012345678');
      const location=await inventory.createLocation(actor,{commandId:randomUUID(),code:'QA-CAT-DEP',name:'QA depósito',kind:'STORAGE'});
      await inventory.receive(actor,{commandId:randomUUID(),clientId,productId:product.id,locationId:location.id,quantity:3,reference:'QA catálogo'});
      const update=await catalog.import(actor,{commandId:randomUUID(),clientId,csv:`sku,nombre\n00001,Heladera ficticia actualizada`});assert.equal(update.updateCount,1);
      const current=await store.one('SELECT * FROM inventory_products WHERE id=?',product.id);assert.ok(current);assert.equal(current.barcode,'0000012345678');assert.equal(current.weight_grams,50000);
      const snapshot=await inventory.bootstrap(actor,clientId);assert.equal(snapshot.totals.AVAILABLE,3);assert.equal(snapshot.clientTotals[clientId].AVAILABLE,3);
      const bad={commandId:randomUUID(),clientId,csv:'sku,nombre\nSHOULD-NOT-SAVE,Válido\nSHOULD-NOT-SAVE,Duplicado'};
      await assert.rejects(catalog.import(actor,bad),(error:any)=>error.code==='VALIDATION_ERROR');
      assert.equal(await store.one('SELECT id FROM inventory_products WHERE org_id=? AND sku=?',orgId,'SHOULD-NOT-SAVE'),undefined);
      assert.equal(Number((await store.one('SELECT COUNT(*) n FROM inventory_movements WHERE org_id=?',orgId))!.n),1);
      throw rollback;
    }),error=>error===rollback);
    assert.equal(await store.one('SELECT id FROM organizations WHERE id=?',orgId),undefined);
  } finally {await store.close();}
});

test('Supabase: CSV rechazado guarda errores por fila, no crea pedidos y reintenta sin duplicar historial; rollback',async()=>{
  const store=new PostgresStore(process.env.DATABASE_URL??''),rollback=new Error('ROLLBACK_IMPORT_QA'),orgId=randomUUID(),userId=randomUUID();
  try{
    await assert.rejects(store.transaction(async()=>{
      await store.run('INSERT INTO organizations VALUES(?,?,?)',orgId,'QA rejected import','UTC');
      await store.run('INSERT INTO users(id,org_id,username,name,password_hash,role,driver_id) VALUES(?,?,?,?,?,?,NULL)',userId,orgId,'qa-'+randomUUID(),'QA import',passwordHash('QA-Import-Postgres-2026!'),'ADMIN');
      const actor:Actor={id:userId,orgId,name:'QA import',role:'ADMIN',driverId:null},domain=new Logistics(store),inventory=new Inventory(store),command=()=>({commandId:randomUUID()});
      const clientId=(await domain.createClient(actor,{...command(),name:'QA import owner'})).id;
      await inventory.createProduct(actor,{...command(),clientId,sku:'QA-IMPORT',name:'QA import item',tracking:'QUANTITY'});
      const input={...command(),csv:`clientId,externalId,orderDate,destination,recipientName,sku,quantity\n${clientId},QA-REJECTED,2026-02-30,QA Address,QA Receiver,QA-IMPORT,1`};
      for(let retry=0;retry<2;retry++)await assert.rejects(inventory.importCsv(actor,input),(error:any)=>error.code==='VALIDATION_ERROR'&&error.details?.rowErrors?.some((row:any)=>row.row===2));
      assert.equal((await store.one('SELECT COUNT(*) n FROM inventory_orders WHERE org_id=?',orgId))!.n,0);
      const history=await inventory.importHistory(actor);assert.equal(history.items.length,1);assert.equal(history.items[0].status,'REJECTED');assert(history.items[0].rowErrors.some((error:any)=>error.row===2));
      await assert.rejects(store.transaction(()=>store.run('DELETE FROM inventory_import_runs WHERE org_id=?',orgId)),{code:'42501'});
      throw rollback;
    }),error=>error===rollback);
    assert.equal(await store.one('SELECT id FROM organizations WHERE id=?',orgId),undefined);
  }finally{await store.close();}
});

test('Supabase: circuito de inventario, entrega parcial QuadMinds fixture, foto/firma, retorno y consulta cliente; rollback',async()=>{
  const store=new PostgresStore(process.env.DATABASE_URL??''),rollback=new Error('ROLLBACK_WAREHOUSE_QA');let orgId:string|undefined;
  try{
    await store.verify();
    await assert.rejects(store.transaction(async()=>{const result=await warehouseStory(store);orgId=result.orgId;throw rollback;}),error=>error===rollback);
    if(orgId)assert.equal(await store.one('SELECT id FROM organizations WHERE id=?',orgId),undefined);
  }finally{await store.close();}
});

function photo(rgb: number[]) {
  const chunk = (name: string, data: Buffer) => {
    const type=Buffer.from(name),size=Buffer.alloc(4),check=Buffer.alloc(4);size.writeUInt32BE(data.length);
    let crc=0xffffffff;for(const byte of Buffer.concat([type,data])){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    check.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([size,type,data,check]);
  };
  const header=Buffer.alloc(13);header.writeUInt32BE(1);header.writeUInt32BE(1,4);header[8]=8;header[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,...rgb]))),chunk('IEND',Buffer.alloc(0))]).toString('base64');
}

test('Supabase: API consulta PostgreSQL, rol limitado y acceso público denegado', async () => {
  const db=new PostgresStore(process.env.DATABASE_URL??'');
  let server: ReturnType<ReturnType<typeof createApp>['listen']> | undefined;
  try {
    await db.verify();
    assert.equal((await db.one('SELECT current_user AS name'))!.name,'nexora_runtime');
    const role=await db.one('SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=current_user');
    assert.deepEqual(role,{rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolbypassrls:false});
    await assert.rejects(db.one('SELECT id FROM auth.users LIMIT 1'),{code:'42501'});
    await assert.rejects(db.run('CREATE TABLE nexora.forbidden_ddl(id int)'),{code:'42501'});
    server=createApp(db).listen(0,'127.0.0.1');
    await new Promise<void>(resolve=>server!.once('listening',resolve));
    const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
    const health=await (await fetch(base+'/api/health')).json();
    assert.equal(health.database,'postgres');assert.equal(health.status,'ok');
    assert.equal((await fetch(base+'/api/bootstrap')).status,401);
  } finally {
    if(server)await new Promise<void>((resolve,reject)=>server!.close(error=>error?reject(error):resolve()));
    await db.close();
  }
});

test('Supabase: recepción, concurrencia protegida por constraints, despacho, fotos, devolución e idempotencia; todo termina en rollback', async () => {
  const db=new PostgresStore(process.env.DATABASE_URL??''),rollback=new Error('ROLLBACK_QA');
  const orgId=randomUUID(),userId=randomUUID(),command=()=>({commandId:randomUUID()});
  try {
    await assert.rejects(db.transaction(async()=>{
      await db.run('INSERT INTO organizations VALUES(?,?,?)',orgId,'QA temporal PostgreSQL','UTC');
      await db.run('INSERT INTO users(id,org_id,username,name,password_hash,role,driver_id) VALUES(?,?,?,?,?,?,NULL)',userId,orgId,'qa-'+randomUUID(),'QA',passwordHash('QA-Postgres-Only-2026!'),'ADMIN');
      const actor:Actor={id:userId,orgId,name:'QA',role:'ADMIN',driverId:null},domain=new Logistics(db);
      const client=await domain.createClient(actor,{...command(),name:'Cliente QA temporal'});
      await configureDelivery(db, actor, client.id);
      const driver=await domain.createDriver(actor,{...command(),name:'Chofer QA',username:'driver-'+randomUUID(),password:'QA-Postgres-Driver-2026!'});
      const vehicle=await domain.createVehicle(actor,{...command(),plate:'QA-'+randomUUID(),capacityWeightGrams:10_000,capacityVolumeCm3:10_000,odometer:100});
      const shipment=await domain.createShipment(actor,{...command(),clientId:client.id,reference:randomUUID(),originText:'Origen QA',destinationText:'Destino QA',recipientName:'Receptor QA',recipientPhone:'',parcelCount:3,weightGrams:1000,volumeCm3:1000,proofPolicy:'RECEIVER_PHOTO'});
      const parcels=await db.all('SELECT * FROM parcels WHERE shipment_id=? ORDER BY rowid',shipment.id);
      const receiptBody={...command(),shipmentId:shipment.id,codes:parcels.slice(0,2).map(p=>p.code),location:'Depósito QA'};
      const receipt=await domain.receive(actor,receiptBody);assert.equal(receipt.received,2);
      assert.deepEqual(await domain.receive(actor,receiptBody),receipt);
      const routeInput={name:'Ruta QA',driverId:driver.id,vehicleId:vehicle.id,startAt:new Date(Date.now()-60_000).toISOString(),endAt:new Date(Date.now()+3_600_000).toISOString()};
      const route=await domain.createRoute(actor,{...command(),...routeInput});
      const conflict=await domain.createRoute(actor,{...command(),...routeInput});
      const version=async()=> (await domain.route(route.id,actor)).version;
      await domain.assign(actor,route.id,{...command(),parcelIds:parcels.slice(0,2).map(p=>p.id),pickup:false,expectedVersion:await version()});
      await assert.rejects(db.transaction(()=>db.run('INSERT INTO route_assignments VALUES(?,?,?,?,?,?)',randomUUID(),orgId,conflict.id,parcels[0].id,0,1)),{code:'VERSION_CONFLICT'});

      for(const parcel of parcels.slice(0,2))await domain.load(actor,route.id,{...command(),expectedVersion:await version(),code:parcel.code});
      await domain.ready(actor,route.id,{...command(),expectedVersion:await version()});
      await assert.rejects(db.transaction(()=>db.run("UPDATE routes SET state='READY' WHERE id=?",conflict.id)),{code:'VERSION_CONFLICT'});
      const document=await createDriverDocument(domain,actor,driver.id,{...command(),name:'Control QA',expiresAt:new Date(Date.now()-1000).toISOString(),blocksDispatch:true});
      await assert.rejects(domain.dispatch(actor,route.id,{...command(),expectedVersion:await version()}),{code:'INVALID_TRANSITION'});
      await renewDriverDocument(domain,actor,document.id,{...command(),expiresAt:new Date(Date.now()+86_400_000).toISOString()});
      await domain.inspect(actor,vehicle.id,{...command(),odometer:100,fuelPercent:70,items:[{label:'Frenos QA',severity:'OK',note:'Correcto'}]});
      await domain.dispatch(actor,route.id,{...command(),expectedVersion:await version()});
      const stop=(await db.one('SELECT * FROM stops WHERE route_id=?',route.id))!;
      await assert.rejects(domain.attempt(actor,stop.id,{...command(),expectedVersion:await version(),deliveredParcelIds:[parcels[0].id],failedParcelIds:[],receiverName:'QA',evidenceIds:[],reasonCode:'',nextAction:''}),{code:'EVIDENCE_REQUIRED'});
      const upload=async(parcelId:string,rgb:number[])=>domain.upload(actor,{...command(),parcelId,filename:'qa.png',mimeType:'image/png',dataBase64:photo(rgb)});
      const delivered=await upload(parcels[0].id,[255,0,0]);
      assert.ok(Buffer.isBuffer((await db.one('SELECT data FROM evidence WHERE id=?',delivered.id))!.data));
      await domain.attempt(actor,stop.id,{...command(),expectedVersion:await version(),deliveredParcelIds:[parcels[0].id],failedParcelIds:[parcels[1].id],receiverName:'QA',evidenceIds:[delivered.id],reasonCode:'ABSENT',nextAction:'Devolver'});
      const incident=(await db.one('SELECT id FROM incidents WHERE parcel_id=?',parcels[1].id))!;
      const returned=await domain.authorizeReturn(actor,incident.id,command());
      const depotPhoto=await upload(parcels[1].id,[0,255,0]);
      await domain.receiveReturn(actor,returned.id,{...command(),location:'Depósito QA',evidenceId:depotPhoto.id});
      const senderPhoto=await upload(parcels[1].id,[0,0,255]);
      await domain.sendReturn(actor,returned.id,{...command(),receiverName:'Remitente QA',evidenceId:senderPhoto.id});
      await domain.closeRoute(actor,route.id,{...command(),expectedVersion:await version()});
      const bootstrap=await domain.bootstrap(actor);
      assert.deepEqual(bootstrap.shipments[0].counts,{expected:3,received:2,delivered:1,pending:1,returned:1,missing:1});
      assert.equal(bootstrap.routes.find(row=>row.id===route.id)!.state,'OPERATIONALLY_CLOSED');
      assert.equal(bootstrap.returns[0].depotEvidenceId,depotPhoto.id);
      await assert.rejects(domain.record('vehicles',vehicle.id,{...actor,orgId:randomUUID()}),{code:'NOT_FOUND'});
      throw rollback;
    }),error=>error===rollback);
    assert.equal((await db.one('SELECT COUNT(*) n FROM organizations WHERE id=?',orgId))!.n,0);
    assert.equal((await db.one('SELECT COUNT(*) n FROM users WHERE id=?',userId))!.n,0);
  } finally { await db.close(); }
});
