import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PostgresStore} from '../server/postgres.ts';
import {passwordHash,type Actor} from '../server/auth.ts';
import {Logistics} from '../server/domain.ts';
import {Inventory} from '../server/inventory.ts';
import {Routing} from '../server/routing.ts';
import {reconcileInventory} from '../server/reconciliation.ts';
const cmd=()=>({commandId:randomUUID()});
test('private routing schema on PostgreSQL runtime role applies once and reconciles inventory',async()=>{
 const url=new URL(process.env.DATABASE_URL??'');
 assert.ok(['127.0.0.1','localhost'].includes(url.hostname)&&url.pathname==='/nexora_test');
 const db=new PostgresStore(url.toString());
 try{await db.verify();await assert.rejects(db.transaction(async()=>{
  const actor:Actor={id:randomUUID(),orgId:randomUUID(),name:'Routing QA',role:'ADMIN',driverId:null};
  await db.run('INSERT INTO organizations VALUES(?,?,?)',actor.orgId,'Routing PG QA','UTC');
  await db.run('INSERT INTO users(id,org_id,username,name,password_hash,role) VALUES(?,?,?,?,?,?)',actor.id,actor.orgId,'routing-'+actor.id,'Routing QA',passwordHash('Routing-QA-2026!'),'ADMIN');
  const d=new Logistics(db),inv=new Inventory(db);
  const client=(await d.createClient(actor,{...cmd(),name:'Cliente PG'})).id;
  await db.run('INSERT INTO client_delivery_policies VALUES(?,?,?,?)',actor.orgId,client,'NEXORA',new Date().toISOString());
  const product=(await inv.createProduct(actor,{...cmd(),clientId:client,sku:'PG',name:'Producto PG',tracking:'QUANTITY',weightGrams:100,volumeCm3:100})).id;
  const location=(await inv.createLocation(actor,{...cmd(),code:'PG',name:'Base PG'})).id;
  await inv.receive(actor,{...cmd(),clientId:client,locationId:location,productId:product,quantity:2});
  const order=(await inv.createOrder(actor,{...cmd(),clientId:client,externalId:'PG',orderDate:'2026-10-29',destination:'Destino PG',recipientName:'Receptor',lines:[{productId:product,quantity:2}]})).id;
  const driver=(await d.createDriver(actor,{...cmd(),name:'Chofer',username:'driver-'+actor.id,password:'Driver-QA-2026!'})).id;
  const vehicle=(await d.createVehicle(actor,{...cmd(),plate:'PG',capacityWeightGrams:10000,capacityVolumeCm3:10000,odometer:0})).id;
  const routing=new Routing(db,{search:async()=>[],matrix:async()=>[[0,60],[60,0]],solve:async()=>({routes:[{vehicleId:vehicle,driverId:driver,durationSeconds:720,stops:[{orderId:order,arrivalSeconds:60}]}],unassigned:[]})});
  await routing.point(actor,{...cmd(),kind:'LOCATION',id:location,latitude:-25.3,longitude:-57.6});
  await routing.point(actor,{...cmd(),kind:'ORDER',id:order,latitude:-25.31,longitude:-57.61});
  const proposed=await routing.preview(actor,{date:'2026-10-29',locationId:location,startAt:'2026-10-29T08:00:00Z',endAt:'2026-10-29T18:00:00Z',fleet:[{vehicleId:vehicle,driverId:driver}]});
  const first=await routing.apply(actor,{...cmd(),planId:proposed.id});
  assert.deepEqual(await routing.apply(actor,{...cmd(),planId:proposed.id}),first);
  assert.equal((await db.one('SELECT COUNT(*) AS n FROM routes WHERE org_id=?',actor.orgId))!.n,1);
  assert.equal((await reconcileInventory(db,actor)).ok,true);
  const denied=await db.all("SELECT grantee FROM information_schema.role_table_grants WHERE table_schema='nexora' AND table_name='routing_plans' AND grantee IN('anon','authenticated','nexora_tracking_worker')");assert.equal(denied.length,0);
  throw new Error('ROLLBACK_ROUTING_QA');
 }),/ROLLBACK_ROUTING_QA/);}finally{await db.close();}
});
