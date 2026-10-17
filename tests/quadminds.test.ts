import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/db.ts';
import { setup, type Actor } from '../server/auth.ts';
import { Logistics } from '../server/domain.ts';
import { createApp } from '../server/app.ts';
import { QuadMindsTracking, loadQuadMindsSettings, normalizePosition, type QuadMindsConfig } from '../server/quadminds.ts';
const fixedNow = Date.parse('2026-10-15T12:00:00Z');
async function fixture(t: test.TestContext) {
    const store = new Store(':memory:');
    t.after(async () => await store.close());
    const ids = await setup(store, { organizationName: 'Tracking QA', timezone: 'UTC', username: 'tracking-admin', password: 'Tracking-Test-2026!' });
    const actor: Actor = { id: ids.userId, orgId: ids.orgId, name: 'QA', role: 'ADMIN', driverId: null };
    const domain = new Logistics(store), command = () => ({ commandId: randomUUID() });
    const driver = await domain.createDriver(actor, { ...await command(), name: 'Chofer QA', username: 'tracking-driver', password: 'Tracking-Driver-2026!' });
    const vehicle = await domain.createVehicle(actor, { ...await command(), plate: 'TRACK-QA', capacityWeightGrams: 1000, capacityVolumeCm3: 1000, odometer: 0 });
    const route = await domain.createRoute(actor, { ...await command(), name: 'Ruta QA', driverId: driver.id, vehicleId: vehicle.id, startAt: '2026-10-15T10:00:00Z', endAt: '2026-10-15T18:00:00Z' });
    const config: QuadMindsConfig = { orgId: actor.orgId, positionUrl: 'https://example.invalid/positions/{vehicleId}', apiKey: 'TEST-SECRET-ONLY', fields: { vehicleId: 'id', latitude: 'lat', longitude: 'lng', measuredAt: 'time' }, itemsPath: 'data', pollIntervalMs: 30000, staleAfterMs: 180000, timeoutMs: 100 };
    const payload = (time = fixedNow) => ({ data: [{ id: 'QM-1', lat: -25.3, lng: -57.6, time: new Date(time).toISOString() }] });
    const bind = async (tracking: QuadMindsTracking, externalVehicleId: string | null = 'QM-1', commandId = randomUUID()) => await tracking.bind(actor, vehicle.id, { commandId, externalVehicleId });
    return { store, actor, domain, driver, vehicle, route, config, payload, bind, command };
}
test('QuadMinds: configuración deshabilitada, incompleta y HTTPS con contrato explícito', () => {
    assert.deepEqual(loadQuadMindsSettings({}), { config: null, invalid: false });
    assert.equal(loadQuadMindsSettings({ QUADMINDS_ENABLED: 'true' }).invalid, true);
    const env = { QUADMINDS_ENABLED: 'true', QUADMINDS_ORG_ID: randomUUID(), QUADMINDS_API_KEY: 'test', QUADMINDS_POSITION_URL: 'https://example.invalid/positions/{vehicleId}', QUADMINDS_FIELDS: JSON.stringify({ vehicleId: 'id', latitude: 'lat', longitude: 'lng', measuredAt: 'time' }) };
    assert.equal(loadQuadMindsSettings(env).invalid, false);
    for (const url of ['http://example.invalid', 'https://user:pass@example.invalid', 'https://{vehicleId}.invalid/position'])
        assert.equal(loadQuadMindsSettings({ ...env, QUADMINDS_POSITION_URL: url }).invalid, true);
});
test('QuadMinds: selecciona el vehículo correcto y rechaza mediciones inválidas', async (t) => {
    const f = await fixture(t);
    assert.equal(normalizePosition(f.payload(), f.config, 'otro', fixedNow), null);
    for (const changed of [{ lat: 91 }, { lng: -181 }, { lat: '' }, { lat: null }, { time: '2026-10-15T12:00:00' }, { time: '2026-10-15T14:00:00Z' }]) {
        assert.throws(() => normalizePosition({ data: [{ ...f.payload().data[0], ...changed }] }, f.config, 'QM-1', fixedNow), { code: 'TRACKING_INVALID_RESPONSE' });
    }
    const point = normalizePosition({ data: [{ ...f.payload().data[0], lat: 0, lng: 0 }] }, f.config, 'QM-1', fixedNow);
    assert.equal(point?.latitude, 0);
    assert.equal(point.longitude, 0);
});
test('QuadMinds: vinculación auditada, idempotencia, unicidad y aislamiento de roles', async (t) => {
    const f = await fixture(t), tracking = new QuadMindsTracking(f.store, { config: null, invalid: false });
    const commandId = randomUUID();
    assert.deepEqual(await f.bind(tracking, 'QM-1', commandId), await f.bind(tracking, 'QM-1', commandId));
    assert.equal((await f.store.one('SELECT count(*) n FROM audit WHERE command_id=?', commandId))!.n, 1);
    await assert.rejects(async () => await tracking.bind({ ...f.actor, role: 'DRIVER' }, f.vehicle.id, { commandId: randomUUID(), externalVehicleId: 'QM-2' }), { code: 'FORBIDDEN' });
    await assert.rejects(async () => await tracking.bind({ ...f.actor, orgId: randomUUID() }, f.vehicle.id, { commandId: randomUUID(), externalVehicleId: 'QM-2' }), { code: 'NOT_FOUND' });
    const second = await f.domain.createVehicle(f.actor, { ...await f.command(), plate: 'TRACK-QA-2', capacityWeightGrams: 1000, capacityVolumeCm3: 1000, odometer: 0 });
    await assert.rejects(async () => await tracking.bind(f.actor, second.id, { ...await f.command(), externalVehicleId: 'QM-1' }), { code: 'VALIDATION_ERROR' });
    await f.bind(tracking, null);
    assert.equal((await tracking.bindings(f.actor)).bindings.length, 0);
});
test('QuadMinds: conserva permisos de ruta y exige configuración y vinculación', async (t) => {
    const f = await fixture(t), disabled = new QuadMindsTracking(f.store, { config: null, invalid: false });
    await assert.rejects(disabled.route(f.actor, f.route.id), { code: 'INTEGRATION_NOT_CONFIGURED' });
    const enabled = new QuadMindsTracking(f.store, { config: f.config, invalid: false });
    await assert.rejects(enabled.route(f.actor, f.route.id), { code: 'TRACKING_VEHICLE_NOT_LINKED' });
    await assert.rejects(enabled.route({ ...f.actor, role: 'DRIVER', driverId: randomUUID() }, f.route.id), { code: 'FORBIDDEN' });
    await assert.rejects(enabled.route({ ...f.actor, orgId: randomUUID() }, f.route.id), { code: 'NOT_FOUND' });
    const otherConfig = new QuadMindsTracking(f.store, { config: { ...f.config, orgId: randomUUID() }, invalid: false });
    await assert.rejects(otherConfig.route(f.actor, f.route.id), { code: 'INTEGRATION_NOT_CONFIGURED' });
});
test('QuadMinds: consulta HTTP simulada, credenciales privadas, caché y consultas concurrentes', async (t) => {
    const f = await fixture(t);
    let calls = 0;
    const request: typeof fetch = async (url, options) => {
        calls++;
        assert.equal(url, 'https://example.invalid/positions/QM-1');
        assert.equal((options?.headers as Record<string, string>)['x-saas-apikey'], f.config.apiKey);
        assert.equal(options?.redirect, 'error');
        return Response.json(f.payload());
    };
    const tracking = new QuadMindsTracking(f.store, { config: f.config, invalid: false }, request, () => fixedNow);
    await f.bind(tracking);
    const [first, second] = await Promise.all([tracking.route(f.actor, f.route.id), tracking.route(f.actor, f.route.id)]);
    assert.deepEqual(first, second);
    assert.equal(first.status, 'FRESH');
    assert.equal(calls, 1);
    await tracking.route(f.actor, f.route.id);
    assert.equal(calls, 1);
    assert.equal(JSON.stringify({ first, status: await tracking.bindings(f.actor) }).includes(f.config.apiKey), false);
    assert.equal((await f.store.one('SELECT count(*) n FROM vehicle_tracking_latest'))!.n, 1);
});
test('QuadMinds: medición antigua, caída del proveedor y regresión temporal', async (t) => {
    const f = await fixture(t);
    let clock = fixedNow, mode = 'fresh';
    const request: typeof fetch = async () => mode === 'error' ? new Response('SECRET provider detail', { status: 401 }) : Response.json(f.payload(mode === 'old' ? fixedNow - 300000 : fixedNow));
    const tracking = new QuadMindsTracking(f.store, { config: f.config, invalid: false }, request, () => clock);
    await f.bind(tracking);
    assert.equal((await tracking.route(f.actor, f.route.id)).status, 'FRESH');
    clock += 30001;
    mode = 'error';
    const failed = await tracking.route(f.actor, f.route.id);
    assert.equal(failed.status, 'STALE');
    assert.equal(failed.sourceError, 'TRACKING_PROVIDER_ERROR');
    assert.ok(failed.position);
    assert.equal(JSON.stringify(failed).includes('SECRET'), false);
    clock += 30001;
    mode = 'old';
    const regressed = await tracking.route(f.actor, f.route.id);
    assert.equal(regressed.position?.measuredAt, new Date(fixedNow).toISOString());
    clock += 180001;
    assert.equal((await tracking.route(f.actor, f.route.id)).status, 'STALE');
    await f.bind(tracking, 'QM-2');
    assert.equal((await f.store.one('SELECT count(*) n FROM vehicle_tracking_latest'))!.n, 0);
});
test('QuadMinds: no inventa posición ante respuesta vacía, inválida o timeout', async (t) => {
    const f = await fixture(t);
    for (const [request, expected] of [
        [async () => Response.json({ data: [] }), 'TRACKING_NO_POSITION'],
        [async () => Response.json({ data: [{ ...f.payload().data[0], lat: 100 }] }), 'TRACKING_INVALID_RESPONSE'],
        [async () => { throw new DOMException('test only', 'TimeoutError'); }, 'TRACKING_TIMEOUT'],
        [async () => new Response('{invalid-json'), 'TRACKING_PROVIDER_ERROR'],
        [async () => new Response('x'.repeat(2000001)), 'TRACKING_INVALID_RESPONSE'],
    ] as const) {
        const tracking = new QuadMindsTracking(f.store, { config: f.config, invalid: false }, request as typeof fetch, () => fixedNow);
        await f.bind(tracking);
        const result = await tracking.route(f.actor, f.route.id);
        assert.equal(result.status, 'NO_POSITION');
        assert.equal(result.position, null);
        assert.equal(result.sourceError, expected);
    }
});
test('QuadMinds: cambio de vinculación durante consulta descarta la respuesta anterior', async (t) => {
    const f = await fixture(t);
    let release!: (response: Response) => void;
    let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
    const tracking = new QuadMindsTracking(f.store, { config: f.config, invalid: false }, async () => new Promise(resolve => { release = resolve; started(); }), () => fixedNow);
    await f.bind(tracking);
    const pending = tracking.route(f.actor, f.route.id);
    await ready;
    await f.bind(tracking, 'QM-2');
    release(Response.json(f.payload()));
    await assert.rejects(pending, { code: 'TRACKING_BINDING_CHANGED' });
    assert.equal((await f.store.one('SELECT count(*) n FROM vehicle_tracking_latest'))!.n, 0);
});
test('QuadMinds: revincular el mismo ID invalida una consulta pendiente', async (t) => {
    const f = await fixture(t);
    let release!: (response: Response) => void;
    let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
    const tracking = new QuadMindsTracking(f.store, { config: f.config, invalid: false }, async () => new Promise(resolve => { release = resolve; started(); }), () => fixedNow);
    await f.bind(tracking);
    const pending = tracking.route(f.actor, f.route.id);
    await ready;
    await f.bind(tracking);
    release(Response.json(f.payload()));
    await assert.rejects(pending, { code: 'TRACKING_BINDING_CHANGED' });
    assert.equal((await f.store.one('SELECT count(*) n FROM vehicle_tracking_latest'))!.n, 0);
});
test('QuadMinds: migración v3 y última posición sobreviven al reinicio', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'quadminds-persist-'));
    const path = join(directory, 'test.sqlite');
    let store: Store | null = new Store(path);
    try {
        const ids = await setup(store, { organizationName: 'QA persistencia', timezone: 'UTC', username: 'qa', password: 'QA-Persistence-2026!' });
        const actor: Actor = { id: ids.userId, orgId: ids.orgId, name: 'QA', role: 'ADMIN', driverId: null };
        const domain = new Logistics(store), cmd = () => ({ commandId: randomUUID() });
        const driver = await domain.createDriver(actor, { ...cmd(), name: 'QA', username: 'qa-driver', password: 'QA-Driver-Persistence-2026!' });
        const vehicle = await domain.createVehicle(actor, { ...cmd(), plate: 'QA-PERSIST', capacityWeightGrams: 1000, capacityVolumeCm3: 1000, odometer: 0 });
        const route = await domain.createRoute(actor, { ...cmd(), name: 'QA', driverId: driver.id, vehicleId: vehicle.id, startAt: '2026-10-15T10:00:00Z', endAt: '2026-10-15T18:00:00Z' });
        const config: QuadMindsConfig = { orgId: actor.orgId, positionUrl: 'https://example.invalid', apiKey: 'QA', fields: { vehicleId: 'id', latitude: 'lat', longitude: 'lng', measuredAt: 'time' }, itemsPath: '', pollIntervalMs: 30000, staleAfterMs: 180000, timeoutMs: 100 };
        const tracking = new QuadMindsTracking(store, { config, invalid: false }, async () => Response.json({ id: 'QM', lat: 0, lng: 0, time: new Date(fixedNow).toISOString() }), () => fixedNow);
        await tracking.bind(actor, vehicle.id, { ...cmd(), externalVehicleId: 'QM' });
        await tracking.route(actor, route.id);
        await store.close();
        store = new Store(path);
        assert.equal((await store.one('SELECT count(*) n FROM schema_migrations WHERE version=3'))!.n, 1);
        assert.equal((await store.one('SELECT external_vehicle_id FROM vehicle_tracking_bindings'))!.external_vehicle_id, 'QM');
        const restarted = new QuadMindsTracking(store, { config, invalid: false }, async () => new Response('', { status: 503 }), () => fixedNow + 300000);
        const result = await restarted.route(actor, route.id);
        assert.equal(result.status, 'STALE');
        assert.equal(result.position?.latitude, 0);
        assert.equal(result.position?.measuredAt, new Date(fixedNow).toISOString());
    }
    finally {
        await store?.close();
        rmSync(directory, { recursive: true, force: true });
    }
});
test('QuadMinds: endpoints HTTP requieren sesión, rol y CSRF; bootstrap informa estado', async (t) => {
    const f = await fixture(t), tracking = new QuadMindsTracking(f.store, { config: f.config, invalid: false }, async () => Response.json(f.payload()), () => fixedNow);
    const server = createApp(f.store, tracking).listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    try {
        const base = `http://127.0.0.1:${(server.address() as {
            port: number;
        }).port}`;
        const login = async (username: string, password: string) => {
            const response = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'logistics-os' }, body: JSON.stringify({ username, password }) });
            assert.equal(response.status, 200);
            return response.headers.get('set-cookie')!.split(';')[0];
        };
        assert.equal((await fetch(base + '/api/integrations/quadminds')).status, 401);
        const cookie = await login('tracking-admin', 'Tracking-Test-2026!');
        const path = base + `/api/vehicles/${f.vehicle.id}/tracking-binding`;
        assert.equal((await fetch(path, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ ...await f.command(), externalVehicleId: 'QM-1' }) })).status, 403);
        assert.equal((await fetch(path, { method: 'POST', headers: { cookie, 'content-type': 'application/json', 'x-requested-with': 'logistics-os' }, body: JSON.stringify({ ...await f.command(), externalVehicleId: 'QM-1' }) })).status, 200);
        const bootstrap = await (await fetch(base + '/api/bootstrap', { headers: { cookie } })).json();
        assert.equal(bootstrap.tracking.configured, true);
        assert.equal(JSON.stringify(bootstrap).includes(f.config.apiKey), false);
        const ownCookie = await login('tracking-driver', 'Tracking-Driver-2026!');
        assert.equal((await fetch(base + '/api/integrations/quadminds', { headers: { cookie: ownCookie } })).status, 403);
        const response = await fetch(base + `/api/routes/${f.route.id}/tracking`, { headers: { cookie: ownCookie } });
        assert.equal(response.status, 200);
        assert.equal((await response.json()).status, 'FRESH');
        assert.equal((await fetch(base + '/api/tracking/sessions/unused/points', { method: 'POST', headers: { cookie, 'x-requested-with': 'logistics-os' } })).status, 503);
    }
    finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
});
