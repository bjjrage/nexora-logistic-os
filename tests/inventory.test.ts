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
  const driverId = (await f.domain.createDriver(f.actor, { ...f.command(), name: 'Chofer QA', username: `driver-${randomUUID().slice(0, 8)}`, password: 'Password-QA-Driver-2026!' })).id;
  const vehicleId = (await f.domain.createVehicle(f.actor, { ...f.command(), plate: `QA-${randomUUID().slice(0, 6)}`, capacityWeightGrams: 5000, capacityVolumeCm3: 5000, odometer: 0 })).id;
  const route = await f.domain.createRoute(f.actor, { ...f.command(), name: 'Ruta de inventario QA', driverId, vehicleId, startAt: new Date(Date.now() - 60_000).toISOString(), endAt: new Date(Date.now() + 3_600_000).toISOString() });
  await f.domain.assign(f.actor, route.id, { ...f.command(), expectedVersion: route.version, parcelIds: reservation.parcels.map((parcel: any) => parcel.id), pickup: false });
  const version = (await f.store.one('SELECT version FROM routes WHERE id=?', route.id))!.version;
  await f.domain.ready(f.actor, route.id, { ...f.command(), expectedVersion: version });
  const readyVersion = (await f.store.one('SELECT version FROM routes WHERE id=?', route.id))!.version;
  const loaded = await f.inventory.loadOrder(f.actor, order.id, { ...f.command(), routeId: route.id, expectedVersion: readyVersion, codes: [f.product.barcode, f.product.barcode, reservation.parcels[2].code] });
  assert.equal(loaded.loaded, 3);
  assert.equal(loaded.status, 'LOADED');
  assert.equal((await f.store.one("SELECT SUM(quantity) AS n FROM inventory_balances WHERE product_id=? AND status='VEHICLE' AND custody_id=?", f.product.id, vehicleId))?.n, 3);
  const packages = await f.store.all('SELECT parcel_id FROM inventory_order_parcels WHERE order_id=? ORDER BY parcel_id', order.id);
  await assert.rejects(() => f.inventory.syncParcelTransition(f.actor, packages[0].parcel_id, 'IN_TRANSIT', 'DELIVERED', 'RECIPIENT', 'Receptor QA', randomUUID()), code('EVIDENCE_REQUIRED'));
  await f.domain.inspect(f.actor, vehicleId, { ...f.command(), odometer: 0, fuelPercent: 90, items: [{ severity: 'OK', label: 'Inspección QA', note: '' }] });
  let currentVersion = (await f.store.one('SELECT version FROM routes WHERE id=?', route.id))!.version;
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
  const returned = (await f.store.one("SELECT parcel_id FROM inventory_order_parcels WHERE order_id=? AND state='QUARANTINE'", order.id))!.parcel_id;
  const released = await f.inventory.release(f.actor, order.id, { ...f.command(), locationId: f.shelfId, parcelIds: [returned], reason: 'Inspección QA aprobada' });
  assert.equal(released.released, 1);
  assert.equal((await f.store.one("SELECT SUM(quantity) AS n FROM inventory_balances WHERE product_id=? AND status='AVAILABLE'", f.product.id))?.n, 1);
  assert.equal((await f.store.one('SELECT COUNT(*) AS n FROM inventory_movements WHERE action IN (\'LOAD\',\'DELIVER\',\'RETURN\',\'RELEASE\')'))?.n, 7);
  await assert.rejects(() => f.store.run('UPDATE inventory_movements SET reason=?', 'alterado'), /INVENTORY_LEDGER_APPEND_ONLY/);
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
  await f.domain.ready(f.actor, route.id, { ...f.command(), expectedVersion: (await f.domain.route(route.id, f.actor)).version });
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
  const csv = await f.inventory.exportCsv(f.actor, f.clientId);
  assert.equal(csv.split('\r\n').filter(line => line.startsWith('"SERIAL"')).length, 1001);
  assert(csv.includes('LARGE-1001'));
});
