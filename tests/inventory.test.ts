import { configureDelivery } from './support/delivery-policy.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { Store } from '../server/db.ts';
import { setup, type Actor } from '../server/auth.ts';
import { Logistics } from '../server/domain.ts';
import { Inventory, type InventoryActor } from '../server/inventory.ts';
import { installInventoryRoutes } from '../server/inventory-routes.ts';
import { reconcileInventory } from '../server/reconciliation.ts';

async function fixture(t: any) {
  const store = new Store(':memory:');
  t.after(async () => await store.close());
  const suffix = randomUUID().slice(0, 8);
  const { userId, orgId } = await setup(store, { organizationName: 'Inventario QA', timezone: 'UTC', username: `admin-${suffix}`, password: 'Password-QA-Inventory-2026!' });
  const actor: Actor = { id: userId, orgId, name: 'Admin QA', role: 'ADMIN', driverId: null };
  const domain = new Logistics(store), inventory = new Inventory(store), command = () => ({ commandId: randomUUID() });
  const clientId = (await domain.createClient(actor, { ...command(), name: 'Cliente uno QA' })).id;
  const secondClientId = (await domain.createClient(actor, { ...command(), name: 'Cliente dos QA' })).id;
  await configureDelivery(store, actor, clientId);
  await configureDelivery(store, actor, secondClientId);
  const locationId = (await inventory.createLocation(actor, { ...command(), code: `DEP-${suffix}`, name: 'Depósito QA', kind: 'DEPOT' })).id;
  const shelfId = (await inventory.createLocation(actor, { ...command(), code: `RCK-${suffix}`, name: 'Estante QA', kind: 'STORAGE' })).id;
  const quarantineId = (await inventory.createLocation(actor, { ...command(), code: `QRT-${suffix}`, name: 'Cuarentena QA', kind: 'QUARANTINE' })).id;
  const makeProduct = async (owner = clientId, sku = `SKU-${suffix}`, tracking: 'QUANTITY' | 'SERIAL' = 'QUANTITY') => await inventory.createProduct(actor, {
    ...command(), clientId: owner, sku, barcode: `UPC-${sku}`, name: `Producto ${sku}`, tracking, unit: 'unidad', weightGrams: 700, volumeCm3: 500,
  });
  const product = await makeProduct();
  return { store, actor, domain, inventory, command, clientId, secondClientId, locationId, shelfId, quarantineId, product, makeProduct };
}

const orderBody = (commandId: string, clientId: string, productId: string, externalId: string, quantity: number) => ({
  commandId, clientId, externalId, orderDate: '2026-10-15', destination: 'Av. QA 100', recipientName: 'Receptor QA', recipientPhone: '555-0100',
  lines: [{ productId, quantity }],
});
const code = (errorCode: string) => (error: any) => error?.code === errorCode;

async function inventoryReturnStory(f: any, tracking: 'QUANTITY' | 'SERIAL') {
  const product = tracking === 'SERIAL' ? await f.makeProduct(f.clientId, `RETURN-${randomUUID().slice(0, 8)}`, 'SERIAL') : f.product;
  const serial = tracking === 'SERIAL' ? `RETURN-SERIAL-${randomUUID()}` : undefined;
  await f.inventory.receive(f.actor, { ...f.command(), clientId: f.clientId, productId: product.id, locationId: f.locationId, quantity: 1,
    ...(serial ? { serials: [{ serial }] } : {}) });
  const order = await f.inventory.createOrder(f.actor, orderBody(randomUUID(), f.clientId, product.id, `RETURN-ORDER-${randomUUID()}`, 1));
  const reserved = await f.inventory.reserveOrder(f.actor, order.id, { ...f.command(), locationId: f.locationId });
  const parcelId = reserved.parcels[0].id as string;
  const driverId = (await f.domain.createDriver(f.actor, { ...f.command(), name: 'Return QA driver', username: `return-${randomUUID()}`, password: 'Password-QA-Return-2026!' })).id;
  const vehicleId = (await f.domain.createVehicle(f.actor, { ...f.command(), plate: `RET-${randomUUID().slice(0, 8)}`, capacityWeightGrams: 10000, capacityVolumeCm3: 10000, odometer: 0 })).id;
  const route = await f.domain.createRoute(f.actor, { ...f.command(), name: 'Return QA route', driverId, vehicleId,
    startAt: new Date(Date.now() - 60000).toISOString(), endAt: new Date(Date.now() + 3600000).toISOString() });
  await f.domain.assign(f.actor, route.id, { ...f.command(), expectedVersion: route.version, parcelIds: [parcelId], pickup: false });
  await f.inventory.loadOrder(f.actor, order.id, { ...f.command(), routeId: route.id,
    expectedVersion: (await f.domain.route(route.id, f.actor)).version, codes: [reserved.parcels[0].code] });
  await f.domain.ready(f.actor, route.id, { ...f.command(), expectedVersion: (await f.domain.route(route.id, f.actor)).version });
  await f.domain.inspect(f.actor, vehicleId, { ...f.command(), odometer: 0, fuelPercent: 90, items: [{ label: 'Return QA', severity: 'OK', note: '' }] });
  await f.domain.dispatch(f.actor, route.id, { ...f.command(), expectedVersion: (await f.domain.route(route.id, f.actor)).version });
  await f.store.run(`INSERT INTO quad_parcel_links(org_id,parcel_id,external_code,poi_id,delivery_date,payload,state,updated_at,provider_result,evidence_state,reported_at,receiver_name)
    VALUES(?,?,?,?,?,?, 'EXPORTED',?,?,?, ?,?)`, f.actor.orgId, parcelId, `NX-RETURN-${randomUUID()}`, 123, '2026-10-31', '{}', new Date().toISOString(), 'FAILED', 'PENDING', new Date().toISOString(), '');
  const stop = await f.store.one("SELECT id FROM stops WHERE route_id=? AND kind='DELIVERY'", route.id);
  await f.domain.attempt(f.actor, stop!.id, { ...f.command(), expectedVersion: (await f.domain.route(route.id, f.actor)).version,
    deliveredParcelIds: [], failedParcelIds: [parcelId], receiverName: '', evidenceIds: [], reasonCode: 'ABSENT', nextAction: 'Return to sender' });
  const incident = await f.store.one('SELECT id FROM incidents WHERE org_id=? AND parcel_id=?', f.actor.orgId, parcelId);
  const authorized = await f.domain.authorizeReturn(f.actor, incident!.id, f.command());
  const upload = async (suffix: string) => {
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, ...Buffer.from(suffix)]);
    return (await f.domain.upload(f.actor, { ...f.command(), parcelId, filename: `${suffix}.png`, mimeType: 'image/png', dataBase64: bytes.toString('base64') })).id as string;
  };
  await f.inventory.returnOrder(f.actor, order.id, { ...f.command(), locationId: f.quarantineId,
    returns: [{ returnId: authorized.id, evidenceId: await upload('depot') }] });
  return { product, order, parcelId, returnId: authorized.id as string, serial, upload };
}

test('recepción contabiliza códigos de modelo como cantidad y reintentar el comando no duplica stock', async (t) => {
  const f = await fixture(t);
  const body = { ...f.command(), clientId: f.clientId, productId: f.product.id, locationId: f.locationId, quantity: 7, reference: 'ASN-42', reason: '' };
  const first = await f.inventory.receive(f.actor, body);
  const retry = await f.inventory.receive(f.actor, body);
  assert.deepEqual(retry, first);
  const balance = await f.store.one("SELECT quantity FROM inventory_balances WHERE client_id=? AND product_id=? AND status='AVAILABLE'", f.clientId, f.product.id);
  assert.equal(balance?.quantity, 7);
  assert.equal((await f.store.one("SELECT COUNT(*) AS n FROM inventory_movements WHERE action='RECEIVE' AND command_id=?", body.commandId))?.n, 1);
  await assert.rejects(() => f.inventory.receive(f.actor, { ...body, quantity: 6 }), code('DUPLICATE_COMMAND'));
  assert.equal((await f.store.one("SELECT quantity FROM inventory_balances WHERE client_id=? AND product_id=? AND status='AVAILABLE'", f.clientId, f.product.id))?.quantity, 7);
});

test('disponibilidad del pedido refleja stock real y excluye lo reservado', async (t) => {
  const f = await fixture(t);
  const order = await f.inventory.createOrder(f.actor, orderBody(randomUUID(), f.clientId, f.product.id, 'AVAIL-QA', 2));
  assert.equal((await f.inventory.order(f.actor, order.id)).lines[0].available, 0);
  await f.inventory.receive(f.actor, { ...f.command(), clientId: f.clientId, productId: f.product.id, locationId: f.locationId, quantity: 3 });
  assert.equal((await f.inventory.order(f.actor, order.id)).lines[0].available, 3);
  await f.inventory.reserveOrder(f.actor, order.id, f.command());
  const current = await f.inventory.order(f.actor, order.id);
  assert.equal((await f.store.one('SELECT status FROM inventory_orders WHERE id=?', order.id))?.status, 'RESERVED');
  assert.equal(current.lines[0].available, 1);
  assert.equal(current.lines[0].reserved, 2);
  assert.equal(current.lines[0].loaded, 0);
});

test('pedido completo informa todos los faltantes sin reservar stock y admite reintentar tras la recepción', async (t) => {
  const f=await fixture(t), serial=await f.makeProduct(f.clientId,'SERIAL-ESPERA','SERIAL');
  const ready=await f.makeProduct(f.clientId,'CARGADOR-ESPERA');
  const receive=(productId:string,quantity:number,serials?:Array<{serial:string}>,locationId=f.locationId)=>f.inventory.receive(f.actor,{...f.command(),clientId:f.clientId,productId,locationId,quantity,...(serials?{serials}:{})});
  await receive(serial.id,1,[{serial:'SERIE-1'}]);
  await receive(ready.id,31);
  await receive(f.product.id,10,undefined,f.shelfId);
  await f.store.run('UPDATE inventory_locations SET active=0 WHERE id=?',f.shelfId);
  const other=await f.makeProduct(f.secondClientId,f.product.sku);
  await f.inventory.receive(f.actor,{...f.command(),clientId:f.secondClientId,productId:other.id,locationId:f.locationId,quantity:9});
  const order=await f.inventory.createOrder(f.actor,{...orderBody(randomUUID(),f.clientId,f.product.id,'ESPERA-COMPLETO',2),lines:[{productId:f.product.id,quantity:2},{productId:serial.id,quantity:2},{productId:ready.id,quantity:1}]});
  const reservation=f.command(), before=await f.inventory.order(f.actor,order.id);
  await assert.rejects(()=>f.inventory.reserveOrder(f.actor,order.id,reservation),(error:any)=>{
    assert.equal(error.code,'INSUFFICIENT_STOCK');
    const shortages=error.details.shortages.sort((a:any,b:any)=>a.sku.localeCompare(b.sku));
    assert.equal(shortages.length,2);
    for(const [id,available,missing] of [[f.product.id,0,2],[serial.id,1,1]]){
      const shortage=shortages.find((row:any)=>row.productId===id);
      assert.equal(shortage.requested,2);assert.equal(shortage.available,available);assert.equal(shortage.missing,missing);
    }
    return true;
  });
  const after=await f.inventory.order(f.actor,order.id);
  assert.equal((await f.store.one('SELECT status FROM inventory_orders WHERE id=?',order.id))!.status,'DRAFT');assert.deepEqual(after.lines,before.lines);assert.equal(after.parcels.length,0);
  assert.equal((await f.store.one('SELECT COUNT(*) AS n FROM inventory_commands WHERE command_id=?',reservation.commandId))!.n,0);
  await receive(f.product.id,2);await receive(serial.id,1,[{serial:'SERIE-2'}]);
  const result=await f.inventory.reserveOrder(f.actor,order.id,reservation);
  assert.equal(result.reserved,5);assert.equal(result.status,'RESERVED');
  assert.equal((await f.inventory.reserveOrder(f.actor,order.id,reservation)).reserved,5);
  const complete=await f.inventory.order(f.actor,order.id);
  assert.equal(complete.parcels.length,5);assert.ok(complete.lines.every((line:any)=>line.reserved===line.requested));
  assert.equal(complete.lines.find((line:any)=>line.productId===ready.id)!.available,30);
  assert.equal((await reconcileInventory(f.store,f.actor)).ok,true);
});

test('desreservar libera stock, retira solo el pedido de la ruta y admite una nueva reserva', async (t) => {
  const f=await fixture(t);
  await f.inventory.receive(f.actor,{...f.command(),clientId:f.clientId,productId:f.product.id,locationId:f.locationId,quantity:3});
  const first=await f.inventory.createOrder(f.actor,orderBody(randomUUID(),f.clientId,f.product.id,'UNRES-A',2));
  const second=await f.inventory.createOrder(f.actor,orderBody(randomUUID(),f.clientId,f.product.id,'UNRES-B',1));
  const reserved=await f.inventory.reserveOrder(f.actor,first.id,f.command());
  const other=await f.inventory.reserveOrder(f.actor,second.id,f.command());
  const driverId=(await f.domain.createDriver(f.actor,{...f.command(),name:'Chofer',username:'unreserve-driver',password:'Password-QA-Driver-2026!'})).id;
  const vehicleId=(await f.domain.createVehicle(f.actor,{...f.command(),plate:'UNRES-1',capacityWeightGrams:10000,capacityVolumeCm3:10000,odometer:0})).id;
  const route=await f.domain.createRoute(f.actor,{...f.command(),name:'Ruta',driverId,vehicleId,startAt:new Date(Date.now()-60000).toISOString(),endAt:new Date(Date.now()+3600000).toISOString()});
  await f.domain.assign(f.actor,route.id,{...f.command(),expectedVersion:route.version,parcelIds:[...reserved.parcels,...other.parcels].map((p:any)=>p.id),pickup:false});
  let version=(await f.store.one('SELECT version FROM routes WHERE id=?',route.id))!.version;

  const command=f.command(); const result=await f.inventory.unreserveOrder(f.actor,first.id,command);
  assert.equal(result.released,2);assert.deepEqual(await f.inventory.unreserveOrder(f.actor,first.id,command),result);
  assert.equal((await f.inventory.order(f.actor,first.id)).parcels.length,0);
  assert.equal((await f.store.one("SELECT quantity FROM inventory_balances WHERE product_id=? AND status='AVAILABLE'",f.product.id))!.quantity,2);
  assert.equal((await f.store.one('SELECT state FROM routes WHERE id=?',route.id))!.state,'DRAFT');
  assert.equal((await f.store.one('SELECT count(*) AS n FROM route_assignments WHERE route_id=? AND active=1',route.id))!.n,1);
  assert.equal((await f.store.one('SELECT count(*) AS n FROM stops WHERE route_id=?',route.id))!.n,1);
  assert.equal((await reconcileInventory(f.store,f.actor)).ok,true);
  assert.equal((await f.domain.bootstrap(f.actor)).parcels.some((p:any)=>p.id===reserved.parcels[0].id),false);
  version=(await f.store.one('SELECT version FROM routes WHERE id=?',route.id))!.version;
  await assert.rejects(()=>f.domain.assign(f.actor,route.id,{...f.command(),expectedVersion:version,parcelIds:[reserved.parcels[0].id],pickup:false}),code('INVALID_TRANSITION'));
  const newReservation=await f.inventory.reserveOrder(f.actor,first.id,f.command());assert.equal(newReservation.parcels.length,2);
  assert.equal((await f.inventory.order(f.actor,first.id)).parcels.length,2);
});

test('descargar y quitar de ruta revierte la carga y permite reasignar, recargar y desreservar', async t=>{
  const f=await fixture(t);
  await f.inventory.receive(f.actor,{...f.command(),clientId:f.clientId,productId:f.product.id,locationId:f.locationId,quantity:1});
  const order=await f.inventory.createOrder(f.actor,orderBody(randomUUID(),f.clientId,f.product.id,'UNRES-LOADED',1));
  const reserved=await f.inventory.reserveOrder(f.actor,order.id,f.command());
  const driverId=(await f.domain.createDriver(f.actor,{...f.command(),name:'Chofer',username:'unreserve-loaded',password:'Password-QA-Driver-2026!'})).id;
  const vehicleId=(await f.domain.createVehicle(f.actor,{...f.command(),plate:'UNRES-2',capacityWeightGrams:10000,capacityVolumeCm3:10000,odometer:0})).id;
  const route=await f.domain.createRoute(f.actor,{...f.command(),name:'Ruta',driverId,vehicleId,startAt:new Date(Date.now()-60000).toISOString(),endAt:new Date(Date.now()+3600000).toISOString()});
  await f.domain.assign(f.actor,route.id,{...f.command(),expectedVersion:route.version,parcelIds:[reserved.parcels[0].id],pickup:false});
  let version=(await f.store.one('SELECT version FROM routes WHERE id=?',route.id))!.version;
  await f.domain.load(f.actor,route.id,{...f.command(),expectedVersion:version,code:reserved.parcels[0].code});
  await assert.rejects(()=>f.inventory.unreserveOrder(f.actor,order.id,f.command()),code('INVALID_TRANSITION'));
  assert.equal((await f.store.one('SELECT state FROM parcels WHERE id=?',reserved.parcels[0].id))!.state,'LOADED');
  assert.equal((await f.store.one('SELECT count(*) AS n FROM route_assignments WHERE route_id=? AND active=1',route.id))!.n,1);
  assert.equal((await reconcileInventory(f.store,f.actor)).ok,true);
  const unloadCommand={...f.command(),expectedVersion:(await f.store.one('SELECT version FROM routes WHERE id=?',route.id))!.version,parcelId:reserved.parcels[0].id};
  const unloaded=await f.domain.unload(f.actor,route.id,unloadCommand);
  assert.deepEqual(await f.domain.unload(f.actor,route.id,unloadCommand),unloaded);
  const afterUnload=await f.inventory.order(f.actor,order.id);
  assert.equal(afterUnload.lines[0].loaded,0);assert.equal(afterUnload.parcels[0].state,'RESERVED');
  assert.equal((await reconcileInventory(f.store,f.actor)).ok,true);
  await f.domain.unassign(f.actor,route.id,{...f.command(),expectedVersion:unloaded.version,parcelId:reserved.parcels[0].id});
  assert.equal((await f.store.one('SELECT state FROM routes WHERE id=?',route.id))!.state,'DRAFT');
  assert.equal((await f.store.one('SELECT count(*) AS n FROM stops WHERE route_id=?',route.id))!.n,0);
  version=(await f.store.one('SELECT version FROM routes WHERE id=?',route.id))!.version;
  await f.domain.assign(f.actor,route.id,{...f.command(),expectedVersion:version,parcelIds:[reserved.parcels[0].id],pickup:false});
  version=(await f.store.one('SELECT version FROM routes WHERE id=?',route.id))!.version;
  await f.domain.load(f.actor,route.id,{...f.command(),expectedVersion:version,code:reserved.parcels[0].code});
  version=(await f.store.one('SELECT version FROM routes WHERE id=?',route.id))!.version;
  await f.domain.unload(f.actor,route.id,{...f.command(),expectedVersion:version,parcelId:reserved.parcels[0].id});
  await f.inventory.unreserveOrder(f.actor,order.id,f.command());
  assert.equal((await reconcileInventory(f.store,f.actor)).ok,true);
});

test('desreservar conserva la serie y permite editar o reservar de nuevo', async t=>{
  const f=await fixture(t),product=await f.makeProduct(f.clientId,'SERIAL-UNRES','SERIAL');
  await f.inventory.receive(f.actor,{...f.command(),clientId:f.clientId,productId:product.id,locationId:f.locationId,quantity:1,serials:[{serial:'SERIE-001'}]});
  const order=await f.inventory.createOrder(f.actor,orderBody(randomUUID(),f.clientId,product.id,'UNRES-SERIAL',1));
  const reserved=await f.inventory.reserveOrder(f.actor,order.id,f.command());
  const driverId=(await f.domain.createDriver(f.actor,{...f.command(),name:'Chofer',username:'serial-unload',password:'Password-QA-Driver-2026!'})).id;
  const vehicleId=(await f.domain.createVehicle(f.actor,{...f.command(),plate:'SER-UNLOAD',capacityWeightGrams:10000,capacityVolumeCm3:10000,odometer:0})).id;
  const route=await f.domain.createRoute(f.actor,{...f.command(),name:'Ruta',driverId,vehicleId,startAt:new Date(Date.now()-60000).toISOString(),endAt:new Date(Date.now()+3600000).toISOString()});
  await f.domain.assign(f.actor,route.id,{...f.command(),expectedVersion:route.version,parcelIds:[reserved.parcels[0].id],pickup:false});
  let version=(await f.store.one('SELECT version FROM routes WHERE id=?',route.id))!.version;
  await f.domain.load(f.actor,route.id,{...f.command(),expectedVersion:version,code:reserved.parcels[0].code});version=(await f.store.one('SELECT version FROM routes WHERE id=?',route.id))!.version;
  await f.domain.unload(f.actor,route.id,{...f.command(),expectedVersion:version,parcelId:reserved.parcels[0].id});
  await f.inventory.unreserveOrder(f.actor,order.id,f.command());
  const unit=await f.store.one('SELECT status,serial,order_id,parcel_id FROM inventory_units WHERE product_id=?',product.id);
  assert.equal(unit!.status,'AVAILABLE');assert.equal(unit!.serial,'SERIE-001');assert.equal(unit!.order_id,'');assert.equal(unit!.parcel_id,null);
  await f.inventory.updateOrder(f.actor,order.id,{...f.command(),recipientName:'Editado',lines:[{productId:product.id,quantity:1}]});
  await f.inventory.reserveOrder(f.actor,order.id,f.command());
  assert.equal((await reconcileInventory(f.store,f.actor)).ok,true);
});

test('desreserva respeta permisos y no afecta pedidos de otra empresa', async t=>{
  const f=await fixture(t);
  await f.inventory.receive(f.actor,{...f.command(),clientId:f.clientId,productId:f.product.id,locationId:f.locationId,quantity:1});
  const order=await f.inventory.createOrder(f.actor,orderBody(randomUUID(),f.clientId,f.product.id,'UNRES-AUTH',1));
  await f.inventory.reserveOrder(f.actor,order.id,f.command());
  await assert.rejects(()=>f.inventory.unreserveOrder({...f.actor,role:'CUSTOMER',clientId:f.clientId},order.id,f.command()),code('FORBIDDEN'));
  const foreignOrg=randomUUID(),foreignUser=randomUUID();
  await f.store.run('INSERT INTO organizations VALUES(?,?,?)',foreignOrg,'Empresa ajena','UTC');
  await f.store.run('INSERT INTO users(id,org_id,username,name,password_hash,role,driver_id) VALUES(?,?,?,?,?,?,NULL)',foreignUser,foreignOrg,'foreign-'+randomUUID(),'Ajeno','unused','ADMIN');
  await assert.rejects(()=>f.inventory.unreserveOrder({...f.actor,id:foreignUser,orgId:foreignOrg},order.id,f.command()),code('NOT_FOUND'));
  assert.equal((await f.inventory.order(f.actor,order.id)).parcels[0].state,'RESERVED');
});

test('órdenes de dos clientes no mezclan productos y una importación inválida revierte todo', async (t) => {
  const f = await fixture(t), foreign = await f.makeProduct(f.secondClientId, 'SKU-OTHER');
  await assert.rejects(() => f.inventory.createOrder(f.actor, orderBody(randomUUID(), f.clientId, foreign.id, 'ORDER-X', 1)), code('FORBIDDEN'));
  await assert.rejects(() => f.inventory.importOrders(f.actor, { commandId: randomUUID(), orders: [
    { ...orderBody(randomUUID(), f.clientId, f.product.id, 'ORDER-VALID', 1), commandId: undefined },
    { ...orderBody(randomUUID(), f.clientId, foreign.id, 'ORDER-FOREIGN', 1), commandId: undefined },
  ] }), (error: any) => error?.code === 'VALIDATION_ERROR' && error?.details?.rowErrors?.length > 0);
  assert.equal((await f.store.one('SELECT COUNT(*) AS n FROM inventory_orders'))?.n, 0);
  assert.equal((await f.store.one('SELECT COUNT(*) AS n FROM shipments'))?.n, 0);
});

test('CSV agrupa líneas de un pedido, rechaza encabezados contradictorios y conserva atomicidad', async (t) => {
  const f = await fixture(t);
  const header = 'clientId,externalId,orderDate,destination,recipientName,recipientPhone,sku,quantity';
  const csv = `${header}\n${f.clientId},DAILY-42,2026-10-15,Av QA 42,Receptor QA,555-0142,${f.product.sku},2\n${f.clientId},DAILY-42,2026-10-15,Av QA 42,Receptor QA,555-0142,${f.product.sku},3`;
  const imported = await f.inventory.importCsv(f.actor, { commandId: randomUUID(), csv });
  assert.equal(imported.imported, 1);
  assert.equal((await f.store.one('SELECT quantity FROM inventory_order_lines WHERE order_id=?', imported.orders[0].id))?.quantity, 5);
  const conflict = `${header}\n${f.clientId},DAILY-CONFLICT,2026-10-15,Av QA 1,Receptor QA,555-0142,${f.product.sku},1\n${f.clientId},DAILY-CONFLICT,2026-10-16,Av QA 1,Receptor QA,555-0142,${f.product.sku},1`;
  await assert.rejects(() => f.inventory.importCsv(f.actor, { commandId: randomUUID(), csv: conflict }), code('VALIDATION_ERROR'));
  assert.equal((await f.store.one("SELECT COUNT(*) AS n FROM inventory_orders WHERE external_id='DAILY-CONFLICT'"))?.n, 0);
  await assert.rejects(() => f.inventory.importCsv(f.actor, { commandId: randomUUID(), csv }), (error: any) => error?.code === 'VALIDATION_ERROR' && error?.details?.rowErrors?.some((row: any) => row.code === 'DUPLICATE_ORDER'));
  assert.equal((await f.store.one("SELECT COUNT(*) AS n FROM inventory_orders WHERE external_id='DAILY-42'"))?.n, 1);
});

test('preview valida fechas reales por fila, y el historial conserva errores sin guardar el origen', async (t) => {
  const f = await fixture(t), commandId = randomUUID();
  const invalid = { ...orderBody(randomUUID(), f.clientId, f.product.id, 'BAD-DATE', 1), orderDate: undefined, date: '2026-99-99' };
  const preview = await f.inventory.previewImport(f.actor, { commandId, clientId: f.clientId, orders: [invalid] });
  assert.equal(preview.valid, false);
  assert.equal(preview.rowErrors[0].row, 1);
  assert.equal((await f.store.one('SELECT COUNT(*) AS n FROM inventory_orders'))?.n, 0);
  await assert.rejects(() => f.inventory.importOrders(f.actor, { commandId, clientId: f.clientId, orders: [invalid] }), (error: any) => error?.code === 'VALIDATION_ERROR' && error?.details?.rowErrors?.length > 0);
  const history = await f.inventory.importHistory(f.actor);
  assert.equal(history.items.length, 1);
  assert.equal(history.items[0].commandId, commandId);
  assert.equal(history.items[0].status, 'REJECTED');
  assert.equal(JSON.stringify(history.items[0]).includes('2026-99-99'), false);

  const successCommand = randomUUID();
  const success = await f.inventory.importOrders(f.actor, { commandId: successCommand, clientId: f.clientId, orders: [
    { ...orderBody(randomUUID(), f.clientId, f.product.id, 'VALID-DATE', 1), orderDate: undefined, date: '2026-10-15' },
  ] });
  assert.equal(success.imported, 1);
  assert.equal((await f.inventory.importHistory(f.actor)).items[0].status, 'IMPORTED');
});

test('un fallo al guardar el historial revierte el lote y permite reintentar el mismo comando', async (t) => {
  const f = await fixture(t), input = { commandId: randomUUID(), orders: [orderBody(randomUUID(), f.clientId, f.product.id, 'ATOMIC-HISTORY', 1)] };
  const inventory = f.inventory as any, original = inventory.recordImportRun.bind(inventory);
  inventory.recordImportRun = async () => { throw new Error('history write failed'); };
  await assert.rejects(() => f.inventory.importOrders(f.actor, input), /history write failed/);
  assert.equal((await f.store.one('SELECT COUNT(*) AS n FROM inventory_orders'))?.n, 0);
  assert.equal((await f.store.one('SELECT COUNT(*) AS n FROM shipments'))?.n, 0);
  assert.equal((await f.store.one('SELECT COUNT(*) AS n FROM inventory_commands WHERE command_id=?', input.commandId))?.n, 0);
  inventory.recordImportRun = original;
  const retry = await f.inventory.importOrders(f.actor, input);
  assert.equal(retry.imported, 1);
  assert.equal((await f.inventory.importHistory(f.actor)).items[0].status, 'IMPORTED');
});

test('edición y cancelación sólo afectan pedidos DRAFT, y el motivo queda en auditoría', async (t) => {
  const f = await fixture(t), draft = await f.inventory.createOrder(f.actor, orderBody(randomUUID(), f.clientId, f.product.id, 'EDIT-ME', 1));
  const updated = await f.inventory.updateOrder(f.actor, draft.id, { commandId: randomUUID(), date: '2026-10-16', destination: 'Calle nueva 123', recipientName: 'Receptor nuevo', lines: [{ productId: f.product.id, quantity: 2 }] });
  assert.equal((updated as any).orderDate, '2026-10-16');
  assert.equal((updated as any).destination, 'Calle nueva 123');
  assert.equal(updated.lines[0].requested, 2);
  const shipment = await f.store.one('SELECT destination_text,recipient_name FROM shipments WHERE id=?', draft.shipmentId);
  assert.equal(shipment?.destination_text, 'Calle nueva 123');
  assert.equal(shipment?.recipient_name, 'Receptor nuevo');

  const cancelled = await f.inventory.createOrder(f.actor, orderBody(randomUUID(), f.clientId, f.product.id, 'CANCEL-ME', 1));
  const command = randomUUID(), reason = 'Cliente canceló antes de preparar';
  const result = await f.inventory.cancelOrder(f.actor, cancelled.id, { commandId: command, reason });
  assert.equal(result.status, 'CANCELLED');
  const audit = await f.store.one('SELECT details FROM audit WHERE command_id=?', command);
  assert.equal(JSON.parse(audit!.details).reason, reason);
  await assert.rejects(() => f.inventory.reserveOrder(f.actor, cancelled.id, { commandId: randomUUID() }), code('INVALID_TRANSITION'));

  await f.inventory.receive(f.actor, { ...f.command(), clientId: f.clientId, productId: f.product.id, locationId: f.locationId, quantity: 2 });
  const reserved = await f.inventory.createOrder(f.actor, orderBody(randomUUID(), f.clientId, f.product.id, 'RESERVED-LOCK', 1));
  await f.inventory.reserveOrder(f.actor, reserved.id, { ...f.command(), locationId: f.locationId });
  await assert.rejects(() => f.inventory.updateOrder(f.actor, reserved.id, { commandId: randomUUID(), destination: 'Must be blocked' }), code('INVALID_TRANSITION'));
  await assert.rejects(() => f.inventory.cancelOrder(f.actor, reserved.id, { commandId: randomUUID(), reason: 'Too late' }), code('INVALID_TRANSITION'));
});

test('dos reservas concurrentes no sobreasignan; importación por lotes es idempotente y all-or-nothing', async (t) => {
  const f = await fixture(t);
  await f.inventory.receive(f.actor, { ...f.command(), clientId: f.clientId, productId: f.product.id, locationId: f.locationId, quantity: 3 });
  const one = await f.inventory.createOrder(f.actor, orderBody(randomUUID(), f.clientId, f.product.id, 'ORDER-A', 2));
  const two = await f.inventory.createOrder(f.actor, orderBody(randomUUID(), f.clientId, f.product.id, 'ORDER-B', 2));
  const commandA = { ...f.command(), locationId: f.locationId }, commandB = { ...f.command(), locationId: f.locationId };
  const results = await Promise.allSettled([
    f.inventory.reserveOrder(f.actor, one.id, commandA),
    f.inventory.reserveOrder(f.actor, two.id, commandB),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected' && (result.reason as any)?.code === 'INSUFFICIENT_STOCK').length, 1);
  assert.equal((await f.store.one("SELECT SUM(quantity) AS n FROM inventory_balances WHERE product_id=? AND status='AVAILABLE'", f.product.id))?.n, 1);
  assert.equal((await f.store.one("SELECT SUM(quantity) AS n FROM inventory_balances WHERE product_id=? AND status='RESERVED'", f.product.id))?.n, 2);
  assert.equal((await f.store.one('SELECT COUNT(*) AS n FROM inventory_order_parcels'))?.n, 2);
  const successful = results.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<any>;
  const retryOrderId = successful.value.id;
  const command = retryOrderId === one.id ? commandA : commandB;
  assert.deepEqual(await f.inventory.reserveOrder(f.actor, retryOrderId, command), successful.value);
  await assert.rejects(() => f.inventory.reserveOrder(f.actor, retryOrderId, { ...f.command() }), code('INVALID_TRANSITION'));
});

test('parcels por unidad enlazan ruta, bloquean cierre manual, entregan parcial con QuadMinds y retornan a cuarentena', async (t) => {
  const f = await fixture(t);
  await f.inventory.receive(f.actor, { ...f.command(), clientId: f.clientId, productId: f.product.id, locationId: f.locationId, quantity: 3 });
  const order = await f.inventory.createOrder(f.actor, orderBody(randomUUID(), f.clientId, f.product.id, 'ORDER-PARTIAL', 3));
  const reservation = await f.inventory.reserveOrder(f.actor, order.id, { ...f.command(), locationId: f.locationId });
  assert.equal(reservation.parcels.length, 3);
  const adminBootstrap = await f.domain.bootstrap(f.actor);
  const labeledParcel = adminBootstrap.parcels.find((parcel: any) => parcel.id === reservation.parcels[0].id);
  assert.deepEqual(labeledParcel?.product, { name: f.product.name, sku: f.product.sku });
  const driverId = (await f.domain.createDriver(f.actor, { ...f.command(), name: 'Chofer QA', username: `driver-${randomUUID().slice(0, 8)}`, password: 'Password-QA-Driver-2026!' })).id;
  const vehicleId = (await f.domain.createVehicle(f.actor, { ...f.command(), plate: `QA-${randomUUID().slice(0, 6)}`, capacityWeightGrams: 5000, capacityVolumeCm3: 5000, odometer: 0 })).id;
  const route = await f.domain.createRoute(f.actor, { ...f.command(), name: 'Ruta de inventario QA', driverId, vehicleId, startAt: new Date(Date.now() - 60_000).toISOString(), endAt: new Date(Date.now() + 3_600_000).toISOString() });
  await f.domain.assign(f.actor, route.id, { ...f.command(), expectedVersion: route.version, parcelIds: reservation.parcels.map((parcel: any) => parcel.id), pickup: false });
  const driverUser = await f.store.one('SELECT id FROM users WHERE org_id=? AND driver_id=?', f.actor.orgId, driverId);
  const driverBootstrap = await f.domain.bootstrap({ ...f.actor, id: driverUser!.id, role: 'DRIVER', driverId });
  assert.deepEqual(driverBootstrap.parcels.find((parcel: any) => parcel.id === reservation.parcels[0].id)?.product, { name: f.product.name, sku: f.product.sku });
  const loadVersion = (await f.store.one('SELECT version FROM routes WHERE id=?', route.id))!.version;
  const loaded = await f.inventory.loadOrder(f.actor, order.id, { ...f.command(), routeId: route.id, expectedVersion: loadVersion, codes: [f.product.barcode, f.product.barcode, reservation.parcels[2].code] });
  assert.equal(loaded.loaded, 3);
  assert.equal(loaded.status, 'LOADED');
  assert.equal((await f.inventory.order(f.actor, order.id)).lines[0].loaded, 3);
  assert.equal((await f.store.one("SELECT SUM(quantity) AS n FROM inventory_balances WHERE product_id=? AND status='VEHICLE' AND custody_id=?", f.product.id, vehicleId))?.n, 3);
  const packages = await f.store.all('SELECT parcel_id FROM inventory_order_parcels WHERE order_id=? ORDER BY parcel_id', order.id);
  await assert.rejects(() => f.inventory.syncParcelTransition(f.actor, packages[0].parcel_id, 'IN_TRANSIT', 'DELIVERED', 'RECIPIENT', 'Receptor QA', randomUUID()), code('EVIDENCE_REQUIRED'));
  await f.domain.inspect(f.actor, vehicleId, { ...f.command(), odometer: 0, fuelPercent: 90, items: [{ severity: 'OK', label: 'Inspección QA', note: '' }] });
  let currentVersion = (await f.store.one('SELECT version FROM routes WHERE id=?', route.id))!.version;
  await f.domain.ready(f.actor,route.id,{...f.command(),expectedVersion:currentVersion});
  currentVersion=(await f.domain.route(route.id,f.actor)).version;
  await f.domain.dispatch(f.actor, route.id, { ...f.command(), expectedVersion: currentVersion });
  const stop = await f.store.one('SELECT id FROM stops WHERE route_id=? AND shipment_id=?', route.id, order.shipmentId);
  assert(stop);
  currentVersion = (await f.store.one('SELECT version FROM routes WHERE id=?', route.id))!.version;
  await assert.rejects(() => f.domain.attempt(f.actor, stop.id, { ...f.command(), expectedVersion: currentVersion,
    deliveredParcelIds: [packages[0].parcel_id], failedParcelIds: [], receiverName: 'Receptor QA', reasonCode: '', nextAction: '', evidenceIds: [] }), code('INVALID_TRANSITION'));

  const upload = async (parcelId: string, suffix: string) => {
    const data = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, ...Buffer.from(suffix)]);
    const file = await f.domain.upload(f.actor, { ...f.command(), parcelId, filename: `${suffix}.png`, mimeType: 'image/png', dataBase64: data.toString('base64') });
    return file.id as string;
  };
  for (let index = 0; index < packages.length; index++) {
    const parcelId = packages[index].parcel_id;
    const delivered = index < 2;
    await f.store.run(`INSERT INTO quad_parcel_links(org_id,parcel_id,external_code,poi_id,delivery_date,payload,state,updated_at,provider_result,evidence_state,reported_at,receiver_name)
      VALUES(?,?,?,?,?,?, 'EXPORTED',?,?,?, ?,?)`, f.actor.orgId, parcelId, `NX-QA-${index}`, 123, '2026-10-15', '{}', new Date().toISOString(), delivered ? 'DELIVERED' : 'FAILED', delivered ? 'COMPLETE' : 'PENDING', new Date().toISOString(), delivered ? 'Receptor QA' : '');
    if (delivered) {
      for (const kind of ['PHOTO', 'SIGNATURE'] as const) {
        const evidenceId = await upload(parcelId, `${kind}-${index}`);
        const sourceHash = createHash('sha256').update(`${kind}-${index}`).digest('hex');
        await f.store.run('INSERT INTO quad_proofs(id,org_id,parcel_id,kind,evidence_id,source_hash,created_at) VALUES(?,?,?,?,?,?,?)', randomUUID(), f.actor.orgId, parcelId, kind, evidenceId, sourceHash, new Date().toISOString());
      }
    }
  }
  const evidenceIds = await f.store.all(`SELECT q.evidence_id FROM quad_proofs q JOIN inventory_order_parcels op ON op.parcel_id=q.parcel_id WHERE op.order_id=?`, order.id);
  currentVersion = (await f.store.one('SELECT version FROM routes WHERE id=?', route.id))!.version;
  await f.domain.attempt(f.actor, stop.id, { ...f.command(), expectedVersion: currentVersion,
    deliveredParcelIds: packages.slice(0, 2).map((item: any) => item.parcel_id), failedParcelIds: [packages[2].parcel_id],
    receiverName: 'Receptor QA', reasonCode: 'OTHER', nextAction: 'Autorizar retorno', evidenceIds: evidenceIds.map(row => row.evidence_id) });
  assert.equal((await f.store.one('SELECT delivered_quantity FROM inventory_order_lines WHERE order_id=?', order.id))?.delivered_quantity, 2);
  assert.equal((await f.store.one("SELECT SUM(quantity) AS n FROM inventory_balances WHERE product_id=? AND status='VEHICLE' AND custody_id=?", f.product.id, vehicleId))?.n, 1);
  const incident = await f.store.one("SELECT id FROM incidents WHERE parcel_id=? AND state='OPEN'", packages[2].parcel_id);
  assert(incident);
  const authorized = await f.domain.authorizeReturn(f.actor, incident.id, f.command());
  const receiptEvidenceId = await upload(packages[2].parcel_id, 'return-receipt');
  const returnedToDepot = await f.inventory.returnOrder(f.actor, order.id, { ...f.command(), locationId: f.quarantineId,
    returns: [{ returnId: authorized.id, evidenceId: receiptEvidenceId }] });
  assert.equal(returnedToDepot.returns[0].state, 'AT_DEPOT');
  assert.equal((await f.store.one("SELECT SUM(quantity) AS n FROM inventory_balances WHERE product_id=? AND status='VEHICLE' AND custody_id=?", f.product.id, vehicleId))?.n, 0);
  assert.equal((await f.store.one("SELECT SUM(quantity) AS n FROM inventory_balances WHERE product_id=? AND status='QUARANTINE' AND location_id=?", f.product.id, f.quarantineId))?.n, 1);
  assert.equal((await reconcileInventory(f.store, f.actor)).ok, true);
  const returned = (await f.store.one("SELECT parcel_id FROM inventory_order_parcels WHERE order_id=? AND state='QUARANTINE'", order.id))!.parcel_id;
  const released = await f.inventory.release(f.actor, order.id, { ...f.command(), locationId: f.shelfId, parcelIds: [returned], reason: 'Inspección QA aprobada' });
  assert.equal(released.released, 1);
  assert.equal((await f.store.one("SELECT SUM(quantity) AS n FROM inventory_balances WHERE product_id=? AND status='AVAILABLE'", f.product.id))?.n, 1);
  const returnedId = (await f.store.one('SELECT id FROM returns WHERE parcel_id=?', returned))!.id;
  assert.equal((await f.store.one('SELECT disposition FROM return_dispositions WHERE return_id=?', returnedId))?.disposition, 'RESTOCKED');
  await assert.rejects(() => f.store.run("UPDATE return_dispositions SET disposition='SENT_TO_SENDER' WHERE return_id=?", returnedId), /RETURN_DISPOSITION_APPEND_ONLY/);
  const movementCount = (await f.store.one('SELECT COUNT(*) AS n FROM inventory_movements WHERE parcel_id=?', returned))!.n;
  await assert.rejects(() => f.domain.sendReturn(f.actor, returnedId, { ...f.command(), receiverName: 'QA sender', evidenceId: randomUUID() }), code('INVALID_TRANSITION'));
  assert.equal((await f.store.one('SELECT COUNT(*) AS n FROM inventory_movements WHERE parcel_id=?', returned))!.n, movementCount);
  assert.equal((await reconcileInventory(f.store, f.actor)).ok, true);
  assert.equal((await f.store.one('SELECT COUNT(*) AS n FROM inventory_movements WHERE action IN (\'LOAD\',\'DELIVER\',\'RETURN\',\'RELEASE\')'))?.n, 7);
  await assert.rejects(() => f.store.run('UPDATE inventory_movements SET reason=?', 'alterado'), /INVENTORY_LEDGER_APPEND_ONLY/);

  const restockCommand = (await f.store.one("SELECT command_id FROM return_dispositions WHERE return_id=?", returnedId))!.command_id;
  const releaseMovement = (await f.store.one("SELECT id FROM inventory_movements WHERE org_id=? AND parcel_id=? AND command_id=? AND action='RELEASE' AND from_status='QUARANTINE' AND to_status='AVAILABLE'", f.actor.orgId, returned, restockCommand))!;
  await f.store.run('DROP TRIGGER inventory_movements_no_update');
  await f.store.run("UPDATE inventory_movements SET to_location_id=? WHERE id=?", f.locationId, releaseMovement.id);
  const removedFromShelf = await f.store.run("UPDATE inventory_balances SET quantity=quantity-1 WHERE org_id=? AND client_id=? AND product_id=? AND location_id=? AND status='AVAILABLE' AND custody_id='' AND order_id='' AND quantity>0", f.actor.orgId, f.clientId, f.product.id, f.shelfId);
  assert.equal(Number(removedFromShelf.changes), 1);
  await f.store.run(`INSERT INTO inventory_balances(id,org_id,client_id,product_id,location_id,status,custody_id,order_id,quantity,updated_at)
    VALUES(?,?,?,?,?,'AVAILABLE','','',0,?) ON CONFLICT(org_id,client_id,product_id,location_id,status,custody_id,order_id) DO NOTHING`, randomUUID(), f.actor.orgId, f.clientId, f.product.id, f.locationId, new Date().toISOString());
  await f.store.run("UPDATE inventory_balances SET quantity=quantity+1 WHERE org_id=? AND client_id=? AND product_id=? AND location_id=? AND status='AVAILABLE' AND custody_id='' AND order_id=''", f.actor.orgId, f.clientId, f.product.id, f.locationId);
  const wrongLocation = await reconcileInventory(f.store, f.actor);
  assert.equal(wrongLocation.quantityIssues.length, 0);
  assert.equal(wrongLocation.returnIssues.some(issue => issue.return_id === returnedId), true);
  await f.store.run('UPDATE inventory_movements SET to_location_id=? WHERE id=?', f.shelfId, releaseMovement.id);
  await f.store.run("UPDATE inventory_balances SET quantity=quantity-1 WHERE org_id=? AND client_id=? AND product_id=? AND location_id=? AND status='AVAILABLE' AND custody_id='' AND order_id=''", f.actor.orgId, f.clientId, f.product.id, f.locationId);
  await f.store.run("UPDATE inventory_balances SET quantity=quantity+1 WHERE org_id=? AND client_id=? AND product_id=? AND location_id=? AND status='AVAILABLE' AND custody_id='' AND order_id=''", f.actor.orgId, f.clientId, f.product.id, f.shelfId);
  await f.store.run("CREATE TRIGGER inventory_movements_no_update BEFORE UPDATE ON inventory_movements BEGIN SELECT RAISE(ABORT,'INVENTORY_LEDGER_APPEND_ONLY'); END");
  assert.equal((await reconcileInventory(f.store, f.actor)).ok, true);
});

for (const tracking of ['QUANTITY', 'SERIAL'] as const) test(`carga ${tracking}: el código de modelo no consume el bulto o serie explícito del mismo lote`, async t => {
  const f = await fixture(t);
  const product = tracking === 'SERIAL' ? await f.makeProduct(f.clientId, 'MIXED-SERIAL', 'SERIAL') : f.product;
  await f.inventory.receive(f.actor, { ...f.command(), clientId: f.clientId, productId: product.id, locationId: f.locationId, quantity: 3,
    ...(tracking === 'SERIAL' ? { serials: [{ serial: 'EXACT-A', barcode: 'UNIT-A' }, { serial: 'EXACT-B', barcode: 'UNIT-B' }, { serial: 'EXACT-C', barcode: 'UNIT-C' }] } : {}) });
  const order = await f.inventory.createOrder(f.actor, orderBody(randomUUID(), f.clientId, product.id, 'ORDER-MIXED', 3));
  const reservation = await f.inventory.reserveOrder(f.actor, order.id, { ...f.command(), locationId: f.locationId });
  const explicit = reservation.parcels[2];
  // Force the old greedy query to choose the explicitly scanned unit first, every run.
  await f.store.run('UPDATE inventory_order_parcels SET created_at=? WHERE order_id=?', '2026-10-16T00:00:00.000Z', order.id);
  await f.store.run('UPDATE inventory_order_parcels SET created_at=? WHERE parcel_id=?', '2026-10-15T00:00:00.000Z', explicit.id);
  const driverId = (await f.domain.createDriver(f.actor, { ...f.command(), name: 'QA', username: 'driver-' + randomUUID(), password: 'QA-Mixed-load-2026!' })).id;
  const vehicleId = (await f.domain.createVehicle(f.actor, { ...f.command(), plate: 'MIXED-' + randomUUID(), capacityWeightGrams: 10000, capacityVolumeCm3: 10000, odometer: 0 })).id;
  const route = await f.domain.createRoute(f.actor, { ...f.command(), name: 'QA mixed scans', driverId, vehicleId, startAt: new Date(Date.now() - 60000).toISOString(), endAt: new Date(Date.now() + 3600000).toISOString() });
  await f.domain.assign(f.actor, route.id, { ...f.command(), expectedVersion: route.version, parcelIds: reservation.parcels.map((p: any) => p.id), pickup: false });

  const version = (await f.domain.route(route.id, f.actor)).version;
  await assert.rejects(f.inventory.loadOrder(f.actor, order.id, { ...f.command(), routeId: route.id, expectedVersion: version, codes: [explicit.code, explicit.code] }), code('NOT_FOUND'));
  assert.equal((await f.store.one("SELECT count(*) n FROM parcels WHERE shipment_id=? AND state='LOADED'", order.shipmentId))!.n, 0);
  const serial = tracking === 'SERIAL' ? (await f.store.one('SELECT u.serial FROM inventory_units u JOIN inventory_order_parcels op ON op.serial_id=u.id WHERE op.parcel_id=?', explicit.id))!.serial : explicit.code;
  const input = { ...f.command(), routeId: route.id, expectedVersion: version, codes: [product.barcode, product.barcode, serial] };
  const loaded = await f.inventory.loadOrder(f.actor, order.id, input);
  assert.equal(loaded.loaded, 3); assert.equal(loaded.parcels[2].id, explicit.id);
  assert.equal(new Set(loaded.parcels.map((p: any) => p.id)).size, 3);
  assert.deepEqual(await f.inventory.loadOrder(f.actor, order.id, input), loaded);
  assert.equal((await f.store.one("SELECT count(*) n FROM inventory_movements WHERE order_id=? AND action='LOAD'", order.id))!.n, 3);
  const locations=await f.inventory.locationStockPage({...f.actor,role:'CUSTOMER',clientId:f.clientId});
  assert.equal(locations.items.find(location=>location.id===f.locationId)?.quantity,0);
  assert.equal(locations.items.find(location=>location.id===f.locationId)?.vehicle,3);
});

test('portal identifica depósitos, suma cantidades y series y filtra stock/exportación sin cruzar clientes',async t=>{
  const f=await fixture(t),customer={...f.actor,role:'CUSTOMER',clientId:f.clientId};
  const north=(await f.inventory.createLocation(f.actor,{...f.command(),code:'NORTE',name:'Depósito Norte',kind:'DEPOT'})).id;
  const privateLocation=(await f.inventory.createLocation(f.actor,{...f.command(),code:'PRIVADO',name:'Depósito privado',kind:'DEPOT'})).id;
  const serial=await f.makeProduct(f.clientId,'SERIE-NORTE','SERIAL'),foreign=await f.makeProduct(f.secondClientId,'PRIVADO');
  await f.inventory.receive(f.actor,{...f.command(),clientId:f.clientId,productId:f.product.id,locationId:f.locationId,quantity:8});
  await f.inventory.receive(f.actor,{...f.command(),clientId:f.clientId,productId:f.product.id,locationId:north,quantity:6});
  await f.inventory.receive(f.actor,{...f.command(),clientId:f.clientId,productId:serial.id,locationId:north,quantity:2,serials:[{serial:'N-1'},{serial:'N-2'}]});
  await f.inventory.receive(f.actor,{...f.command(),clientId:f.secondClientId,productId:foreign.id,locationId:f.locationId,quantity:100});
  await f.inventory.receive(f.actor,{...f.command(),clientId:f.secondClientId,productId:foreign.id,locationId:privateLocation,quantity:20});
  await f.inventory.move(f.actor,{...f.command(),clientId:f.clientId,productId:f.product.id,fromLocationId:f.locationId,toLocationId:north,quantity:3,reason:'Traslado Norte'});
  const order=await f.inventory.createOrder(f.actor,orderBody(randomUUID(),f.clientId,f.product.id,'RESERVA-CENTRAL',2));
  await f.inventory.reserveOrder(f.actor,order.id,{...f.command(),locationId:f.locationId});
  const summary=await f.inventory.locationStockPage(customer,{clientId:f.secondClientId});
  assert.equal(summary.total,2);assert(!JSON.stringify(summary).includes('Depósito privado'));
  const central=summary.items.find(location=>location.id===f.locationId)!,northern=summary.items.find(location=>location.id===north)!;
  assert.equal(central.quantity,5);assert.equal(central.available,3);assert.equal(central.reserved,2);
  assert.equal(northern.quantity,11);assert.equal(northern.vehicle,0);
  const secondPage=await f.inventory.locationStockPage(customer,{limit:1,offset:1});
  assert.equal(secondPage.total,2);assert.equal(secondPage.items.length,1);
  const stock=await f.inventory.stockPage(customer,{locationId:north,q:'Depósito Norte',limit:1});
  assert.equal(stock.total,3);assert.equal(stock.items[0].locationName,'Depósito Norte');assert.equal(stock.items[0].locationId,north);
  assert.equal((await f.inventory.stockPage(customer,{locationId:privateLocation})).total,0);
  const csv=await f.inventory.exportCsv(customer,f.secondClientId,{locationId:north});
  assert(csv.includes('Depósito Norte'));assert(csv.includes('N-1'));assert(!csv.includes('Depósito QA'));assert(!csv.includes('PRIVADO'));
  const movements=await f.inventory.movementsPage(customer,{q:'Depósito Norte'});
  const transfer=movements.items.find(item=>item.action==='MOVE')!;
  assert.equal(transfer.fromLocationName,'Depósito QA');assert.equal(transfer.toLocationName,'Depósito Norte');
  assert.equal((await f.inventory.movementsPage(customer,{q:'Depósito privado'})).total,0);
  assert((await f.inventory.exportMovementsCsv(customer,{q:'Depósito Norte'})).includes('Depósito Norte'));
  await assert.rejects(()=>f.inventory.locationStockPage({...customer,clientId:null}),code('FORBIDDEN'));
  await assert.rejects(()=>f.inventory.locationStockPage({...customer,role:'DRIVER'}),code('FORBIDDEN'));
});

test('seriales son unitarios y el snapshot/export de cliente se filtra desde el actor autenticado', async (t) => {
  const f = await fixture(t), serialized = await f.makeProduct(f.clientId, 'SERIAL-001', 'SERIAL');
  const receive = { ...f.command(), clientId: f.clientId, productId: serialized.id, locationId: f.locationId, quantity: 2, serials: [{ serial: 'S-1', barcode: 'BAR-S-1' }, { serial: 'S-2', barcode: 'BAR-S-2' }] };
  const received = await f.inventory.receive(f.actor, receive);
  assert.deepEqual(await f.inventory.receive(f.actor, receive), received);
  const other = await f.makeProduct(f.secondClientId, 'PRIVATE-OTHER');
  const privateLocation = await f.inventory.createLocation(f.actor, { ...f.command(), code: 'PRIVATE-RACK', name: 'Ubicación privada', kind: 'STORAGE' });
  await f.inventory.receive(f.actor, { ...f.command(), clientId: f.secondClientId, productId: other.id, locationId: privateLocation.id, quantity: 1 });
  const ownOrder = await f.inventory.createOrder(f.actor, orderBody(randomUUID(), f.clientId, serialized.id, 'CUSTOMER-ORDER', 1));
  const foreignOrder = await f.inventory.createOrder(f.actor, orderBody(randomUUID(), f.secondClientId, other.id, 'PRIVATE-ORDER', 1));
  const customer: InventoryActor = { ...f.actor, role: 'CUSTOMER', clientId: f.clientId };
  const snapshot = await f.inventory.bootstrap(customer, f.secondClientId);
  assert(snapshot.products.some((product: any) => product.id === serialized.id));
  assert(!snapshot.products.some((product: any) => product.id === other.id));
  assert(!snapshot.locations.some((location: any) => location.id === privateLocation.id));
  assert(snapshot.locations.some((location: any) => location.id === f.locationId));
  assert(!snapshot.movements.some((movement: any) => movement.clientId === f.secondClientId));
  const visibleOrders = await f.inventory.orders(customer, f.secondClientId);
  assert.deepEqual(visibleOrders.items.map((order: any) => order.id), [ownOrder.id]);
  await assert.rejects(() => f.inventory.order(customer, foreignOrder.id), code('FORBIDDEN'));
  await assert.rejects(() => f.inventory.receive(customer, { ...f.command(), clientId: f.secondClientId, productId: other.id, locationId: f.locationId, quantity: 1 }), code('FORBIDDEN'));
  const app = express(); app.use(express.json());
  installInventoryRoutes(app, f.store, async () => customer);
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const failure = error as { status?: number; code?: string; message?: string };
    res.status(failure.status ?? 500).json({ code: failure.code, message: failure.message });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(async () => await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const response = await fetch(`${base}/api/inventory?clientId=${f.secondClientId}`);
  assert.equal(response.status, 200);
  const scoped = await response.json() as any;
  assert(!scoped.products.some((product: any) => product.id === other.id));
  const csv = await fetch(`${base}/api/inventory/export.csv?clientId=${f.secondClientId}`);
  assert.equal(csv.status, 200);
  assert(!await csv.text().then(text => text.includes('PRIVATE-OTHER')));
  const directCsv = await f.inventory.exportCsv(customer, f.secondClientId);
  assert(directCsv.includes('S-1'));
  assert(directCsv.includes('BAR-S-1'));
  assert.equal(directCsv.split('\r\n').filter(line => line.startsWith('"SERIAL"')).length, 2);
  const blocked = await fetch(`${base}/api/inventory/receipts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...f.command(), clientId: f.clientId, productId: serialized.id, locationId: f.locationId, quantity: 1, serials: [{ serial: 'S-X' }] }) });
  assert.equal(blocked.status, 403);
});

test('el snapshot anuncia sus límites y el CSV exporta todos los seriales sin truncar', async (t) => {
  const f = await fixture(t), serialized = await f.makeProduct(f.clientId, 'SERIAL-LARGE', 'SERIAL'), timestamp = new Date().toISOString();
  await f.store.run(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<1001)
    INSERT INTO inventory_units(id,org_id,client_id,product_id,serial,barcode,location_id,status,custody_id,order_id,parcel_id,created_at,updated_at)
    SELECT lower(hex(randomblob(16))),?,?,?,'SERIAL-'||n,'LARGE-'||n,?,'AVAILABLE','','',NULL,?,? FROM seq`,
  f.actor.orgId, f.clientId, serialized.id, f.locationId, timestamp, timestamp);
  const snapshot = await f.inventory.bootstrap(f.actor, f.clientId);
  assert.equal(snapshot.units.length, 1000);
  assert.equal(snapshot.counts.units, 1001);
  assert.equal(snapshot.totals.AVAILABLE, 1001);
  assert.equal(snapshot.clientTotals[f.clientId].AVAILABLE, 1001);
  assert.equal(snapshot.limits.units, 1000);
  assert.equal(snapshot.hasMore.units, true);
  const locations=await f.inventory.locationStockPage({...f.actor,role:'CUSTOMER',clientId:f.clientId});
  assert.equal(locations.items[0].quantity,1001);
  const csv = await f.inventory.exportCsv(f.actor, f.clientId);
  assert.equal(csv.split('\r\n').filter(line => line.startsWith('"SERIAL"')).length, 1001);
  assert(csv.includes('LARGE-1001'));
});

for (const tracking of ['QUANTITY', 'SERIAL'] as const) test(`sender handover removes ${tracking} inventory exactly once and reconciliation follows custody`, async t => {
  const f = await fixture(t), story = await inventoryReturnStory(f, tracking);
  const input = { ...f.command(), receiverName: 'QA sender', evidenceId: await story.upload('sender') };
  const sent = await f.domain.sendReturn(f.actor, story.returnId, input);
  assert.equal(sent.state, 'SENT_TO_SENDER');
  assert.deepEqual(await f.domain.sendReturn(f.actor, story.returnId, input), sent);
  const terminal = await f.store.one('SELECT disposition,command_id FROM return_dispositions WHERE return_id=?', story.returnId);
  assert.equal(terminal!.disposition, 'SENT_TO_SENDER'); assert.equal(terminal!.command_id, input.commandId);
  const parcel = await f.store.one('SELECT state,custody_type,custody_id FROM parcels WHERE id=?', story.parcelId);
  assert.equal(parcel!.state, 'RETURNED_TO_SENDER'); assert.equal(parcel!.custody_type, 'SENDER'); assert.equal(parcel!.custody_id, f.clientId);
  assert.equal((await f.store.one('SELECT state FROM inventory_order_parcels WHERE parcel_id=?', story.parcelId))!.state, 'RELEASED');
  assert.equal((await f.store.one("SELECT COUNT(*) AS n FROM inventory_movements WHERE parcel_id=? AND action='RETURN' AND from_status='QUARANTINE' AND to_status IS NULL AND command_id=?", story.parcelId, input.commandId))!.n, 1);
  if (tracking === 'QUANTITY') {
    assert.equal((await f.store.one("SELECT COALESCE(SUM(quantity),0) AS n FROM inventory_balances WHERE product_id=? AND status='QUARANTINE'", story.product.id))!.n, 0);
    assert.equal((await f.store.one("SELECT COALESCE(SUM(quantity),0) AS n FROM inventory_balances WHERE product_id=? AND status='AVAILABLE'", story.product.id))!.n, 0);
  } else {
    assert.equal((await f.store.one('SELECT status FROM inventory_units WHERE serial=?', story.serial!))!.status, 'ADJUSTED');
  }
  assert.equal((await reconcileInventory(f.store, f.actor)).ok, true);
  await f.store.run("UPDATE parcels SET custody_id='wrong-sender' WHERE id=?", story.parcelId);
  const custodyMismatch = await reconcileInventory(f.store, f.actor);
  assert.equal(custodyMismatch.ok, false);
  assert.equal(custodyMismatch.returnIssues[0].parcel_id, story.parcelId);
  await f.store.run("UPDATE parcels SET custody_id='' WHERE id=?", story.parcelId);
  assert.equal((await reconcileInventory(f.store, f.actor)).ok, false);
  await f.store.run('UPDATE parcels SET custody_id=? WHERE id=?', f.clientId, story.parcelId);
  assert.equal((await reconcileInventory(f.store, f.actor)).ok, true);
  await assert.rejects(() => f.inventory.release(f.actor, story.order.id, { ...f.command(), locationId: f.shelfId, parcelIds: [story.parcelId], reason: 'Already handed over' }), code('INVALID_TRANSITION'));
});

test('concurrent quarantine release and sender handover choose one terminal disposition', async t => {
  const f = await fixture(t), story = await inventoryReturnStory(f, 'QUANTITY');
  const releaseInput = { ...f.command(), locationId: f.shelfId, parcelIds: [story.parcelId], reason: 'QA disposition race' };
  const senderInput = { ...f.command(), receiverName: 'QA sender', evidenceId: await story.upload('race-sender') };
  const results = await Promise.allSettled([
    f.inventory.release(f.actor, story.order.id, releaseInput),
    f.domain.sendReturn(f.actor, story.returnId, senderInput),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
  assert.equal((rejected.reason as any).code, 'INVALID_TRANSITION');
  const disposition = await f.store.one('SELECT disposition,command_id FROM return_dispositions WHERE return_id=?', story.returnId);
  assert(disposition);
  if (disposition.disposition === 'RESTOCKED') {
    const completed = results[0].status === 'fulfilled' ? results[0].value : undefined;
    assert.deepEqual(completed, { id: story.order.id, released: 1 });
    assert.deepEqual(await f.inventory.release(f.actor, story.order.id, releaseInput), completed);
    assert.equal((await f.store.one("SELECT SUM(quantity) AS n FROM inventory_balances WHERE product_id=? AND status='AVAILABLE'", story.product.id))!.n, 1);
  } else {
    const completed = results[1].status === 'fulfilled' ? results[1].value : undefined;
    assert.deepEqual(completed, { id: story.returnId, state: 'SENT_TO_SENDER' });
    assert.deepEqual(await f.domain.sendReturn(f.actor, story.returnId, senderInput), completed);
    assert.equal((await f.store.one("SELECT COALESCE(SUM(quantity),0) AS n FROM inventory_balances WHERE product_id=? AND status='QUARANTINE'", story.product.id))!.n, 0);
  }
  assert.equal((await f.store.one("SELECT COUNT(*) AS n FROM inventory_movements WHERE parcel_id=? AND action IN('RETURN','RELEASE') AND from_status='QUARANTINE'", story.parcelId))!.n, 1);
  assert.equal((await f.store.one('SELECT COUNT(*) AS n FROM return_dispositions WHERE return_id=?', story.returnId))!.n, 1);
  assert.equal((await reconcileInventory(f.store, f.actor)).ok, true);
});
