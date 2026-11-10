import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {passwordHash,type Actor} from '../../server/auth.ts';
import type {Database} from '../../server/database.ts';
import {clientRemovalPreview,removeClient} from '../../server/client-removal.ts';
import {Logistics} from '../../server/domain.ts';
import {Inventory} from '../../server/inventory.ts';
import {StockReceipts} from '../../server/stock-receipts.ts';

const command=()=>({commandId:randomUUID()});
const code=(expected:string)=>(error:unknown)=>(error as {code?:string})?.code===expected;

async function fixture(db:Database){
 const orgId=randomUUID(),id=randomUUID();
 const actor:Actor={orgId,id,name:'Admin QA',role:'ADMIN',driverId:null};
 await db.run('INSERT INTO organizations VALUES(?,?,?)',orgId,'Nexora QA','America/Asuncion');
 await db.run('INSERT INTO users(id,org_id,username,name,password_hash,role,driver_id) VALUES(?,?,?,?,?,?,NULL)',id,orgId,'qa-'+id,actor.name,passwordHash('Prueba-local-2026!'),actor.role);
 const logistics=new Logistics(db),inventory=new Inventory(db);
 const client=(await logistics.createClient(actor,{...command(),name:'Bristol QA',deliveryProvider:'NEXORA'})).id;
 const depot=(await inventory.createLocation(actor,{...command(),code:'QA-DEP',name:'Depósito',kind:'DEPOT'})).id;
 const product=async(clientId:string,sku:string,tracking='QUANTITY')=>(await inventory.createProduct(actor,{...command(),clientId,sku,name:sku,tracking,weightGrams:1000,volumeCm3:1000})).id;
 return {actor,orgId,logistics,inventory,client,depot,product};
}

export async function checkClientRemoval(db:Database){
 const {actor,orgId,logistics,inventory,client,depot,product}=await fixture(db);
 const other=(await logistics.createClient(actor,{...command(),name:'Otro cliente',deliveryProvider:'NEXORA'})).id;
 const ownSku=await product(client,'SKU-1'),otherSku=await product(other,'SKU-1');
 const receipts=new StockReceipts(db);
 await receipts.commit(actor,{...command(),clientId:client,locationId:depot,reference:'REM-CLIENTE',rows:[{row:2,sku:'SKU-1',quantity:3}]});
 await inventory.receive(actor,{...command(),clientId:other,productId:otherSku,locationId:depot,quantity:5});
 const orderData={orderDate:'2026-11-09',destination:'Depósito de prueba',recipientName:'Destinatario QA'};
 const importResult=await inventory.importOrders(actor,{...command(),orders:[
  {...orderData,clientId:client,externalId:'PED-BRISTOL',lines:[{productId:ownSku,quantity:2}]},
  {...orderData,clientId:other,externalId:'PED-OTRO',lines:[{productId:otherSku,quantity:1}]},
 ]});
 const [ownOrder,otherOrder]=importResult.orders;
 await inventory.reserveOrder(actor,ownOrder.id,command());
 await inventory.reserveOrder(actor,otherOrder.id,command());
 const ownParcels=await db.all('SELECT id FROM parcels WHERE org_id=? AND shipment_id=?',orgId,ownOrder.shipmentId);
 const otherParcel=await db.one('SELECT id FROM parcels WHERE org_id=? AND shipment_id=?',orgId,otherOrder.shipmentId);
 assert.equal(ownParcels.length,2);assert.ok(otherParcel);
 const driverId=(await logistics.createDriver(actor,{...command(),name:'Chofer QA',username:'driver-'+randomUUID(),password:'Prueba-local-2026!'})).id;
 const vehicleId=(await logistics.createVehicle(actor,{...command(),plate:'QA-CLIENT',capacityWeightGrams:100000,capacityVolumeCm3:100000,odometer:10})).id;
 const route=(await logistics.createRoute(actor,{...command(),name:'Ruta mixta',driverId,vehicleId,trackingProvider:'TRACCAR',startAt:'2026-11-09T12:00:00Z',endAt:'2026-11-09T15:00:00Z'})).id;
 await logistics.assign(actor,route,{...command(),expectedVersion:1,pickup:false,parcelIds:[...ownParcels.map(p=>p.id),otherParcel.id]});
 const preview=await clientRemovalPreview(db,actor,client);
 assert.deepEqual(preview.totals,{products:1,orders:1,shipments:1,stockUnits:3});
 const confirmation={...command(),expectedName:preview.name,expectedTotals:preview.totals};
 await assert.rejects(removeClient(db,{...actor,role:'OPERATIONS'},client,confirmation),code('FORBIDDEN'));
 await assert.rejects(clientRemovalPreview(db,{...actor,orgId:randomUUID()},client),code('NOT_FOUND'));
 await assert.rejects(removeClient(db,actor,client,{...confirmation,expectedTotals:{...preview.totals,stockUnits:0}}),code('VERSION_CONFLICT'));

 // An active route blocks the removal even before a pending pickup is loaded.
 await db.run("UPDATE routes SET state='IN_PROGRESS' WHERE org_id=? AND id=?",orgId,route);
 assert.equal((await clientRemovalPreview(db,actor,client)).roadParcels,2);
 await assert.rejects(removeClient(db,actor,client,confirmation),code('INVALID_TRANSITION'));
 await db.run("UPDATE routes SET state='DRAFT' WHERE org_id=? AND id=?",orgId,route);
 await logistics.loadSelected(actor,route,{...command(),expectedVersion:2,parcelIds:[ownParcels[0].id]});
 assert.equal((await clientRemovalPreview(db,actor,client)).blocked,true);
 await assert.rejects(removeClient(db,actor,client,confirmation),code('INVALID_TRANSITION'));
 await logistics.unloadSelected(actor,route,{...command(),expectedVersion:3,parcelIds:[ownParcels[0].id]});
 assert.equal((await clientRemovalPreview(db,actor,client)).blocked,false);
 const version=(await db.one('SELECT version FROM routes WHERE id=?',route))!.version;

 const result=await removeClient(db,actor,client,confirmation);
 assert.equal(result.deleted,true);
 assert.deepEqual(await removeClient(db,actor,client,confirmation),result);
 for(const table of ['shipments','inventory_products','inventory_balances','inventory_orders','inventory_movements','inventory_receipt_batches']){
  assert.equal((await db.one(`SELECT COUNT(*) AS n FROM ${table} WHERE org_id=? AND client_id=?`,orgId,client))?.n,0,table);
 }
 assert.equal(await db.one('SELECT id FROM clients WHERE id=?',client),undefined);
 assert.ok(await db.one('SELECT id FROM clients WHERE id=?',other));
 assert.ok(await db.one('SELECT id FROM parcels WHERE id=?',otherParcel.id));
 assert.equal((await db.one('SELECT COUNT(*) AS n FROM route_assignments WHERE route_id=?',route))?.n,1);
 assert.equal((await db.one('SELECT COUNT(*) AS n FROM stops WHERE route_id=?',route))?.n,1);
 assert.equal((await db.one('SELECT version FROM routes WHERE id=?',route))?.version,version+1);
 const [run]=(await inventory.importHistory(actor)).items;
 assert.equal(run.acceptedCount,1);
 assert.equal(run.result?.imported,1);
 assert.deepEqual(run.result?.orders.map((order:{clientId:string})=>order.clientId),[other]);
}

export async function checkProductRemoval(db:Database){
 const {actor,orgId,inventory,client,depot,product}=await fixture(db);
 const stocked=await product(client,'ART-1'),serial=await product(client,'ART-SER','SERIAL'),unused=await product(client,'ART-EMPTY');
 await inventory.receive(actor,{...command(),clientId:client,locationId:depot,productId:stocked,quantity:7});
 await inventory.receive(actor,{...command(),clientId:client,locationId:depot,productId:serial,quantity:1,serials:[{serial:'SERIE-1'}]});
 const order=(await inventory.createOrder(actor,{...command(),clientId:client,externalId:'QA-SKU',orderDate:'2026-11-09',destination:'Destino QA',recipientName:'Persona QA',lines:[{productId:stocked,quantity:1}]})).id;
 const input={...command(),expectedSku:'ART-1'};
 await assert.rejects(inventory.removeProduct(actor,stocked,input),code('INVALID_TRANSITION'));
 await inventory.cancelOrder(actor,order,{...command(),reason:'Pedido de prueba'});
 const result=await inventory.removeProduct(actor,stocked,input);
 assert.equal(result.removedUnits,7);
 assert.equal(result.archived,true);
 assert.deepEqual(await inventory.removeProduct(actor,stocked,input),result);
 assert.equal((await db.one("SELECT COUNT(*) AS n FROM inventory_movements WHERE org_id=? AND product_id=? AND action='ADJUST'",orgId,stocked))?.n,1);
 assert.equal((await inventory.removeProduct(actor,serial,{...command(),expectedSku:'ART-SER'})).removedUnits,1);
 assert.equal((await inventory.stockPage(actor,{clientId:client})).total,0);
 assert.equal((await inventory.stockPage(actor,{clientId:client,status:'ADJUSTED'})).total,1);
 assert.equal((await inventory.removeProduct(actor,unused,{...command(),expectedSku:'ART-EMPTY'})).deleted,true);
 assert.equal(await db.one('SELECT id FROM inventory_products WHERE id=?',unused),undefined);
}
