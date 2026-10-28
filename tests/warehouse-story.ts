import { configureDelivery } from './support/delivery-policy.ts';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import type { Database, Row } from '../server/database.ts';
import { passwordHash, type Actor } from '../server/auth.ts';
import { Logistics } from '../server/domain.ts';
import { Inventory } from '../server/inventory.ts';
import { QuadOperations, type OperationsConfig } from '../server/quad-operations.ts';

function image(rgb:number[]){
  const chunk=(name:string,data:Buffer)=>{const type=Buffer.from(name),size=Buffer.alloc(4),check=Buffer.alloc(4);size.writeUInt32BE(data.length);let crc=0xffffffff;for(const byte of Buffer.concat([type,data])){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}check.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([size,type,data,check]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(1);header.writeUInt32BE(1,4);header[8]=8;header[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,...rgb]))),chunk('IEND',Buffer.alloc(0))]).toString('base64');
}

/** Provider requests/downloads are fixtures. Database operations use the supplied real adapter. */
export async function warehouseStory(store:Database){
  const orgId=randomUUID(),userId=randomUUID(),command=()=>({commandId:randomUUID()});
  await store.run('INSERT INTO organizations VALUES(?,?,?)',orgId,'QA warehouse rollback','America/Asuncion');
  await store.run('INSERT INTO users(id,org_id,username,name,password_hash,role,driver_id) VALUES(?,?,?,?,?,?,NULL)',userId,orgId,'qa-'+randomUUID(),'QA warehouse',passwordHash('Warehouse-QA-2026!'),'ADMIN');
  const actor:Actor={id:userId,orgId,name:'QA warehouse',role:'ADMIN',driverId:null};
  const domain=new Logistics(store),inventory=new Inventory(store);
  const clientId=(await domain.createClient(actor,{...command(),name:'QA owner'})).id,foreignClient=(await domain.createClient(actor,{...command(),name:'QA other owner'})).id;
  await configureDelivery(store, actor, clientId);
  const locationId=(await inventory.createLocation(actor,{...command(),code:'QA-STOCK',name:'QA stock',kind:'STORAGE'})).id;
  const quarantineId=(await inventory.createLocation(actor,{...command(),code:'QA-QUARANTINE',name:'QA quarantine',kind:'QUARANTINE'})).id;
  const productId=(await inventory.createProduct(actor,{...command(),clientId,sku:'QA-WASHER',barcode:'QA-UPC-1',name:'QA washer',tracking:'QUANTITY',weightGrams:1000,volumeCm3:1000})).id;
  const serialProduct=(await inventory.createProduct(actor,{...command(),clientId,sku:'QA-SERIAL',barcode:'QA-UPC-2',name:'QA serialized',tracking:'SERIAL',weightGrams:500,volumeCm3:500})).id;
  const receive={...command(),clientId,productId,locationId,quantity:3,reference:'QA-ASN-01'};
  assert.deepEqual(await inventory.receive(actor,receive),await inventory.receive(actor,receive));
  await inventory.receive(actor,{...command(),clientId,productId:serialProduct,locationId,quantity:1,serials:[{serial:'QA-SERIAL-1',barcode:'QA-UNIT-1'}]});
  const imported=await inventory.importCsv(actor,{...command(),csv:`clientId,externalId,orderDate,destination,recipientName,sku,quantity\n${clientId},QA-DAY-1,2026-10-15,QA Address,QA Receiver,QA-WASHER,3`});
  const orderId=imported.orders[0].id;
  await inventory.reserveOrder(actor,orderId,command());
  const order:Row=await inventory.order(actor,orderId),parcels=await store.all('SELECT p.* FROM parcels p WHERE shipment_id=? ORDER BY code',order.shipmentId);
  assert.equal(parcels.length,3);
  const driverId=(await domain.createDriver(actor,{...command(),name:'QA driver',username:'driver-'+randomUUID(),password:'Driver-Warehouse-QA-2026!'})).id;
  const vehicleId=(await domain.createVehicle(actor,{...command(),plate:'QA-'+randomUUID(),capacityWeightGrams:10000,capacityVolumeCm3:10000,odometer:0})).id;
  const startAt=new Date(Date.now()-60000).toISOString(),endAt=new Date(Date.now()+3600000).toISOString();
  const routeId=(await domain.createRoute(actor,{...command(),name:'QA route',driverId,vehicleId,startAt,endAt})).id;
  const version=async()=>(await domain.route(routeId,actor)).version;
  await domain.assign(actor,routeId,{...command(),expectedVersion:await version(),parcelIds:parcels.map(p=>p.id),pickup:false});
  await new QuadOperations(store,null).queue(actor,order.shipmentId,{...command(),poiId:25,date:'2026-10-15'});
  const load={...command(),routeId,expectedVersion:await version(),codes:parcels.map(p=>p.code)};
  const loaded=await inventory.loadOrder(actor,orderId,load);assert.equal(loaded.loaded,3);
  assert.deepEqual(await inventory.loadOrder(actor,orderId,load),loaded);
  await domain.ready(actor,routeId,{...command(),expectedVersion:await version()});
  await domain.inspect(actor,vehicleId,{...command(),odometer:0,fuelPercent:100,items:[{label:'QA check',severity:'OK',note:''}]});
  await domain.dispatch(actor,routeId,{...command(),expectedVersion:await version()});
  const stop=await store.one('SELECT * FROM stops WHERE route_id=?',routeId);
  await assert.rejects(domain.attempt(actor,stop!.id,{...command(),expectedVersion:await version(),deliveredParcelIds:[parcels[0].id],failedParcelIds:[],receiverName:'QA Receiver',evidenceIds:[],reasonCode:'',nextAction:''}),{code:'INVALID_TRANSITION'});
  const config:OperationsConfig={orgId,apiKey:'QA fixture only',webhookSecret:'QA fixture secret',proofHosts:['proof.fixture.invalid'],deliveredCodes:[70],failedCodes:[80],constraints:[{id:11,source:'WEIGHT_KG'},{id:12,source:'VOLUME_M3'},{id:13,source:'UNITS'}]};
  let completeProof=false;const external=new Map<string,Row>();
  const request:typeof fetch=async(url,options)=>{
    const target=new URL(String(url));
    if(target.pathname.endsWith('/orders/search')){const entry=external.get(target.searchParams.get('code')!);return Response.json({data:entry?[entry]:[]});}
    if(target.pathname.endsWith('/orders')){const rows=JSON.parse(String(options!.body));assert.equal(rows.length,1);assert.equal(rows[0].orderMeasures.find((r:Row)=>r.constraintId===11).value,1);const row={...rows[0],_id:5000+external.size};external.set(row.code,row);return Response.json({data:[row]});}
    if(target.pathname.endsWith('/consolidated-routes/QA-ROUTE')){
      const links=await store.all('SELECT * FROM quad_parcel_links WHERE org_id=? ORDER BY parcel_id',orgId);
      return Response.json({data:{code:'QA-ROUTE',optimized:true,status:'ongoing',waypoints:links.map((q,i)=>({visitOrder:i+1,activities:{orders:[{_id:q.external_order_id}]},status:{code:i===0?70:80,certifiedAt:new Date().toISOString(),photos:i===0&&completeProof?[{fullUrl:'https://proof.fixture.invalid/photo.png'}]:[],signature:i===0&&completeProof?{fullUrl:'https://proof.fixture.invalid/signature.png',signatureName:'QA Receiver'}:undefined}}))}});
    }
    throw Error('Unexpected provider fixture endpoint');
  };
  const quad=new QuadOperations(store,config,request,async(url)=>({mimeType:'image/png',dataBase64:image(url.includes('signature')?[0,0,255]:[255,0,0])}));
  assert.equal((await quad.process(actor,10)).results.filter(r=>r.state==='EXPORTED').length,3);
  assert.equal((await quad.process(actor,10)).results.length,0);
  await quad.bindRoute(actor,routeId,{...command(),externalRouteId:'QA-ROUTE'});
  const first=await quad.syncRoute(actor,routeId);
  assert.equal(first.outcomes.filter(o=>o.result==='DELIVERED'&&o.evidenceState==='MISSING').length,1);
  assert.equal((await store.one("SELECT COUNT(*) n FROM parcels WHERE shipment_id=? AND state='DELIVERED'",order.shipmentId))!.n,0);
  completeProof=true;await quad.syncRoute(actor,routeId);await quad.syncRoute(actor,routeId);
  const delivered=await store.all("SELECT * FROM parcels WHERE shipment_id=? AND state='DELIVERED'",order.shipmentId);
  assert.equal(delivered.length,1);
  assert.equal((await store.one('SELECT COUNT(*) n FROM quad_proofs WHERE org_id=?',orgId))!.n,2);
  const proofs=await quad.proofs({...actor,role:'CUSTOMER',clientId},order.shipmentId);
  assert(proofs.items.some(p=>p.kind==='SIGNATURE'&&p.evidenceId));
  await assert.rejects(quad.proofs({...actor,role:'CUSTOMER',clientId:foreignClient},order.shipmentId),{code:'NOT_FOUND'});
  const failed=await store.all("SELECT * FROM parcels WHERE shipment_id=? AND state='RETURN_PENDING'",order.shipmentId);assert.equal(failed.length,2);
  const returns=[];
  for(const p of failed){const incident=await store.one('SELECT id FROM incidents WHERE parcel_id=?',p.id);const returned=await domain.authorizeReturn(actor,incident!.id,command());const photo=await domain.upload(actor,{...command(),parcelId:p.id,filename:'QA return.png',mimeType:'image/png',dataBase64:image([0,255,0])});returns.push({returnId:returned.id,evidenceId:photo.id});}
  await inventory.returnOrder(actor,orderId,{...command(),locationId:quarantineId,returns});
  assert.equal((await store.one("SELECT SUM(quantity) n FROM inventory_balances WHERE org_id=? AND product_id=? AND status='QUARANTINE'",orgId,productId))!.n,2);
  await inventory.release(actor,orderId,{...command(),locationId,parcelIds:failed.map(p=>p.id),reason:'QA inspected'});
  assert.equal((await store.one("SELECT SUM(quantity) n FROM inventory_balances WHERE org_id=? AND product_id=? AND status='AVAILABLE'",orgId,productId))!.n,2);
  const customer={...actor,role:'CUSTOMER',clientId};
  assert((await inventory.exportCsv(customer)).includes('QA-SERIAL-1'));
  assert.equal((await inventory.bootstrap({...customer,clientId:foreignClient})).products.length,0);
  return {orgId,userId,orderId,delivered:delivered.length,returned:failed.length};
}
