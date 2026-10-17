import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { test } from 'node:test';
import { Store } from '../server/db.ts';
import { Logistics } from '../server/domain.ts';
import { setup, type Actor } from '../server/auth.ts';
import { createDriverDocument, renewDriverDocument } from '../server/driver-documents.ts';
const password = 'Password-QA-controls-v2-2026!';
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
    header[8] = 8;
    header[9] = 2;
    const image = Buffer.from([0, red, green, blue]);
    return Buffer.concat([
        signature,
        pngChunk('IHDR', header),
        pngChunk('IDAT', deflateSync(image)),
        pngChunk('IEND', Buffer.alloc(0)),
    ]).toString('base64');
}
async function fixture(t: any) {
    const directory = mkdtempSync(join(tmpdir(), 'nexora-controls-v2-'));
    const store = new Store(join(directory, 'controls.sqlite'));
    t.after(async () => {
        await store.close();
        rmSync(directory, { recursive: true, force: true });
    });
    const suffix = randomUUID().slice(0, 8);
    const { userId, orgId } = await setup(store, {
        organizationName: 'Controles QA v2', timezone: 'UTC', username: `admin-${suffix}`, password,
    });
    const actor: Actor = { id: userId, orgId, name: 'Admin controles QA', role: 'ADMIN', driverId: null };
    const domain = new Logistics(store);
    const command = () => ({ commandId: randomUUID() });
    const clientId = (await domain.createClient(actor, { ...await command(), name: 'Cliente controles QA' })).id;
    const driverId = (await domain.createDriver(actor, {
        ...await command(), name: 'Chofer controles QA', username: `driver-${suffix}`, password,
    })).id;
    const vehicleId = (await domain.createVehicle(actor, {
        ...await command(), plate: `CTRL-${suffix.toUpperCase()}`, capacityWeightGrams: 50000,
        capacityVolumeCm3: 50000, odometer: 100,
    })).id;
    const shipment = async () => {
        const id = (await domain.createShipment(actor, {
            ...await command(), clientId, reference: randomUUID(), originText: 'Origen QA', destinationText: 'Destino QA',
            recipientName: 'Receptor QA', recipientPhone: '', parcelCount: 1, weightGrams: 1000,
            volumeCm3: 1000, proofPolicy: 'RECEIVER',
        })).id;
        return { id, parcel: (await store.one('SELECT * FROM parcels WHERE shipment_id=?', id))! };
    };
    const route = async () => (await domain.createRoute(actor, {
        ...await command(), name: 'Ruta controles QA', driverId, vehicleId,
        startAt: new Date(Date.now() - 60000).toISOString(), endAt: new Date(Date.now() + 3600000).toISOString(),
    })).id;
    const version = async (routeId: string) => (await store.one('SELECT version FROM routes WHERE id=?', routeId))!.version as number;
    const readyAndLoaded = async (routeId: string, shipmentId: string, code: string) => {
        await domain.receive(actor, { ...await command(), shipmentId, codes: [code], location: 'Depósito QA' });
        await domain.assign(actor, routeId, { ...await command(), parcelIds: [(await store.one('SELECT id FROM parcels WHERE code=?', code))!.id], pickup: false, expectedVersion: await version(routeId) });
        await domain.ready(actor, routeId, { ...await command(), expectedVersion: await version(routeId) });
        await domain.load(actor, routeId, { ...await command(), expectedVersion: await version(routeId), code });
        await domain.inspect(actor, vehicleId, {
            ...await command(), odometer: 100, fuelPercent: 70,
            items: [{ label: 'Frenos QA', severity: 'OK', note: 'Correcto' }],
        });
    };
    const uploadPhoto = async (parcelId: string, rgb: [
        number,
        number,
        number
    ], filename: string) => (await domain.upload(actor, {
        ...await command(), parcelId, filename, mimeType: 'image/png', dataBase64: png1x1(rgb),
    })).id as string;
    return { directory, store, actor, domain, command, clientId, driverId, vehicleId, shipment, route, version, readyAndLoaded, uploadPhoto };
}
async function assertCode(work: () => unknown, code: string) {
    await assert.rejects(async () => await work(), (error: any) => error?.code === code);
}
test('Store migra una base v1 con datos y custodia existentes una sola vez', async (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'nexora-v1-migration-'));
    const databasePath = join(directory, 'legacy.sqlite');
    const raw = new DatabaseSync(databasePath);
    raw.exec('PRAGMA foreign_keys=ON');
    raw.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
    const orgId = randomUUID();
    const userId = randomUUID();
    const clientId = randomUUID();
    const shipmentId = randomUUID();
    const parcelId = randomUUID();
    const receiptId = randomUUID();
    const custodyId = randomUUID();
    const commandId = randomUUID();
    const createdAt = new Date('2025-06-01T12:00:00.000Z').toISOString();
    raw.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(1,?)').run(createdAt);
    raw.prepare('INSERT INTO organizations(id,name,timezone) VALUES(?,?,?)').run(orgId, 'Organización v1 QA', 'UTC');
    raw.prepare('INSERT INTO users(id,org_id,username,name,password_hash,role,driver_id) VALUES(?,?,?,?,?,?,NULL)')
        .run(userId, orgId, 'legacy-admin', 'Admin legacy', 'legacy-test-hash', 'ADMIN');
    raw.prepare('INSERT INTO clients(id,org_id,name) VALUES(?,?,?)').run(clientId, orgId, 'Cliente legacy QA');
    raw.prepare('INSERT INTO shipments VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(shipmentId, orgId, clientId, 'LEGACY-001', 'Origen', 'Destino', 'Receptor', '', 'RECEIVER', createdAt);
    const code = 'B-LEGACY-CUSTODY-001';
    raw.prepare('INSERT INTO parcels VALUES(?,?,?,?,?,?,?,?,?)')
        .run(parcelId, orgId, shipmentId, code, 'RECEIVED', 'DEPOT', 'DEPOT-LEGACY', 1250, 2800);
    raw.prepare('INSERT INTO receipts VALUES(?,?,?,?,?,?)')
        .run(receiptId, orgId, shipmentId, 'DEPOT-LEGACY', userId, createdAt);
    raw.prepare('INSERT INTO receipt_items(receipt_id,parcel_id) VALUES(?,?)').run(receiptId, parcelId);
    raw.prepare('INSERT INTO custody_events VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(custodyId, orgId, parcelId, userId, 'SENDER', clientId, 'DEPOT', 'DEPOT-LEGACY', 'RECEIVED', createdAt, commandId);
    raw.close();
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const migrated = new Store(databasePath);
    assert.equal((await migrated.one('SELECT count(*) AS n FROM schema_migrations WHERE version=1'))!.n, 1);
    assert.equal((await migrated.one('SELECT count(*) AS n FROM schema_migrations WHERE version=2'))!.n, 1);
    assert.equal((await migrated.one('SELECT name FROM organizations WHERE id=?', orgId))!.name, 'Organización v1 QA');
    const preservedParcel = (await migrated.one('SELECT code,state,custody_type,custody_id,weight_grams,volume_cm3 FROM parcels WHERE id=?', parcelId))!;
    assert.equal(preservedParcel.code, code);
    assert.equal(preservedParcel.state, 'RECEIVED');
    assert.equal(preservedParcel.custody_type, 'DEPOT');
    assert.equal(preservedParcel.custody_id, 'DEPOT-LEGACY');
    assert.equal(preservedParcel.weight_grams, 1250);
    assert.equal(preservedParcel.volume_cm3, 2800);
    assert.equal((await migrated.one('SELECT count(*) AS n FROM receipt_items WHERE receipt_id=? AND parcel_id=?', receiptId, parcelId))!.n, 1);
    assert.equal((await migrated.one('SELECT id,action,command_id FROM custody_events WHERE id=?', custodyId))!.command_id, commandId);
    assert.equal((await migrated.one("SELECT name FROM sqlite_master WHERE type='table' AND name='return_evidence'"))!.name, 'return_evidence');
    await migrated.close();
    const reopened = new Store(databasePath);
    assert.equal((await reopened.one('SELECT count(*) AS n FROM schema_migrations WHERE version=2'))!.n, 1);
    assert.equal((await reopened.one('SELECT count(*) AS n FROM custody_events WHERE parcel_id=?', parcelId))!.n, 1);
    assert.equal((await reopened.one('SELECT state FROM parcels WHERE id=?', parcelId))!.state, 'RECEIVED');
    await reopened.close();
});
test('documento impeditivo vencido bloquea despacho sin efectos y la renovación permite despachar', async (t) => {
    const f = await fixture(t);
    const shipment = await f.shipment();
    const routeId = await f.route();
    await f.readyAndLoaded(routeId, shipment.id, shipment.parcel.code);
    const documentId = (await createDriverDocument(f.domain, f.actor, f.driverId, {
        ...await f.command(), name: 'Permiso interno QA', expiresAt: new Date(Date.now() - 60000).toISOString(), blocksDispatch: true,
    })).id;
    const routeBefore = (await f.store.one('SELECT state,version FROM routes WHERE id=?', routeId))!;
    const custodyBefore = (await f.store.all('SELECT action,from_type,from_id,to_type,to_id FROM custody_events WHERE parcel_id=? ORDER BY rowid', shipment.parcel.id)).map(row => [row.action, row.from_type, row.from_id, row.to_type, row.to_id]);
    await assertCode(async () => await f.domain.dispatch(f.actor, routeId, { ...await f.command(), expectedVersion: await f.version(routeId) }), 'INVALID_TRANSITION');
    const routeAfterReject = (await f.store.one('SELECT state,version FROM routes WHERE id=?', routeId))!;
    assert.equal(routeAfterReject.state, routeBefore.state);
    assert.equal(routeAfterReject.version, routeBefore.version);
    assert.deepEqual((await f.store.all('SELECT action,from_type,from_id,to_type,to_id FROM custody_events WHERE parcel_id=? ORDER BY rowid', shipment.parcel.id)).map(row => [row.action, row.from_type, row.from_id, row.to_type, row.to_id]), custodyBefore);
    const renewedUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await renewDriverDocument(f.domain, f.actor, documentId, { ...await f.command(), expiresAt: renewedUntil });
    assert.equal((await f.store.one('SELECT expires_at FROM driver_documents WHERE id=?', documentId))!.expires_at, renewedUntil);
    const dispatched = await f.domain.dispatch(f.actor, routeId, { ...await f.command(), expectedVersion: await f.version(routeId) });
    assert.equal(dispatched.state, 'IN_PROGRESS');
    assert.equal((await f.store.one('SELECT state FROM routes WHERE id=?', routeId))!.state, 'IN_PROGRESS');
});
test('retorno legacy requiere subsanar evidencia por OPS y conserva custodia y pruebas', async (t) => {
    const f = await fixture(t);
    const shipment = await f.shipment();
    const routeId = await f.route();
    await f.readyAndLoaded(routeId, shipment.id, shipment.parcel.code);
    await f.domain.dispatch(f.actor, routeId, { ...await f.command(), expectedVersion: await f.version(routeId) });
    const stopId = (await f.store.one("SELECT id FROM stops WHERE route_id=? AND kind='DELIVERY'", routeId))!.id as string;
    await f.domain.attempt(f.actor, stopId, {
        ...await f.command(), expectedVersion: await f.version(routeId), deliveredParcelIds: [], failedParcelIds: [shipment.parcel.id],
        receiverName: '', evidenceIds: [], reasonCode: 'ABSENT', nextAction: 'Retornar al depósito',
    });
    const incidentId = (await f.store.one('SELECT id FROM incidents WHERE parcel_id=?', shipment.parcel.id))!.id as string;
    const authorized = await f.domain.authorizeReturn(f.actor, incidentId, await f.command());
    // Simulate a version-1 receipt: the return reached the depot before return_evidence existed.
    const legacyReceiptId = randomUUID();
    const depotLocation = 'DEPOT-LEGACY-QA';
    const legacyCommandId = randomUUID();
    await f.store.transaction(async () => {
        await f.store.run('INSERT INTO receipts VALUES(?,?,?,?,?,?)', legacyReceiptId, f.actor.orgId, shipment.id, depotLocation, f.actor.id, new Date().toISOString());
        await f.store.run('INSERT INTO receipt_items VALUES(?,?)', legacyReceiptId, shipment.parcel.id);
        await f.store.run('INSERT INTO custody_events VALUES(?,?,?,?,?,?,?,?,?,?,?)', randomUUID(), f.actor.orgId, shipment.parcel.id, f.actor.id, 'VEHICLE', f.vehicleId, 'DEPOT', depotLocation, 'RETURN_RECEIVED', new Date().toISOString(), legacyCommandId);
        await f.store.run("UPDATE parcels SET state='RETURNED_TO_DEPOT',custody_type='DEPOT',custody_id=? WHERE id=?", depotLocation, shipment.parcel.id);
        await f.store.run("UPDATE returns SET state='AT_DEPOT',depot_receipt_id=? WHERE id=?", legacyReceiptId, authorized.id);
        await f.store.run('UPDATE route_assignments SET active=0 WHERE route_id=? AND parcel_id=?', routeId, shipment.parcel.id);
        await f.store.run('UPDATE routes SET version=version+1 WHERE id=?', routeId);
    });
    assert.equal((await f.store.one('SELECT count(*) AS n FROM return_evidence WHERE return_id=?', authorized.id))!.n, 0);
    const retryRouteId = await f.route();
    const assignmentCommand = { ...await f.command(), parcelIds: [shipment.parcel.id], pickup: false, expectedVersion: await f.version(retryRouteId) };
    await assertCode(async () => await f.domain.assign(f.actor, retryRouteId, assignmentCommand), 'INVALID_TRANSITION');
    assert.equal((await f.store.one('SELECT state FROM routes WHERE id=?', retryRouteId))!.state, 'DRAFT');
    assert.equal(await f.version(retryRouteId), assignmentCommand.expectedVersion);
    assert.equal((await f.store.one('SELECT count(*) AS n FROM route_assignments WHERE route_id=? AND active=1', retryRouteId))!.n, 0);
    assert.equal((await f.store.one('SELECT count(*) AS n FROM route_assignments WHERE parcel_id=? AND active=1', shipment.parcel.id))!.n, 0);
    assert.equal(await f.store.one('SELECT command_id FROM idempotency WHERE org_id=? AND command_id=?', f.actor.orgId, assignmentCommand.commandId), undefined);
    const depotProof = await f.uploadPhoto(shipment.parcel.id, [10, 110, 180], 'depot-correction.png');
    const senderProof = await f.uploadPhoto(shipment.parcel.id, [220, 30, 90], 'sender-handover.png');
    const sameImageDifferentUpload = await f.uploadPhoto(shipment.parcel.id, [10, 110, 180], 'depot-duplicate-content.png');
    const send = async (evidenceId: string) => await f.domain.sendReturn(f.actor, authorized.id, {
        ...await f.command(), receiverName: 'Remitente QA', evidenceId,
    });
    await assertCode(() => send(senderProof), 'EVIDENCE_REQUIRED');
    assert.equal((await f.store.one('SELECT state FROM returns WHERE id=?', authorized.id))!.state, 'AT_DEPOT');
    const driverUser = (await f.store.one('SELECT id,name FROM users WHERE driver_id=? AND org_id=?', f.driverId, f.actor.orgId))!;
    const driverActor: Actor = { id: driverUser.id, orgId: f.actor.orgId, name: driverUser.name, role: 'DRIVER', driverId: f.driverId };
    const depotUserId = (await f.domain.createUser(f.actor, {
        ...await f.command(), name: 'Depósito QA', username: `depot-${randomUUID().slice(0, 8)}`, password, role: 'DEPOT',
    })).id;
    const depotUser = (await f.store.one('SELECT name FROM users WHERE id=?', depotUserId))!;
    const depotActor: Actor = { id: depotUserId, orgId: f.actor.orgId, name: depotUser.name, role: 'DEPOT', driverId: null };
    const correction = async (actor: Actor, evidenceId: string, note: string) => await f.domain.correctReturnEvidence(actor, authorized.id, {
        ...await f.command(), evidenceId, note,
    });
    await assertCode(() => correction(driverActor, depotProof, 'Registro de corrección QA'), 'FORBIDDEN');
    await assertCode(() => correction(depotActor, depotProof, 'Registro de corrección QA'), 'FORBIDDEN');
    assert.equal((await f.store.one('SELECT count(*) AS n FROM return_evidence WHERE return_id=?', authorized.id))!.n, 0);
    const priorCustody = (await f.store.all('SELECT action,from_type,from_id,to_type,to_id,command_id FROM custody_events WHERE parcel_id=? ORDER BY rowid', shipment.parcel.id)).map(row => [row.action, row.from_type, row.from_id, row.to_type, row.to_id, row.command_id]);
    const note = 'Foto de recepción recuperada del archivo QA';
    const corrected = await f.domain.correctReturnEvidence(f.actor, authorized.id, { ...await f.command(), evidenceId: depotProof, note });
    assert.equal(corrected.state, 'DEPOT_EVIDENCE_RECORDED');
    assert.deepEqual((await f.store.all('SELECT action,from_type,from_id,to_type,to_id,command_id FROM custody_events WHERE parcel_id=? ORDER BY rowid', shipment.parcel.id)).map(row => [row.action, row.from_type, row.from_id, row.to_type, row.to_id, row.command_id]), priorCustody);
    const depotEvent = (await f.store.one("SELECT evidence_id,actor_id,source,note,recorded_at FROM return_evidence WHERE return_id=? AND stage='DEPOT'", authorized.id))!;
    assert.equal(depotEvent.evidence_id, depotProof);
    assert.equal(depotEvent.actor_id, f.actor.id);
    assert.equal(depotEvent.source, 'CORRECTION');
    assert.equal(depotEvent.note, note);
    assert.ok(Number.isFinite(Date.parse(depotEvent.recorded_at)));
    await assertCode(() => correction(f.actor, sameImageDifferentUpload, 'Intento de reemplazo QA'), 'INVALID_TRANSITION');
    assert.equal((await f.store.one("SELECT evidence_id FROM return_evidence WHERE return_id=? AND stage='DEPOT'", authorized.id))!.evidence_id, depotProof);
    await assertCode(() => send(sameImageDifferentUpload), 'EVIDENCE_REQUIRED');
    const sent = await send(senderProof);
    assert.equal(sent.state, 'SENT_TO_SENDER');
    assert.deepEqual((await f.store.all('SELECT stage,evidence_id,source FROM return_evidence WHERE return_id=? ORDER BY stage', authorized.id)).map(row => [row.stage, row.evidence_id, row.source]), [
        ['DEPOT', depotProof, 'CORRECTION'], ['SENDER', senderProof, 'SENDER_HANDOVER'],
    ]);
    assert.equal((await f.store.one('SELECT state FROM parcels WHERE id=?', shipment.parcel.id))!.state, 'RETURNED_TO_SENDER');
    assert.deepEqual((await f.store.all('SELECT action FROM custody_events WHERE parcel_id=? ORDER BY rowid', shipment.parcel.id)).map(row => row.action), [
        'RECEIVED', 'LOADED', 'DISPATCHED', 'DELIVERY_FAILED', 'RETURN_RECEIVED', 'RETURNED_TO_SENDER',
    ]);
});
