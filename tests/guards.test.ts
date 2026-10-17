import { configureDelivery } from './support/delivery-policy.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/db.ts';
import { Logistics } from '../server/domain.ts';
import { setup, type Actor } from '../server/auth.ts';
import { createApp } from '../server/app.ts';
async function fixture(t: any) {
    const directory = mkdtempSync(join(tmpdir(), 'logistics-guards-'));
    const store = new Store(join(directory, 'test.sqlite'));
    t.after(async () => { await store.close(); rmSync(directory, { recursive: true, force: true }); });
    const credentials = { organizationName: 'Organización QA', timezone: 'UTC', username: 'admin-qa', password: 'Password-QA-2026!' };
    const { userId, orgId } = await setup(store, credentials);
    const actor: Actor = { id: userId, orgId, name: 'Admin QA', role: 'ADMIN', driverId: null };
    const d = new Logistics(store), cmd = () => ({ commandId: randomUUID() });
    const client = (await d.createClient(actor, { ...cmd(), name: 'Cliente ficticio' })).id;
    await configureDelivery(store, actor, client);
    const driver = (await d.createDriver(actor, { ...cmd(), name: 'Chofer QA', username: 'driver-qa', password: 'Password-QA-driver!' })).id;
    const vehicle = (await d.createVehicle(actor, { ...cmd(), plate: 'QA-001', capacityWeightGrams: 10000, capacityVolumeCm3: 10000, odometer: 100 })).id;
    const shipment = async (count = 1, weight: number | null = 1000, volume: number | null = 1000) => {
        const id = (await d.createShipment(actor, { ...cmd(), clientId: client, reference: randomUUID(), originText: 'Origen ficticio', destinationText: 'Destino ficticio', recipientName: 'Receptor QA', recipientPhone: '', parcelCount: count, weightGrams: weight, volumeCm3: volume, proofPolicy: 'RECEIVER' })).id;
        return { id, parcels: await store.all('SELECT * FROM parcels WHERE shipment_id=?', id) };
    };
    const route = async () => (await d.createRoute(actor, { ...cmd(), name: 'Ruta QA', driverId: driver, vehicleId: vehicle, startAt: new Date(Date.now() - 60000).toISOString(), endAt: new Date(Date.now() + 3600000).toISOString() })).id;
    const receive = async (s: Awaited<Awaited<ReturnType<typeof shipment>>>) => await d.receive(actor, { ...cmd(), shipmentId: s.id, codes: s.parcels.map(p => p.code), location: 'Depósito QA' });
    const version = async (id: string) => (await store.one('SELECT version FROM routes WHERE id=?', id))!.version;
    const assign = async (id: string, ids: string[], pickup = false) => await d.assign(actor, id, { ...cmd(), parcelIds: ids, pickup, expectedVersion: await version(id) });
    const ready = async (id: string) => await d.ready(actor, id, { ...cmd(), expectedVersion: await version(id) });
    const inspect = async (severity = 'OK') => await d.inspect(actor, vehicle, { ...cmd(), odometer: 100, fuelPercent: 70, items: [{ label: 'Frenos', severity, note: severity === 'OK' ? 'Correcto' : 'Defecto QA' }] });
    const loaded = async () => {
        const s = await shipment(), r = await route();
        await receive(s);
        await assign(r, s.parcels.map(p => p.id));
        await ready(r);
        await inspect();
        await d.load(actor, r, { ...cmd(), code: s.parcels[0].code, expectedVersion: await version(r) });
        return { s, r };
    };
    const rejects = async (fn: () => unknown, code: string) => await assert.rejects(async () => await fn(), (e: any) => e.code === code);
    return { store, d, actor, cmd, client, driver, vehicle, shipment, route, receive, version, assign, ready, inspect, loaded, rejects, credentials };
}
test('QA-03: escaneo ajeno no altera manifiesto ni custodia', async (t) => {
    const f = await fixture(t), a = await f.shipment(), b = await f.shipment(), r = await f.route();
    await f.receive(a);
    await f.receive(b);
    await f.assign(r, a.parcels.map(p => p.id));
    await f.ready(r);
    const before = await f.store.all('SELECT * FROM custody_events');
    await f.rejects(async () => await f.d.load(f.actor, r, { ...f.cmd(), code: b.parcels[0].code, expectedVersion: await f.version(r) }), 'NOT_FOUND');
    assert.deepEqual(await f.store.all('SELECT * FROM custody_events'), before);
    assert.equal((await f.store.one('SELECT state FROM parcels WHERE id=?', b.parcels[0].id))!.state, 'RECEIVED');
});
test('QA-04: solicitudes HTTP concurrentes reservan una sola asignación', async (t) => {
    const f = await fixture(t), s = await f.shipment(), r1 = await f.route(), r2 = await f.route();
    await f.receive(s);
    const server = createApp(f.store).listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
    const address = server.address() as {
        port: number;
    };
    const base = `http://127.0.0.1:${address.port}`;
    const usernames = ['dispatcher-one', 'dispatcher-two'];
    for (const username of usernames)
        await f.d.createUser(f.actor, { ...f.cmd(), name: username, username, password: f.credentials.password, role: 'OPERATIONS' });
    const cookies = await Promise.all(usernames.map(async (username) => { const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'logistics-os' }, body: JSON.stringify({ username, password: f.credentials.password }) }); assert.equal(login.status, 200); return login.headers.get('set-cookie')!.split(';')[0]; }));
    const replies = await Promise.all([r1, r2].map((id, i) => fetch(`${base}/api/routes/${id}/assignments`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'logistics-os', Cookie: cookies[i] }, body: JSON.stringify({ ...f.cmd(), parcelIds: [s.parcels[0].id], expectedVersion: 1 }) })));
    assert.deepEqual(replies.map(r => r.status).sort(), [200, 409]);
    assert.equal((await f.store.one('SELECT count(*) n FROM route_assignments WHERE parcel_id=? AND active=1', s.parcels[0].id))!.n, 1);
});
test('QA-05: base rechaza rutas confirmadas incompatibles para chofer o vehículo', async (t) => {
    const f = await fixture(t), s1 = await f.shipment(), s2 = await f.shipment(), r1 = await f.route(), r2 = await f.route();
    await f.receive(s1);
    await f.receive(s2);
    await f.assign(r1, s1.parcels.map(p => p.id));
    await f.assign(r2, s2.parcels.map(p => p.id));
    await f.ready(r1);
    await f.rejects(async () => await f.ready(r2), 'VERSION_CONFLICT');
    assert.equal((await f.store.one('SELECT state FROM routes WHERE id=?', r2))!.state, 'DRAFT');
    await assert.rejects(async () => await f.store.run("UPDATE routes SET state='READY' WHERE id=?", r2), /ROUTE_RESOURCE_CONFLICT/);
});
test('QA-06: capacidad intermedia se verifica después de sumar retiros', async (t) => {
    const f = await fixture(t), a = await f.shipment(1, 4000, 4000), b = await f.shipment(1, 7000, 7000), r = await f.route();
    await f.receive(a);
    await f.assign(r, a.parcels.map(p => p.id));
    await f.assign(r, b.parcels.map(p => p.id), true);
    const stops = await f.store.all('SELECT * FROM stops WHERE route_id=?', r);
    const pickup = stops.find(s => s.kind === 'PICKUP')!;
    const before = await f.store.all('SELECT id,sequence FROM stops WHERE route_id=? ORDER BY sequence', r);
    await f.rejects(async () => await f.d.reorder(f.actor, r, { ...f.cmd(), expectedVersion: await f.version(r), stopIds: [pickup.id, ...stops.filter(s => s.id !== pickup.id).sort((a, b) => a.sequence - b.sequence).map(s => s.id)] }), 'CAPACITY_EXCEEDED');
    assert.deepEqual(await f.store.all('SELECT id,sequence FROM stops WHERE route_id=? ORDER BY sequence', r), before);
});
test('QA-07: peso desconocido conserva null y bloquea aprobación de capacidad', async (t) => {
    const f = await fixture(t), s = await f.shipment(1, null, 1000), r = await f.route();
    await f.receive(s);
    await f.assign(r, s.parcels.map(p => p.id));
    await f.rejects(async () => await f.ready(r), 'VALIDATION_ERROR');
    assert.equal((await f.store.one('SELECT weight_grams FROM parcels WHERE id=?', s.parcels[0].id))!.weight_grams, null);
});
test('QA-08: defecto crítico y documento vencido impiden despacho; odómetro no retrocede', async (t) => {
    const f = await fixture(t), { r } = await f.loaded();
    await f.inspect('CRITICAL');
    await f.rejects(async () => await f.d.dispatch(f.actor, r, { ...f.cmd(), expectedVersion: await f.version(r) }), 'INVALID_TRANSITION');
    assert.equal((await f.store.one('SELECT state FROM routes WHERE id=?', r))!.state, 'READY');
    await f.rejects(async () => await f.d.inspect(f.actor, f.vehicle, { ...f.cmd(), odometer: 99, fuelPercent: 10, items: [{ label: 'Motor', severity: 'OK', note: '' }] }), 'VALIDATION_ERROR');
});
test('QA-08: documentación configurada impeditiva vencida bloquea salida', async (t) => {
    const f = await fixture(t), { r } = await f.loaded();
    await f.d.document(f.actor, f.vehicle, { ...f.cmd(), name: 'Documento QA (no requisito legal)', expiresAt: new Date(Date.now() - 1000).toISOString(), blocksDispatch: true });
    await f.rejects(async () => await f.d.dispatch(f.actor, r, { ...f.cmd(), expectedVersion: await f.version(r) }), 'INVALID_TRANSITION');
});
test('QA-12: clave con otro cuerpo produce conflicto sin doble efecto', async (t) => {
    const f = await fixture(t), s = await f.shipment();
    const cmd = f.cmd();
    const body = { ...cmd, shipmentId: s.id, codes: s.parcels.map(p => p.code), location: 'QA' };
    await f.d.receive(f.actor, body);
    assert.deepEqual(await f.d.receive(f.actor, body), await f.d.receive(f.actor, body));
    await f.rejects(async () => await f.d.receive(f.actor, { ...body, location: 'Otro depósito' }), 'DUPLICATE_COMMAND');
    assert.equal((await f.store.one('SELECT count(*) n FROM receipt_items'))!.n, 1);
});
test('QA-16: chofer no consulta ni modifica rutas ajenas; bootstrap limitado', async (t) => {
    const f = await fixture(t), s = await f.shipment(), r = await f.route();
    await f.receive(s);
    await f.assign(r, s.parcels.map(p => p.id));
    const otherDriver = (await f.d.createDriver(f.actor, { ...f.cmd(), name: 'Otro chofer', username: 'other-driver', password: 'Password-QA-other!' })).id;
    const u = (await f.store.one('SELECT * FROM users WHERE driver_id=?', otherDriver))!;
    const actor: Actor = { id: u.id, orgId: u.org_id, role: 'DRIVER', name: u.name, driverId: otherDriver };
    await f.rejects(async () => await f.d.route(r, actor), 'FORBIDDEN');
    await f.rejects(async () => await f.d.closeRoute(actor, r, { ...f.cmd(), expectedVersion: await f.version(r) }), 'FORBIDDEN');
    const data = await f.d.bootstrap(actor);
    assert.equal(data.routes.length, 0);
    assert.equal(data.parcels.length, 0);
    assert.equal(data.clients.length, 0);
});
test('Aislamiento de organización y claves foráneas compuestas', async (t) => {
    const f = await fixture(t), s = await f.shipment(), org = randomUUID(), user = randomUUID();
    await f.store.run('INSERT INTO organizations VALUES(?,?,?)', org, 'Otro operador QA', 'UTC');
    await f.store.run('INSERT INTO users VALUES(?,?,?,?,?,?,NULL)', user, org, 'other-admin', 'Other', 'hash', 'ADMIN');
    const other: Actor = { id: user, orgId: org, role: 'ADMIN', name: 'Other', driverId: null };
    await f.rejects(async () => await f.d.parcel(s.parcels[0].id, other), 'NOT_FOUND');
    assert.equal((await f.d.bootstrap(other)).shipments.length, 0);
    await assert.rejects(async () => await f.store.run('INSERT INTO shipments VALUES(?,?,?,?,?,?,?,?,?,?)', randomUUID(), org, f.client, 'REF', 'O', 'D', 'R', '', 'RECEIVER', new Date().toISOString()), /FOREIGN KEY/);
});
test('QA-24: cierre con paradas pendientes no modifica ruta ni elimina obligaciones', async (t) => {
    const f = await fixture(t), { r } = await f.loaded();
    await f.d.dispatch(f.actor, r, { ...f.cmd(), expectedVersion: await f.version(r) });
    await f.rejects(async () => await f.d.closeRoute(f.actor, r, { ...f.cmd(), expectedVersion: await f.version(r) }), 'INVALID_TRANSITION');
    assert.equal((await f.store.one('SELECT state FROM routes WHERE id=?', r))!.state, 'IN_PROGRESS');
    assert.equal((await f.store.one('SELECT count(*) n FROM stops WHERE route_id=?', r))!.n, 1);
});
test('Retiro directo registra custodia sin recepción ficticia en depósito', async (t) => {
    const f = await fixture(t), s = await f.shipment(), r = await f.route();
    await f.assign(r, s.parcels.map(p => p.id), true);
    await f.ready(r);
    await f.inspect();
    await f.d.dispatch(f.actor, r, { ...f.cmd(), expectedVersion: await f.version(r) });
    const pickup = (await f.store.one("SELECT * FROM stops WHERE route_id=? AND kind='PICKUP'", r))!;
    await f.d.pickup(f.actor, pickup.id, { ...f.cmd(), codes: s.parcels.map(p => p.code), expectedVersion: await f.version(r) });
    assert.equal((await f.store.one('SELECT state FROM parcels WHERE id=?', s.parcels[0].id))!.state, 'IN_TRANSIT');
    assert.equal((await f.store.one('SELECT count(*) n FROM receipts'))!.n, 0);
    assert.equal((await f.store.one("SELECT count(*) n FROM custody_events WHERE action='DIRECT_PICKUP'"))!.n, 1);
});
test('Mantenimiento vencido y falta de checklist impiden despacho', async (t) => {
    const f = await fixture(t), s = await f.shipment(), r = await f.route();
    await f.receive(s);
    await f.assign(r, s.parcels.map(p => p.id));
    await f.ready(r);
    await f.d.load(f.actor, r, { ...f.cmd(), code: s.parcels[0].code, expectedVersion: await f.version(r) });
    await f.rejects(async () => await f.d.dispatch(f.actor, r, { ...f.cmd(), expectedVersion: await f.version(r) }), 'INVALID_TRANSITION');
    await f.inspect();
    await f.d.maintenance(f.actor, f.vehicle, { ...f.cmd(), description: 'Servicio QA', dueAt: null, dueOdometer: 100 });
    await f.rejects(async () => await f.d.dispatch(f.actor, r, { ...f.cmd(), expectedVersion: await f.version(r) }), 'INVALID_TRANSITION');
});
test('Carga real incluye una entrega fallida antes de aceptar un retiro', async (t) => {
    const f = await fixture(t), a = await f.shipment(1, 4000, 4000), b = await f.shipment(1, 7000, 7000), r = await f.route();
    await f.receive(a);
    await f.assign(r, a.parcels.map(p => p.id));
    await f.assign(r, b.parcels.map(p => p.id), true);
    await f.ready(r);
    await f.inspect();
    await f.d.load(f.actor, r, { ...f.cmd(), code: a.parcels[0].code, expectedVersion: await f.version(r) });
    await f.d.dispatch(f.actor, r, { ...f.cmd(), expectedVersion: await f.version(r) });
    const delivery = (await f.store.one("SELECT id FROM stops WHERE route_id=? AND shipment_id=? AND kind='DELIVERY'", r, a.id))!.id;
    await f.d.attempt(f.actor, delivery, { ...f.cmd(), expectedVersion: await f.version(r), deliveredParcelIds: [], failedParcelIds: [a.parcels[0].id], receiverName: '', evidenceIds: [], reasonCode: 'REFUSED', nextAction: 'Retornar a depósito' });
    const pickup = (await f.store.one("SELECT id FROM stops WHERE route_id=? AND kind='PICKUP'", r))!.id;
    await f.rejects(async () => await f.d.pickup(f.actor, pickup, { ...f.cmd(), expectedVersion: await f.version(r), codes: [b.parcels[0].code] }), 'CAPACITY_EXCEEDED');
    assert.equal((await f.store.one('SELECT state FROM parcels WHERE id=?', b.parcels[0].id))!.state, 'EXPECTED');
});
test('Un fallo parcial conserva PARTIAL mientras otros bultos no tengan intento', async (t) => {
    const f = await fixture(t), s = await f.shipment(2), r = await f.route();
    await f.receive(s);
    await f.assign(r, s.parcels.map(p => p.id));
    await f.ready(r);
    await f.inspect();
    for (const p of s.parcels)
        await f.d.load(f.actor, r, { ...f.cmd(), code: p.code, expectedVersion: await f.version(r) });
    await f.d.dispatch(f.actor, r, { ...f.cmd(), expectedVersion: await f.version(r) });
    const stop = (await f.store.one('SELECT id FROM stops WHERE route_id=?', r))!.id;
    await f.d.attempt(f.actor, stop, { ...f.cmd(), expectedVersion: await f.version(r), deliveredParcelIds: [], failedParcelIds: [s.parcels[0].id], receiverName: '', evidenceIds: [], reasonCode: 'ABSENT', nextAction: 'Reintentar' });
    assert.equal((await f.store.one('SELECT state FROM stops WHERE id=?', stop))!.state, 'PARTIAL');
    assert.equal((await f.store.one('SELECT state FROM parcels WHERE id=?', s.parcels[1].id))!.state, 'IN_TRANSIT');
});
test('HTTP rechaza CSRF, acceso anónimo y rol depósito fuera de alcance; sesión revocada', async (t) => {
    const f = await fixture(t);
    await f.d.createUser(f.actor, { ...f.cmd(), name: 'Depósito QA', username: 'depot-qa', password: f.credentials.password, role: 'DEPOT' });
    const server = createApp(f.store).listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
    const base = `http://127.0.0.1:${(server.address() as {
        port: number;
    }).port}`, headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'logistics-os' };
    assert.equal((await fetch(base + '/api/bootstrap')).status, 401);
    const login = await fetch(base + '/api/login', { method: 'POST', headers, body: JSON.stringify({ username: 'depot-qa', password: f.credentials.password }) });
    assert.equal(login.status, 200);
    assert.match(login.headers.get('set-cookie')!, /HttpOnly/);
    assert.match(login.headers.get('set-cookie')!, /SameSite=Strict/);
    const cookie = login.headers.get('set-cookie')!.split(';')[0], body = JSON.stringify({ ...f.cmd(), name: 'No autorizado' });
    assert.equal((await fetch(base + '/api/clients', { method: 'POST', headers: { ...headers, Cookie: cookie, Origin: 'https://untrusted.example' }, body })).status, 403);
    assert.equal((await fetch(base + '/api/clients', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body })).status, 403);
    assert.equal((await fetch(base + '/api/clients', { method: 'POST', headers: { ...headers, Cookie: cookie }, body })).status, 403);
    const data = await (await fetch(base + '/api/bootstrap', { headers: { Cookie: cookie } })).text();
    assert.ok(!data.includes('passwordHash'));
    assert.ok(!data.includes('password_hash'));
    assert.ok(!data.includes('token_hash'));
    assert.equal((await fetch(base + '/api/logout', { method: 'POST', headers: { ...headers, Cookie: cookie }, body: '{}' })).status, 200);
    assert.equal((await fetch(base + '/api/bootstrap', { headers: { Cookie: cookie } })).status, 401);
});
