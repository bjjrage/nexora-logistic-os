import { configureDelivery } from './support/delivery-policy.ts';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { test } from 'node:test';
import { Store } from '../server/db.ts';
import { Logistics } from '../server/domain.ts';
import { setup, passwordHash, type Actor } from '../server/auth.ts';
import { createApp } from '../server/app.ts';
type Json = Record<string, any>;
type Reply = {
    status: number;
    body: Json;
};
const password = 'Password-QA-acceptance-2026!';
async function fileFixture(t: any) {
    const directory = mkdtempSync(join(tmpdir(), 'nexora-acceptance-v2-'));
    const store = new Store(join(directory, 'acceptance.sqlite'));
    t.after(async () => {
        await store.close();
        rmSync(directory, { recursive: true, force: true });
    });
    const credentials = { organizationName: 'Organización QA v2', timezone: 'UTC', username: 'admin-v2', password };
    const { userId, orgId } = await setup(store, credentials);
    const actor: Actor = { id: userId, orgId, name: 'Admin QA v2', role: 'ADMIN', driverId: null };
    const domain = new Logistics(store);
    const command = () => ({ commandId: randomUUID() });
    const clientId = (await domain.createClient(actor, { ...await command(), name: 'Cliente QA v2' })).id;
    await configureDelivery(store, actor, clientId);
    const driverId = (await domain.createDriver(actor, { ...await command(), name: 'Chofer QA v2', username: 'driver-v2', password })).id;
    const vehicleId = (await domain.createVehicle(actor, { ...await command(), plate: 'QA-V2-001', capacityWeightGrams: 50000, capacityVolumeCm3: 50000, odometer: 100 })).id;
    const shipment = async (options: {
        clientId?: string;
        volumeCm3?: number | null;
        parcelCount?: number;
    } = {}) => {
        const id = (await domain.createShipment(actor, {
            ...await command(), clientId: options.clientId ?? clientId, reference: randomUUID(), originText: 'Origen QA',
            destinationText: 'Destino QA', recipientName: 'Receptor QA', recipientPhone: '',
            parcelCount: options.parcelCount ?? 1, weightGrams: 1000, volumeCm3: options.volumeCm3 === undefined ? 1000 : options.volumeCm3,
            proofPolicy: 'RECEIVER',
        })).id;
        return { id, parcels: await store.all('SELECT * FROM parcels WHERE shipment_id=? ORDER BY rowid', id) };
    };
    const route = async (name = 'Ruta QA v2') => (await domain.createRoute(actor, {
        ...await command(), name, driverId, vehicleId,
        startAt: new Date(Date.now() - 60000).toISOString(), endAt: new Date(Date.now() + 3600000).toISOString(),
    })).id;
    const receive = async (item: Awaited<Awaited<ReturnType<typeof shipment>>>) => await domain.receive(actor, {
        ...await command(), shipmentId: item.id, codes: item.parcels.map(parcel => parcel.code), location: 'Depósito QA',
    });
    const version = async (id: string) => (await store.one('SELECT version FROM routes WHERE id=?', id))!.version as number;
    const assign = async (routeId: string, parcelIds: string[]) => await domain.assign(actor, routeId, { ...await command(), parcelIds, pickup: false, expectedVersion: await version(routeId) });
    return { directory, store, actor, domain, command, clientId, driverId, vehicleId, shipment, route, receive, version, assign, credentials };
}
async function startHttp(t: any, f: Awaited<Awaited<ReturnType<typeof fileFixture>>>) {
    const server: Server = createApp(f.store).listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    const address = server.address();
    assert(address && typeof address !== 'string');
    t.after(async () => {
        if (server.listening)
            await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    });
    return `http://127.0.0.1:${address.port}`;
}
async function request(base: string, path: string, options: {
    method?: string;
    cookie?: string;
    body?: Json;
} = {}): Promise<Reply> {
    const headers: Record<string, string> = { 'X-Requested-With': 'logistics-os' };
    if (options.cookie)
        headers.Cookie = options.cookie;
    if (options.body)
        headers['Content-Type'] = 'application/json';
    const response = await fetch(`${base}${path}`, {
        method: options.method ?? 'GET', headers,
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    const text = await response.text();
    let body: Json = {};
    try {
        body = text ? JSON.parse(text) as Json : {};
    }
    catch {
        body = { raw: text };
    }
    return { status: response.status, body };
}
async function login(base: string, username: string, loginPassword = password): Promise<string> {
    const response = await fetch(`${base}/api/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'logistics-os' },
        body: JSON.stringify({ username, password: loginPassword }),
    });
    assert.equal(response.status, 200, `Login ${username} debe funcionar.`);
    const setCookie = response.headers.get('set-cookie');
    assert(setCookie);
    return setCookie.split(';')[0];
}
async function counts(store: Store, tables: string[]) {
    return Object.fromEntries(await Promise.all(tables.map(async (table) => [table, (await store.one(`SELECT count(*) AS n FROM ${table}`))!.n])));
}
test('recepción rechaza código inexistente o de otro cliente sin efectos', async (t) => {
    const f = await fileFixture(t);
    const foreignClientId = (await f.domain.createClient(f.actor, { ...await f.command(), name: 'Cliente distinto QA' })).id;
    const target = await f.shipment();
    const otherClientShipment = await f.shipment({ clientId: foreignClientId });
    const watched = ['receipts', 'receipt_items', 'custody_events', 'audit', 'idempotency'];
    const before = await counts(f.store, watched);
    const absentCommand = { ...await f.command(), shipmentId: target.id, codes: ['CODIGO-INEXISTENTE-QA'], location: 'Depósito QA' };
    await assert.rejects(async () => await f.domain.receive(f.actor, absentCommand), (error: any) => error.code === 'NOT_FOUND');
    const crossClientCommand = { ...await f.command(), shipmentId: target.id, codes: [otherClientShipment.parcels[0].code], location: 'Depósito QA' };
    await assert.rejects(async () => await f.domain.receive(f.actor, crossClientCommand), (error: any) => error.code === 'NOT_FOUND');
    assert.deepEqual(await counts(f.store, watched), before);
    assert.equal((await f.store.one('SELECT state FROM parcels WHERE id=?', otherClientShipment.parcels[0].id))!.state, 'EXPECTED');
});
test('medidas desconocidas permiten confirmar, cargar y despachar sin inventar valores', async (t) => {
    const f = await fileFixture(t);
    const shipment = await f.shipment({ volumeCm3: null });
    const routeId = await f.route();
    await f.receive(shipment);
    await f.assign(routeId, shipment.parcels.map(parcel => parcel.id));
    const ready = await f.domain.ready(f.actor, routeId, { ...await f.command(), expectedVersion: await f.version(routeId) });
    assert.equal(ready.capacityVerified, false);
    await f.domain.load(f.actor, routeId, { ...await f.command(), expectedVersion: await f.version(routeId), code: shipment.parcels[0].code });
    await f.domain.inspect(f.actor, f.vehicleId, { ...await f.command(), odometer: 100, fuelPercent: 70, items: [{ label: 'Frenos', severity: 'OK', note: '' }] });
    await f.domain.dispatch(f.actor, routeId, { ...await f.command(), expectedVersion: await f.version(routeId) });
    assert.equal((await f.store.one('SELECT volume_cm3 FROM parcels WHERE id=?', shipment.parcels[0].id))!.volume_cm3, null);
    assert.equal((await f.store.one('SELECT state FROM routes WHERE id=?', routeId))!.state, 'IN_PROGRESS');
});
test('un peso conocido que excede la capacidad bloquea aunque otro volumen sea desconocido', async (t) => {
    const f = await fileFixture(t);
    const shipment = await f.shipment({ volumeCm3: null });
    await f.store.run('UPDATE parcels SET weight_grams=? WHERE id=?', 50001, shipment.parcels[0].id);
    const routeId = await f.route();
    await f.receive(shipment);
    await f.assign(routeId, shipment.parcels.map(parcel => parcel.id));
    await assert.rejects(async () => await f.domain.ready(f.actor, routeId, { ...await f.command(), expectedVersion: await f.version(routeId) }), (error: any) => error.code === 'CAPACITY_EXCEEDED');
});
test('reintento de intento de entrega con el mismo commandId no duplica intento, custodia ni auditoría', async (t) => {
    const f = await fileFixture(t);
    const shipment = await f.shipment();
    const routeId = await f.route();
    await f.receive(shipment);
    await f.assign(routeId, shipment.parcels.map(parcel => parcel.id));
    await f.domain.ready(f.actor, routeId, { ...await f.command(), expectedVersion: await f.version(routeId) });
    await f.domain.load(f.actor, routeId, { ...await f.command(), expectedVersion: await f.version(routeId), code: shipment.parcels[0].code });
    await f.domain.inspect(f.actor, f.vehicleId, { ...await f.command(), odometer: 100, fuelPercent: 70, items: [{ label: 'Frenos QA', severity: 'OK', note: 'Correcto' }] });
    await f.domain.dispatch(f.actor, routeId, { ...await f.command(), expectedVersion: await f.version(routeId) });
    const stopId = (await f.store.one('SELECT id FROM stops WHERE route_id=?', routeId))!.id as string;
    const body = {
        ...await f.command(), expectedVersion: await f.version(routeId), deliveredParcelIds: [], failedParcelIds: [shipment.parcels[0].id],
        receiverName: '', evidenceIds: [], reasonCode: 'ABSENT', nextAction: 'Reintentar entrega',
    };
    const first = await f.domain.attempt(f.actor, stopId, body);
    const before = await counts(f.store, ['attempts', 'attempt_items', 'custody_events', 'audit']);
    const retried = await f.domain.attempt(f.actor, stopId, body);
    assert.deepEqual(retried, first);
    assert.deepEqual(await counts(f.store, ['attempts', 'attempt_items', 'custody_events', 'audit']), before);
    assert.equal((await f.store.one('SELECT count(*) AS n FROM audit WHERE org_id=? AND command_id=?', f.actor.orgId, body.commandId))!.n, 1);
});
test('chofer ajeno recibe 403 en tracking y cierre; el asignado alcanza las respuestas propias', async (t) => {
    const f = await fileFixture(t);
    const routeId = await f.route();
    const otherDriverId = (await f.domain.createDriver(f.actor, { ...await f.command(), name: 'Otro chofer QA', username: 'driver-other-v2', password })).id;
    const base = await startHttp(t, f);
    const ownCookie = await login(base, 'driver-v2');
    const otherCookie = await login(base, 'driver-other-v2');
    const trackingPath = `/api/routes/${routeId}/tracking`;
    const closePath = `/api/routes/${routeId}/close`;
    const outsiderTracking = await request(base, trackingPath, { cookie: otherCookie });
    const ownerTracking = await request(base, trackingPath, { cookie: ownCookie });
    assert.equal(outsiderTracking.status, 403);
    assert.equal(ownerTracking.status, 503);
    const closeBody = { ...await f.command(), expectedVersion: await f.version(routeId) };
    const outsiderClose = await request(base, closePath, { method: 'POST', cookie: otherCookie, body: closeBody });
    const ownerClose = await request(base, closePath, { method: 'POST', cookie: ownCookie, body: { ...closeBody, commandId: randomUUID() } });
    assert.equal(outsiderClose.status, 403);
    assert.equal(ownerClose.status, 409);
    assert.equal(ownerClose.body.error?.code, 'INVALID_TRANSITION');
    assert.notEqual(otherDriverId, f.driverId);
});
test('otro tenant no puede leer evidencia existente', async (t) => {
    const f = await fileFixture(t);
    const evidence = await f.domain.upload(f.actor, {
        ...await f.command(), filename: 'qa.png', mimeType: 'image/png', dataBase64: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64'),
    });
    const foreignOrgId = randomUUID();
    const foreignUserId = randomUUID();
    const foreignPassword = 'Password-QA-foreign-2026!';
    await f.store.run('INSERT INTO organizations VALUES(?,?,?)', foreignOrgId, 'Organización ajena QA', 'UTC');
    await f.store.run('INSERT INTO users(id,org_id,username,name,password_hash,role,driver_id) VALUES(?,?,?,?,?,?,NULL)', foreignUserId, foreignOrgId, 'foreign-v2', 'Usuario ajeno QA', passwordHash(foreignPassword), 'ADMIN');
    const base = await startHttp(t, f);
    const cookie = await login(base, 'foreign-v2', foreignPassword);
    const response = await request(base, `/api/evidence/${evidence.id}`, { cookie });
    assert.equal(response.status, 404);
    assert.equal(response.body.error?.code, 'NOT_FOUND');
});
test('dos sesiones ops que confirman rutas con el mismo chofer y vehículo producen un único ready', async (t) => {
    const f = await fileFixture(t);
    const shipmentA = await f.shipment();
    const shipmentB = await f.shipment();
    const routeA = await f.route('Ruta concurrente A');
    const routeB = await f.route('Ruta concurrente B');
    await f.receive(shipmentA);
    await f.receive(shipmentB);
    await f.assign(routeA, shipmentA.parcels.map(parcel => parcel.id));
    await f.assign(routeB, shipmentB.parcels.map(parcel => parcel.id));
    const opsA = `ops-a-${randomUUID().slice(0, 8)}`;
    const opsB = `ops-b-${randomUUID().slice(0, 8)}`;
    await f.domain.createUser(f.actor, { ...await f.command(), name: 'Operaciones QA A', username: opsA, password, role: 'OPERATIONS' });
    await f.domain.createUser(f.actor, { ...await f.command(), name: 'Operaciones QA B', username: opsB, password, role: 'OPERATIONS' });
    const base = await startHttp(t, f);
    const [cookieA, cookieB] = await Promise.all([login(base, opsA), login(base, opsB)]);
    const replies = await Promise.all([
        request(base, `/api/routes/${routeA}/ready`, { method: 'POST', cookie: cookieA, body: { ...await f.command(), expectedVersion: await f.version(routeA) } }),
        request(base, `/api/routes/${routeB}/ready`, { method: 'POST', cookie: cookieB, body: { ...await f.command(), expectedVersion: await f.version(routeB) } }),
    ]);
    assert.deepEqual(replies.map(reply => reply.status).sort((a, b) => a - b), [200, 409]);
    assert.ok(replies.some(reply => reply.status === 200));
    assert.ok(replies.some(reply => reply.status === 409 && reply.body.error?.code === 'VERSION_CONFLICT'));
    const states = (await f.store.all('SELECT state FROM routes WHERE id IN (?,?) ORDER BY id', routeA, routeB)).map(row => row.state).sort();
    assert.deepEqual(states, ['DRAFT', 'READY']);
});
