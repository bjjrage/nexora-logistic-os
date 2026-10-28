import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { deflateSync } from 'node:zlib';
import { test } from 'node:test';
import { createApp } from '../server/app.ts';
import { Store } from '../server/db.ts';
type Json = Record<string, any>;
type Reply = {
    status: number;
    body: Json;
};
function crc32(bytes: Buffer): number {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++)
            crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(kind: string, data: Buffer): Buffer {
    const name = Buffer.from(kind, 'ascii');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([length, name, data, checksum]);
}
function png1x1([red, green, blue]: [
    number,
    number,
    number
]): string {
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const header = Buffer.alloc(13);
    header.writeUInt32BE(1, 0);
    header.writeUInt32BE(1, 4);
    header[8] = 8; // bit depth
    header[9] = 2; // RGB
    const image = Buffer.from([0, red, green, blue]); // filter byte + one RGB pixel
    return Buffer.concat([
        signature,
        pngChunk('IHDR', header),
        pngChunk('IDAT', deflateSync(image)),
        pngChunk('IEND', Buffer.alloc(0)),
    ]).toString('base64');
}
async function listen(store: Store): Promise<{
    server: Server;
    baseUrl: string;
}> {
    const server = createApp(store).listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    const address = server.address();
    assert(address && typeof address !== 'string', 'El servidor de prueba debe escuchar en un puerto TCP.');
    return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}
async function closeServer(server: Server | undefined): Promise<void> {
    if (!server?.listening)
        return;
    await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
    });
}
function clientFor(baseUrl: () => string) {
    let cookie = '';
    const request = async (path: string, method = 'GET', body?: Json): Promise<Reply> => {
        const headers: Record<string, string> = { 'X-Requested-With': 'logistics-os' };
        if (body)
            headers['Content-Type'] = 'application/json';
        if (cookie)
            headers.Cookie = cookie;
        const response = await fetch(`${baseUrl()}${path}`, {
            method,
            headers,
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) {
            const match = setCookie.match(/(?:^|,\s*)logistics_session=([^;]+)/);
            if (match)
                cookie = `logistics_session=${match[1]}`;
        }
        const text = await response.text();
        let parsed: Json = {};
        try {
            parsed = text ? JSON.parse(text) as Json : {};
        }
        catch {
            parsed = { raw: text };
        }
        return { status: response.status, body: parsed };
    };
    return {
        request,
        get: (path: string) => request(path),
        post: (path: string, body: Json = {}, commandId = randomUUID()) => request(path, 'POST', { ...body, commandId }),
        get cookie() { return cookie; },
    };
}
function ok(reply: Reply, expectedStatus = 200): Json {
    assert.equal(reply.status, expectedStatus, JSON.stringify(reply.body));
    return reply.body;
}
async function createHarness() {
    const directory = await mkdtemp(join(tmpdir(), 'nexora-logistics-flow-'));
    const databasePath = join(directory, 'flow.sqlite');
    let store = new Store(databasePath);
    let active = await listen(store);
    let baseUrl = active.baseUrl;
    const client = clientFor(() => baseUrl);
    let storeOpen = true;
    return {
        directory,
        databasePath,
        client,
        get store() { return store; },
        async restart() {
            await closeServer(active.server);
            if (storeOpen)
                await store.close();
            storeOpen = false;
            store = new Store(databasePath);
            storeOpen = true;
            active = await listen(store);
            baseUrl = active.baseUrl;
        },
        async dispose() {
            await closeServer(active.server);
            if (storeOpen) {
                await store.close();
                storeOpen = false;
            }
            await rm(directory, { recursive: true, force: true });
        },
    };
}
async function setupOrganization(client: ReturnType<typeof clientFor>): Promise<void> {
    ok(await client.post('/api/setup', {
        organizationName: 'Organización de QA',
        timezone: 'UTC',
        username: 'admin.qa',
        password: 'Clave-segura-QA-2026',
    }), 201);
    assert.match(client.cookie, /^logistics_session=[a-f0-9]{64}$/);
}
async function createShipmentFixture(client: ReturnType<typeof clientFor>, parcelCount: number, reference: string) {
    const clientId = ok(await client.post('/api/clients', { name: `Cliente ${reference}` })).id as string;
    ok(await client.post(`/api/clients/${clientId}/delivery-provider`, { deliveryProvider: 'QUADMINDS' }));
    const driverId = ok(await client.post('/api/drivers', {
        name: `Chofer ${reference}`,
        username: `driver.${reference.toLowerCase()}`,
        password: 'Clave-chofer-QA-2026',
    })).id as string;
    const vehicleId = ok(await client.post('/api/vehicles', {
        plate: `QA-${reference.slice(-3).toUpperCase()}`,
        capacityWeightGrams: 100000,
        capacityVolumeCm3: 100000,
        odometer: 0,
    })).id as string;
    const shipmentId = ok(await client.post('/api/shipments', {
        clientId,
        reference,
        originText: 'Depósito de prueba',
        destinationText: 'Destino de prueba',
        recipientName: 'Receptor de prueba',
        recipientPhone: '',
        parcelCount,
        weightGrams: 1000,
        volumeCm3: 1000,
        proofPolicy: 'RECEIVER_PHOTO',
    })).id as string;
    const initial = ok(await client.get('/api/bootstrap'));
    const parcels = (initial.parcels as Json[])
        .filter(parcel => parcel.shipmentId === shipmentId)
        .reverse();
    assert.equal(parcels.length, parcelCount, 'La preparación debe crear la cantidad declarada de bultos.');
    return { clientId, driverId, vehicleId, shipmentId, parcels };
}
async function receiveParcels(client: ReturnType<typeof clientFor>, store: Store, shipmentId: string, parcels: Json[], location: string) {
    const body = { shipmentId, codes: parcels.map(parcel => parcel.code as string), location };
    const receiptCommandId = randomUUID();
    const first = ok(await client.post('/api/receipts', body, receiptCommandId));
    const eventCountAfterFirst = (await store.one('SELECT COUNT(*) AS n FROM custody_events'))!.n as number;
    const receiptCountAfterFirst = (await store.one('SELECT COUNT(*) AS n FROM receipts'))!.n as number;
    const sameCommand = ok(await client.post('/api/receipts', body, receiptCommandId));
    assert.deepEqual(sameCommand, first, 'Repetir el mismo comando debe devolver el resultado previo.');
    const newCommand = ok(await client.post('/api/receipts', body));
    assert.equal(newCommand.received, 0, 'Una recepción ya aplicada no debe volver a sumar bultos.');
    assert.equal(newCommand.alreadyReceived, parcels.length);
    assert.equal((await store.one('SELECT COUNT(*) AS n FROM custody_events'))!.n, eventCountAfterFirst);
    assert.equal((await store.one('SELECT COUNT(*) AS n FROM receipts'))!.n, receiptCountAfterFirst);
    return first;
}
async function prepareAndDispatch(client: ReturnType<typeof clientFor>, store: Store, fixture: Awaited<ReturnType<typeof createShipmentFixture>>, parcels: Json[]) {
    const startAt = new Date(Date.now() - 60000).toISOString();
    const endAt = new Date(Date.now() + 60 * 60000).toISOString();
    const created = ok(await client.post('/api/routes', {
        name: `Ruta ${fixture.shipmentId.slice(0, 8)}`,
        driverId: fixture.driverId,
        vehicleId: fixture.vehicleId,
        startAt,
        endAt,
    }));
    const routeId = created.id as string;
    let version = created.version as number;
    const assigned = ok(await client.post(`/api/routes/${routeId}/assignments`, {
        expectedVersion: version,
        parcelIds: parcels.map(parcel => parcel.id as string),
        pickup: false,
    }));
    version = assigned.version as number;
    ok(await client.post(`/api/vehicles/${fixture.vehicleId}/inspections`, {
        odometer: 0,
        fuelPercent: 100,
        items: [{ label: 'Checklist de salida', severity: 'OK', note: '' }],
    }));
    for (const [index, parcel] of parcels.entries()) {
        const scanBody = { expectedVersion: version, code: parcel.code as string };
        const commandId = randomUUID();
        const eventCountBefore = (await store.one('SELECT COUNT(*) AS n FROM custody_events WHERE parcel_id=?', parcel.id))!.n as number;
        const loaded = ok(await client.post(`/api/routes/${routeId}/load-scans`, scanBody, commandId));
        version = loaded.version as number;
        if (index === 0) {
            const sameCommand = ok(await client.post(`/api/routes/${routeId}/load-scans`, scanBody, commandId));
            assert.deepEqual(sameCommand, loaded, 'Repetir el mismo escaneo debe devolver el resultado previo.');
            const newCommand = ok(await client.post(`/api/routes/${routeId}/load-scans`, {
                expectedVersion: version,
                code: parcel.code as string,
            }));
            assert.equal(newCommand.alreadyLoaded, true, 'Un nuevo comando para un bulto ya cargado no debe cargarlo de nuevo.');
            assert.equal(newCommand.version, version);
            assert.equal((await store.one('SELECT COUNT(*) AS n FROM custody_events WHERE parcel_id=?', parcel.id))!.n, eventCountBefore + 1);
        }
    }
    const ready = ok(await client.post(`/api/routes/${routeId}/ready`, { expectedVersion: version }));
    version = ready.version as number;
    const dispatched = ok(await client.post(`/api/routes/${routeId}/dispatch`, { expectedVersion: version }));
    return { routeId, version: dispatched.version as number };
}
async function uploadPhoto(client: ReturnType<typeof clientFor>, parcelId: string, name: string, color: [
    number,
    number,
    number
]): Promise<string> {
    const result = ok(await client.post('/api/evidence', {
        parcelId,
        filename: name,
        mimeType: 'image/png',
        dataBase64: png1x1(color),
    }));
    assert.equal(result.state, 'STORED');
    return result.id as string;
}
test('flujo integrado P1–P5: recepción parcial, despacho, entrega, devolución y persistencia', async () => {
    const harness = await createHarness();
    try {
        await setupOrganization(harness.client);
        const fixture = await createShipmentFixture(harness.client, 5, 'P1P5-QA');
        const [p1, p2, p3, p4, p5] = fixture.parcels;
        assert.ok(p1 && p2 && p3 && p4 && p5);
        await receiveParcels(harness.client, harness.store, fixture.shipmentId, [p1, p2, p3, p4], 'DEPOT-QA');
        let bootstrap = ok(await harness.client.get('/api/bootstrap'));
        let shipment = (bootstrap.shipments as Json[]).find(item => item.id === fixture.shipmentId)!;
        assert.deepEqual(shipment.counts, { expected: 5, received: 4, delivered: 0, pending: 5, returned: 0, missing: 1 });
        assert.equal((await harness.store.one('SELECT state FROM parcels WHERE id=?', p5.id))!.state, 'EXPECTED');
        assert.equal((await harness.store.one('SELECT COUNT(*) AS n FROM custody_events WHERE parcel_id=?', p5.id))!.n, 0);
        const dispatched = await prepareAndDispatch(harness.client, harness.store, fixture, [p1, p2, p3, p4]);
        let route = (await harness.store.one('SELECT * FROM routes WHERE id=?', dispatched.routeId))!;
        assert.equal(route.state, 'IN_PROGRESS');
        const inspection = (await harness.store.one('SELECT * FROM inspections WHERE vehicle_id=? ORDER BY rowid DESC LIMIT 1', fixture.vehicleId))!;
        assert.ok(inspection.created_at >= route.start_at && inspection.created_at <= route.end_at, 'El checklist debe quedar dentro de la ventana de ruta.');
        bootstrap = ok(await harness.client.get('/api/bootstrap'));
        const deliveryStop = (bootstrap.stops as Json[]).find(stop => stop.routeId === dispatched.routeId && stop.kind === 'DELIVERY');
        assert.ok(deliveryStop, 'La asignación debe crear una parada de entrega.');
        const attemptsBefore = (await harness.store.one('SELECT COUNT(*) AS n FROM attempts'))!.n as number;
        const p1EventsBefore = (await harness.store.one('SELECT COUNT(*) AS n FROM custody_events WHERE parcel_id=?', p1.id))!.n as number;
        const noEvidence = await harness.client.post(`/api/stops/${deliveryStop.id}/attempts`, {
            expectedVersion: route.version,
            deliveredParcelIds: [p1.id],
            failedParcelIds: [],
            receiverName: 'Receptor QA',
            evidenceIds: [],
        });
        assert.equal(noEvidence.status, 409);
        assert.equal(noEvidence.body.error.code, 'EVIDENCE_REQUIRED');
        assert.equal((await harness.store.one('SELECT COUNT(*) AS n FROM attempts'))!.n, attemptsBefore);
        assert.equal((await harness.store.one('SELECT COUNT(*) AS n FROM custody_events WHERE parcel_id=?', p1.id))!.n, p1EventsBefore);
        assert.equal((await harness.store.one('SELECT state FROM parcels WHERE id=?', p1.id))!.state, 'IN_TRANSIT');
        assert.equal((await harness.store.one('SELECT version FROM routes WHERE id=?', dispatched.routeId))!.version, route.version);
        const proofIds = await Promise.all([
            uploadPhoto(harness.client, p1.id, 'entrega-P1.png', [210, 30, 30]),
            uploadPhoto(harness.client, p2.id, 'entrega-P2.png', [30, 210, 30]),
            uploadPhoto(harness.client, p3.id, 'entrega-P3.png', [30, 30, 210]),
        ]);
        const attempt = ok(await harness.client.post(`/api/stops/${deliveryStop.id}/attempts`, {
            expectedVersion: route.version,
            deliveredParcelIds: [p1.id, p2.id, p3.id],
            failedParcelIds: [p4.id],
            receiverName: 'Receptor QA',
            evidenceIds: proofIds,
            reasonCode: 'REFUSED',
            nextAction: 'Volver a depósito',
        }));
        route = (await harness.store.one('SELECT * FROM routes WHERE id=?', dispatched.routeId))!;
        assert.equal(route.version, attempt.version);
        assert.equal((await harness.store.one('SELECT state FROM parcels WHERE id=?', p1.id))!.state, 'DELIVERED');
        assert.equal((await harness.store.one('SELECT state FROM parcels WHERE id=?', p2.id))!.state, 'DELIVERED');
        assert.equal((await harness.store.one('SELECT state FROM parcels WHERE id=?', p3.id))!.state, 'DELIVERED');
        assert.equal((await harness.store.one('SELECT state FROM parcels WHERE id=?', p4.id))!.state, 'RETURN_PENDING');
        assert.equal((await harness.store.one('SELECT state FROM parcels WHERE id=?', p5.id))!.state, 'EXPECTED');
        assert.equal((await harness.store.one('SELECT COUNT(*) AS n FROM attempt_items WHERE attempt_id=? AND result=?', attempt.id, 'DELIVERED'))!.n, 3);
        assert.equal((await harness.store.one('SELECT COUNT(*) AS n FROM attempt_items WHERE attempt_id=? AND result=?', attempt.id, 'FAILED'))!.n, 1);
        const incident = (await harness.store.one('SELECT * FROM incidents WHERE parcel_id=?', p4.id))!;
        assert.equal(incident.reason_code, 'REFUSED');
        assert.equal(incident.next_action, 'Volver a depósito');
        const authorized = ok(await harness.client.post(`/api/incidents/${incident.id}/authorize-return`));
        assert.equal(authorized.state, 'AUTHORIZED');
        const returnEventsBefore = (await harness.store.one('SELECT COUNT(*) n FROM custody_events WHERE parcel_id=?', p4.id))!.n;
        const withoutDepotPhoto = await harness.client.post(`/api/returns/${authorized.id}/receive`, { location: 'DEPOT-QA' });
        assert.equal(withoutDepotPhoto.body.error.code, 'EVIDENCE_REQUIRED');
        assert.equal((await harness.store.one('SELECT state FROM returns WHERE id=?', authorized.id))!.state, 'AUTHORIZED');
        const wrongDepotPhoto = await harness.client.post(`/api/returns/${authorized.id}/receive`, { location: 'DEPOT-QA', evidenceId: proofIds[0] });
        assert.equal(wrongDepotPhoto.body.error.code, 'EVIDENCE_REQUIRED');
        assert.equal((await harness.store.one('SELECT COUNT(*) n FROM custody_events WHERE parcel_id=?', p4.id))!.n, returnEventsBefore);
        const depotProof = await uploadPhoto(harness.client, p4.id, 'recepcion-deposito-P4.png', [10, 120, 180]);
        const receiveCommandId = randomUUID();
        const receiveBody = { location: 'DEPOT-QA', evidenceId: depotProof };
        const receivedReturn = ok(await harness.client.post(`/api/returns/${authorized.id}/receive`, receiveBody, receiveCommandId));
        assert.deepEqual(ok(await harness.client.post(`/api/returns/${authorized.id}/receive`, receiveBody, receiveCommandId)), receivedReturn);
        assert.equal((await harness.store.one('SELECT COUNT(*) n FROM custody_events WHERE parcel_id=?', p4.id))!.n, returnEventsBefore + 1);
        assert.equal(receivedReturn.state, 'AT_DEPOT');
        assert.equal((await harness.store.one('SELECT state FROM parcels WHERE id=?', p4.id))!.state, 'RETURNED_TO_DEPOT');
        assert.equal((await harness.store.one('SELECT state FROM returns WHERE id=?', authorized.id))!.state, 'AT_DEPOT');
        assert.notEqual((await harness.store.one('SELECT state FROM parcels WHERE id=?', p4.id))!.state, 'RETURNED_TO_SENDER');
        const senderProof = await uploadPhoto(harness.client, p4.id, 'devolucion-remitente-P4.png', [220, 25, 220]);
        const duplicateImage = await uploadPhoto(harness.client, p4.id, 'mismo-contenido-otro-archivo.png', [10, 120, 180]);
        for (const evidenceId of [depotProof, duplicateImage]) {
            const rejected = await harness.client.post(`/api/returns/${authorized.id}/send-to-sender`, { receiverName: 'Remitente QA', evidenceId });
            assert.equal(rejected.body.error.code, 'EVIDENCE_REQUIRED');
            assert.equal((await harness.store.one('SELECT state FROM returns WHERE id=?', authorized.id))!.state, 'AT_DEPOT');
        }
        const storedProofs = await harness.store.all('SELECT id,sha256 FROM evidence WHERE id IN (?,?,?,?)', ...proofIds, senderProof);
        assert.equal(storedProofs.length, 4);
        assert.equal(new Set(storedProofs.map(item => item.sha256)).size, 4, 'Cada evidencia de QA debe contener una imagen distinta.');
        const sentReturn = ok(await harness.client.post(`/api/returns/${authorized.id}/send-to-sender`, {
            receiverName: 'Remitente QA',
            evidenceId: senderProof,
        }));
        assert.equal(sentReturn.state, 'SENT_TO_SENDER');
        assert.equal((await harness.store.one('SELECT sender_evidence_id FROM returns WHERE id=?', authorized.id))!.sender_evidence_id, senderProof);
        assert.equal((await harness.store.one('SELECT state FROM parcels WHERE id=?', p4.id))!.state, 'RETURNED_TO_SENDER');
        assert.deepEqual((await harness.store.all('SELECT stage,evidence_id FROM return_evidence WHERE return_id=? ORDER BY stage', authorized.id)).map(row => [row.stage, row.evidence_id]), [['DEPOT', depotProof], ['SENDER', senderProof]]);
        bootstrap = ok(await harness.client.get('/api/bootstrap'));
        const freshRoute = (bootstrap.routes as Json[]).find(item => item.id === dispatched.routeId)!;
        ok(await harness.client.post(`/api/routes/${dispatched.routeId}/close`, { expectedVersion: freshRoute.version }));
        assert.equal((await harness.store.one('SELECT state FROM routes WHERE id=?', dispatched.routeId))!.state, 'OPERATIONALLY_CLOSED');
        bootstrap = ok(await harness.client.get('/api/bootstrap'));
        shipment = (bootstrap.shipments as Json[]).find(item => item.id === fixture.shipmentId)!;
        assert.deepEqual(shipment.counts, { expected: 5, received: 4, delivered: 3, pending: 1, returned: 1, missing: 1 });
        assert.equal((bootstrap.shipments as Json[]).find(item => item.id === fixture.shipmentId)!.counts.delivered, 3, 'El envío no debe figurar totalmente entregado.');
        assert.equal((await harness.store.one('SELECT state FROM parcels WHERE id=?', p5.id))!.state, 'EXPECTED');
        assert.equal((await harness.store.one('SELECT COUNT(*) AS n FROM custody_events WHERE parcel_id=?', p5.id))!.n, 0);
        const p4Actions = (await harness.store.all('SELECT action FROM custody_events WHERE parcel_id=? ORDER BY rowid', p4.id)).map(item => item.action);
        assert.deepEqual(p4Actions, ['RECEIVED', 'LOADED', 'DISPATCHED', 'DELIVERY_FAILED', 'RETURN_RECEIVED', 'RETURNED_TO_SENDER']);
        const auditOperations = (await harness.store.all('SELECT action FROM audit WHERE org_id=?', (await harness.store.one('SELECT id FROM organizations'))!.id)).map(item => item.action);
        assert.ok(auditOperations.includes('receipts.create'));
        assert.ok(auditOperations.includes(`stops.${deliveryStop.id}.attempt`));
        assert.ok(auditOperations.includes(`incidents.${incident.id}.return`));
        assert.ok(auditOperations.includes(`returns.${authorized.id}.receive`));
        assert.ok(auditOperations.includes(`returns.${authorized.id}.sender`));
        assert.ok(auditOperations.includes(`routes.${dispatched.routeId}.close`));
        const orgId = (await harness.store.one('SELECT id FROM organizations'))!.id as string;
        const tables = [
            'clients', 'drivers', 'vehicles', 'shipments', 'parcels', 'routes', 'route_assignments', 'stops',
            'receipts', 'custody_events', 'attempts', 'incidents', 'returns', 'evidence', 'audit', 'idempotency',
        ];
        for (const table of tables) {
            assert.ok((await harness.store.all(`SELECT org_id FROM ${table}`)).every(row => row.org_id === orgId), `${table} debe permanecer bajo la misma organización.`);
        }
        assert.ok((await harness.store.all('SELECT a.org_id FROM attempt_items i JOIN attempts a ON a.id=i.attempt_id')).every(row => row.org_id === orgId));
        await harness.restart();
        const restored = ok(await harness.client.get('/api/bootstrap'));
        assert.equal(restored.organization.id, orgId);
        assert.equal((restored.routes as Json[]).find(item => item.id === dispatched.routeId)!.state, 'OPERATIONALLY_CLOSED');
        assert.equal((restored.shipments as Json[]).find(item => item.id === fixture.shipmentId)!.counts.delivered, 3);
        assert.equal((await harness.store.one('SELECT COUNT(*) AS n FROM attempts'))!.n, 1);
        assert.equal((await harness.store.one('SELECT COUNT(*) AS n FROM custody_events WHERE parcel_id=?', p4.id))!.n, 6);
        assert.equal((await harness.store.one('SELECT sender_evidence_id FROM returns WHERE id=?', authorized.id))!.sender_evidence_id, senderProof);
        assert.equal((await harness.store.one("SELECT evidence_id FROM return_evidence WHERE return_id=? AND stage='DEPOT'", authorized.id))!.evidence_id, depotProof);
    }
    finally {
        await harness.dispose();
    }
});
test('evidencia ausente no cambia estado; intento fallido y reintento exitoso conservan ambos resultados', async () => {
    const harness = await createHarness();
    try {
        await setupOrganization(harness.client);
        const fixture = await createShipmentFixture(harness.client, 1, 'RETRY-QA');
        const [parcel] = fixture.parcels;
        assert.ok(parcel);
        await receiveParcels(harness.client, harness.store, fixture.shipmentId, [parcel], 'DEPOT-RETRY-QA');
        const dispatched = await prepareAndDispatch(harness.client, harness.store, fixture, [parcel]);
        const bootstrap = ok(await harness.client.get('/api/bootstrap'));
        const stop = (bootstrap.stops as Json[]).find(item => item.routeId === dispatched.routeId && item.kind === 'DELIVERY')!;
        const eventCount = (await harness.store.one('SELECT COUNT(*) AS n FROM custody_events WHERE parcel_id=?', parcel.id))!.n as number;
        const missingProof = await harness.client.post(`/api/stops/${stop.id}/attempts`, {
            expectedVersion: dispatched.version,
            deliveredParcelIds: [parcel.id],
            failedParcelIds: [],
            receiverName: 'Receptor QA',
            evidenceIds: [],
        });
        assert.equal(missingProof.status, 409);
        assert.equal(missingProof.body.error.code, 'EVIDENCE_REQUIRED');
        assert.equal((await harness.store.one('SELECT COUNT(*) AS n FROM attempts'))!.n, 0);
        assert.equal((await harness.store.one('SELECT COUNT(*) AS n FROM custody_events WHERE parcel_id=?', parcel.id))!.n, eventCount);
        assert.equal((await harness.store.one('SELECT state FROM parcels WHERE id=?', parcel.id))!.state, 'IN_TRANSIT');
        const failed = ok(await harness.client.post(`/api/stops/${stop.id}/attempts`, {
            expectedVersion: dispatched.version,
            deliveredParcelIds: [],
            failedParcelIds: [parcel.id],
            receiverName: '',
            evidenceIds: [],
            reasonCode: 'REFUSED',
            nextAction: 'Reintentar entrega',
        }));
        assert.equal((await harness.store.one('SELECT state FROM parcels WHERE id=?', parcel.id))!.state, 'RETURN_PENDING');
        const reopened = ok(await harness.client.post(`/api/stops/${stop.id}/retry`, { expectedVersion: failed.version }));
        const evidenceId = await uploadPhoto(harness.client, parcel.id, 'reintento-P1.png', [120, 70, 230]);
        const succeeded = ok(await harness.client.post(`/api/stops/${stop.id}/attempts`, {
            expectedVersion: reopened.version,
            deliveredParcelIds: [parcel.id],
            failedParcelIds: [],
            receiverName: 'Receptor QA',
            evidenceIds: [evidenceId],
        }));
        assert.ok(succeeded.version > failed.version);
        assert.equal((await harness.store.one('SELECT state FROM parcels WHERE id=?', parcel.id))!.state, 'DELIVERED');
        const attempts = await harness.store.all('SELECT id,reason_code,next_action FROM attempts ORDER BY rowid');
        assert.equal(attempts.length, 2);
        assert.equal(attempts[0].reason_code, 'REFUSED');
        assert.equal(attempts[0].next_action, 'Reintentar entrega');
        assert.equal(attempts[1].reason_code, '');
        const results = await harness.store.all('SELECT ai.result FROM attempt_items ai JOIN attempts a ON a.id=ai.attempt_id ORDER BY a.rowid');
        assert.deepEqual(results.map(item => item.result), ['FAILED', 'DELIVERED']);
        assert.equal((await harness.store.one('SELECT state FROM incidents WHERE parcel_id=?', parcel.id))!.state, 'RESOLVED');
        const actions = (await harness.store.all('SELECT action FROM custody_events WHERE parcel_id=? ORDER BY rowid', parcel.id)).map(item => item.action);
        assert.deepEqual(actions.slice(-3), ['DELIVERY_FAILED', 'DELIVERY_RETRY', 'DELIVERED']);
    }
    finally {
        await harness.dispose();
    }
});
