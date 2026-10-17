import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../server/db.ts';
import { setup, type Actor } from '../server/auth.ts';
import { Logistics } from '../server/domain.ts';
import { TraccarTracking, validateRouteProvider } from '../server/traccar.ts';
import { createApp } from '../server/app.ts';
import { configureDelivery } from './support/delivery-policy.ts';

const command = () => ({ commandId: randomUUID() });
async function fixture(store: Store) {
  const username = 'qa-' + randomUUID(), password = 'QA-stable-circuit-2026!';
  const ids = await setup(store, { organizationName: 'QA stable identity', timezone: 'UTC', username, password });
  const actor: Actor = { id: ids.userId, orgId: ids.orgId, name: 'QA', role: 'ADMIN', driverId: null };
  return { actor, username, password, domain: new Logistics(store), tracking: new TraccarTracking(store, {}) };
}

test('circuito protegido conserva ID al renombrar; homónimo y otra empresa no lo heredan', async t => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const f = await fixture(store), original = (await f.domain.createClient(f.actor, { ...command(), name: 'Universo' })).id;
  await configureDelivery(store, f.actor, original);
  // Administrative provisioning, unavailable to the runtime PostgreSQL role.
  await store.run('INSERT INTO client_delivery_locks VALUES(?,?,?)', f.actor.orgId, original, 'QUADMINDS');
  await f.domain.updateClient(f.actor, original, { ...command(), name: 'Universo S.A.' });
  await assert.rejects(f.tracking.clientPolicy(f.actor, original, { ...command(), deliveryProvider: 'NEXORA' }), { code: 'INVALID_TRANSITION' });
  await assert.rejects(store.run("UPDATE client_delivery_policies SET delivery_provider='NEXORA' WHERE client_id=?", original), /FOREIGN KEY/);
  const homonym = (await f.domain.createClient(f.actor, { ...command(), name: 'Universo' })).id;
  await configureDelivery(store, f.actor, homonym, 'NEXORA');
  await assert.rejects(f.tracking.clientPolicy({ ...f.actor, orgId: randomUUID() }, original, { ...command(), deliveryProvider: 'NEXORA' }), { code: 'NOT_FOUND' });
  const settings = await f.tracking.settings(f.actor);
  assert.deepEqual(settings.lockedPolicies.map(policy => ({ ...policy })), [{ clientId: original, deliveryProvider: 'QUADMINDS' }]);
  assert.equal(settings.policies.find(p => p.clientId === homonym)?.deliveryProvider, 'NEXORA');
});

test('nombre Universo no suple una política ausente; los circuitos mezclados siguen bloqueados', async t => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const f = await fixture(store), clientId = (await f.domain.createClient(f.actor, { ...command(), name: 'Universo' })).id;
  const driverId = (await f.domain.createDriver(f.actor, { ...command(), name: 'QA driver', username: 'driver-' + randomUUID(), password: f.password })).id;
  const vehicleId = (await f.domain.createVehicle(f.actor, { ...command(), plate: 'QA-1', capacityWeightGrams: 1000, capacityVolumeCm3: 1000, odometer: 0 })).id;
  const routeId = (await f.domain.createRoute(f.actor, { ...command(), name: 'QA route', driverId, vehicleId, startAt: new Date().toISOString(), endAt: new Date(Date.now() + 3600000).toISOString() })).id;
  const shipment = await f.domain.createShipment(f.actor, { ...command(), clientId, reference: 'QA', originText: 'QA', destinationText: 'QA', recipientName: 'QA', recipientPhone: '', parcelCount: 1, weightGrams: 1, volumeCm3: 1, proofPolicy: 'RECEIVER' });
  const parcel = (await store.one('SELECT * FROM parcels WHERE shipment_id=?', shipment.id))!;
  await f.domain.receive(f.actor, { ...command(), shipmentId: shipment.id, codes: [parcel.code], location: 'QA' });
  await f.domain.assign(f.actor, routeId, { ...command(), parcelIds: [parcel.id], pickup: false, expectedVersion: 1 });
  const version = (await f.domain.route(routeId, f.actor)).version;
  await assert.rejects(f.domain.ready(f.actor, routeId, { ...command(), expectedVersion: version }), { code: 'INVALID_TRANSITION' });
  assert.equal((await f.domain.route(routeId, f.actor)).version, version);
  await configureDelivery(store, f.actor, clientId, 'NEXORA');
  await assert.rejects(validateRouteProvider(store, f.actor.orgId, routeId), { code: 'INVALID_TRANSITION' });
  await f.tracking.routePolicy(f.actor, routeId, { ...command(), provider: 'TRACCAR' });
  await validateRouteProvider(store, f.actor.orgId, routeId);
});

function legacyVersion(store: Store) {
  store.db.exec('DROP TABLE client_delivery_locks; DROP INDEX client_delivery_policy_identity; DELETE FROM schema_migrations WHERE version=10;');
}
test('migración de Universo legacy fija política e identidad una vez y persiste tras reinicio', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'nexora-provider-migration-')), path = join(directory, 'legacy.sqlite');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let store = new Store(path); const f = await fixture(store);
  const clientId = (await f.domain.createClient(f.actor, { ...command(), name: 'Universo' })).id;
  legacyVersion(store); await store.close();
  store = new Store(path);
  assert.equal((await store.one('SELECT delivery_provider FROM client_delivery_locks WHERE client_id=?', clientId))!.delivery_provider, 'QUADMINDS');
  await store.run('UPDATE clients SET name=? WHERE id=?', 'Universo S.A.', clientId); await store.close();
  store = new Store(path);
  try {
    assert.equal((await store.one('SELECT delivery_provider FROM client_delivery_policies WHERE client_id=?', clientId))!.delivery_provider, 'QUADMINDS');
    const other = (await new Logistics(store).createClient(f.actor, { ...command(), name: 'Universo' })).id;
    assert.equal(await store.one('SELECT client_id FROM client_delivery_locks WHERE client_id=?', other), undefined);
  } finally { await store.close(); }
});

test('migración rechaza identidad ambigua y revierte el backfill completo', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'nexora-provider-ambiguous-')), path = join(directory, 'legacy.sqlite');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new Store(path), f = await fixture(store);
  for (let i = 0; i < 2; i++) await f.domain.createClient(f.actor, { ...command(), name: 'Universo' });
  legacyVersion(store); await store.close();
  assert.throws(() => new Store(path), /CHECK constraint/);
  const raw = new DatabaseSync(path);
  try {
    assert.equal(raw.prepare('SELECT count(*) n FROM client_delivery_policies').get()!.n, 0);
    assert.equal(raw.prepare('SELECT count(*) n FROM schema_migrations WHERE version=10').get()!.n, 0);
  } finally { raw.close(); }
});

test('ingreso GPS stub retirado responde 404 a sesión válida y no acepta posiciones', async t => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const f = await fixture(store), server = createApp(store).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'logistics-os' }, body: JSON.stringify({ username: f.username, password: f.password }) });
  assert.equal(login.status, 200);
  const response = await fetch(base + '/api/tracking/sessions/unsupported/points', { method: 'POST', headers: { Cookie: login.headers.get('set-cookie')!.split(';')[0], 'Content-Type': 'application/json', 'X-Requested-With': 'logistics-os' }, body: JSON.stringify({ latitude: -25, longitude: -57 }) });
  assert.equal(response.status, 404); assert.equal((await response.json()).error.code, 'NOT_FOUND');
  assert.equal((await store.one('SELECT count(*) n FROM traccar_latest'))!.n, 0);
});
