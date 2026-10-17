import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Store } from '../server/db.ts';
import { setup, type Actor } from '../server/auth.ts';
import { Logistics } from '../server/domain.ts';
import { QuadOperations, verifyQuadSignature, type OperationsConfig } from '../server/quad-operations.ts';
import { DomainError } from '../server/errors.ts';
import { isPublicAddress } from '../server/proof-download.ts';

const password = 'Audit-Quad-QA-2026!';
async function fixture(t: any) {
  const directory = mkdtempSync(join(tmpdir(), 'nexora-quad-audit-'));
  const store = new Store(join(directory, 'quad.sqlite'));
  t.after(async () => { await store.close(); rmSync(directory, { recursive: true, force: true }); });
  const { userId, orgId } = await setup(store, { organizationName: 'Auditoría Quad', timezone: 'UTC', username: 'quad-admin', password });
  const actor: Actor = { id: userId, orgId, name: 'Admin Quad', role: 'ADMIN', driverId: null };
  const domain = new Logistics(store);
  const command = () => ({ commandId: randomUUID() });
  const clientId = (await domain.createClient(actor, { ...command(), name: 'Cliente Quad' })).id;
  const shipment = async (reference: string) => {
    const id = (await domain.createShipment(actor, { ...command(), clientId, reference, originText: 'Depósito QA', destinationText: 'Destino QA', recipientName: 'Receptor QA', recipientPhone: '', parcelCount: 1, weightGrams: 1000, volumeCm3: 1000, proofPolicy: 'RECEIVER' })).id;
    const parcels = await store.all('SELECT * FROM parcels WHERE shipment_id=?', id);
    return { id, parcel: parcels[0] };
  };
  const config: OperationsConfig = { orgId, apiKey: 'fixture-secret', webhookSecret: 'webhook-secret', proofHosts: [], deliveredCodes: [70], failedCodes: [80], constraints: [] };
  return { store, actor, domain, command, clientId, shipment, config };
}

test('auditoría Quad: webhook exige HMAC y un entregado sin foto/firma queda comunicado pero no certificado', async t => {
  const f = await fixture(t), item = await f.shipment('QUAD-PROOF-QA');
  const quad = new QuadOperations(f.store, f.config, async () => new Response('{}', { status: 200 }));
  await f.store.run(`INSERT INTO quad_parcel_links(org_id,parcel_id,external_code,external_order_id,poi_id,delivery_date,payload,state,updated_at)
    VALUES(?,?,?,?,?,?,?,'EXPORTED',?)`, f.actor.orgId, item.parcel.id, 'NX-PROOF-QA', '90001', 25, '2026-10-15', '{}', new Date().toISOString());
  const raw = Buffer.from(JSON.stringify({ event: 'tracking.entregado', code: 'NX-PROOF-QA' }));
  const signature = createHmac('sha256', f.config.webhookSecret!).update(raw).digest('base64');
  assert.equal(verifyQuadSignature(raw, signature, f.config.webhookSecret!), true);
  assert.equal(verifyQuadSignature(raw, signature, 'different-secret'), false);
  await assert.rejects(quad.webhook(raw, 'bad-signature'), (error: any) => error.code === 'FORBIDDEN');
  const reported = await quad.webhook(raw, signature);
  assert.equal(reported.state, 'REPORTED');
  const link = await f.store.one('SELECT provider_result,evidence_state FROM quad_parcel_links WHERE parcel_id=?', item.parcel.id);
  assert.equal(link?.provider_result, 'DELIVERED');
  assert.equal(link?.evidence_state, 'MISSING');
  assert.equal((await f.store.one('SELECT state FROM parcels WHERE id=?', item.parcel.id))?.state, 'EXPECTED');
  assert.equal((await quad.webhook(raw, signature)).duplicate, true);
});

test('auditoría Quad: eventos válidos fuera de secuencia quedan pendientes sin descartar el resto de la sincronización', async t => {
  const f = await fixture(t);
  const first = await f.shipment('QUAD-FIRST-QA'), second = await f.shipment('QUAD-SECOND-QA');
  for (const item of [first, second]) await f.domain.receive(f.actor, { ...f.command(), shipmentId: item.id, codes: [item.parcel.code], location: 'QA-DEPOT' });
  const driverId = (await f.domain.createDriver(f.actor, { ...f.command(), name: 'Chofer QA', username: 'quad-driver', password })).id;
  const vehicleId = (await f.domain.createVehicle(f.actor, { ...f.command(), plate: 'QA-QUAD-1', capacityWeightGrams: 10000, capacityVolumeCm3: 10000, odometer: 0 })).id;
  const routeId = (await f.domain.createRoute(f.actor, { ...f.command(), name: 'Ruta QA', driverId, vehicleId, startAt: '2026-10-15T08:00:00.000Z', endAt: '2026-10-15T18:00:00.000Z' })).id;
  await f.domain.assign(f.actor, routeId, { ...f.command(), parcelIds: [first.parcel.id, second.parcel.id], pickup: false, expectedVersion: 1 });
  await f.store.run("UPDATE routes SET state='IN_PROGRESS' WHERE id=?", routeId);
  for (const parcel of [first.parcel, second.parcel]) await f.store.run("UPDATE parcels SET state='IN_TRANSIT',custody_type='VEHICLE',custody_id=? WHERE id=?", vehicleId, parcel.id);
  for (const [parcel, external, result] of [[first.parcel, '90011', 'PENDING'], [second.parcel, '90012', 'FAILED']] as const) {
    await f.store.run(`INSERT INTO quad_parcel_links(org_id,parcel_id,external_code,external_order_id,poi_id,delivery_date,payload,state,updated_at,provider_result,evidence_state)
      VALUES(?,?,?,?,?,?,?,'EXPORTED',?,?, 'MISSING')`, f.actor.orgId, parcel.id, `NX-${external}`, external, 25, '2026-10-15', '{}', new Date().toISOString(), result);
  }
  const quad = new QuadOperations(f.store, f.config);
  const result = await quad.reconcile(f.actor, routeId);
  assert.equal(result.applied.length, 1);
  assert.equal(result.applied[0].pending, true, 'La segunda parada debe quedar explícitamente pendiente de la primera.');
  assert.equal(result.applied[0].code, 'INVALID_TRANSITION');
  assert.equal((await f.store.one('SELECT state FROM parcels WHERE id=?', second.parcel.id))?.state, 'IN_TRANSIT');
});

test('auditoría Quad: permite preparar la cola sin credenciales, pero no procesarla', async t => {
  const f = await fixture(t), item = await f.shipment('QUAD-QUEUE-QA');
  await f.domain.receive(f.actor, { ...f.command(), shipmentId: item.id, codes: [item.parcel.code], location: 'QA-DEPOT' });
  const quad = new QuadOperations(f.store, null);
  const queued = await quad.queue(f.actor, item.id, { ...f.command(), poiId: 25, date: '2026-10-15' });
  assert.equal(queued.queued, 1);
  assert.equal((await f.store.one('SELECT state FROM quad_parcel_links WHERE parcel_id=?', item.parcel.id))?.state, 'QUEUED');
  await assert.rejects(quad.process(f.actor), (error: any) => error instanceof DomainError && error.code === 'INTEGRATION_NOT_CONFIGURED');
  assert.equal((await f.store.one('SELECT state FROM quad_parcel_links WHERE parcel_id=?', item.parcel.id))?.state, 'QUEUED');
});

test('auditoría Quad: proceso configurado recalcula y transmite las medidas de la unidad', async t => {
  const f = await fixture(t), item = await f.shipment('QUAD-MEASURES-QA');
  await f.domain.receive(f.actor, { ...f.command(), shipmentId: item.id, codes: [item.parcel.code], location: 'QA-DEPOT' });
  const config = { ...f.config, constraints: [
    { id: 101, source: 'UNITS' as const }, { id: 102, source: 'WEIGHT_KG' as const }, { id: 103, source: 'VOLUME_M3' as const },
  ] };
  const sent: unknown[] = [];
  const request: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('/orders/search?')) return new Response(JSON.stringify({ data: [] }), { status: 200 });
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ data: [{ code: `NX-${item.parcel.id.replaceAll('-', '')}`, _id: 90031, poiId: 25, date: '2026-10-15' }] }), { status: 200 });
  };
  const quad = new QuadOperations(f.store, config, request);
  await quad.queue(f.actor, item.id, { ...f.command(), poiId: 25, date: '2026-10-15' });
  const prepared = await f.store.one('SELECT payload FROM quad_parcel_links WHERE parcel_id=?', item.parcel.id);
  assert(prepared);
  assert.equal(JSON.parse(prepared.payload).orderMeasures.length, 3);
  const result = await quad.process(f.actor);
  assert.equal(result.results[0].state, 'EXPORTED');
  assert.deepEqual(sent[0], [{ poiId: 25, code: `NX-${item.parcel.id.replaceAll('-', '')}`, date: '2026-10-15', operation: 'PEDIDO', orderMeasures: [
    { constraintId: 101, value: 1 }, { constraintId: 102, value: 1 }, { constraintId: 103, value: 0.001 },
  ] }]);
  assert.equal((await f.store.one('SELECT state,external_order_id FROM quad_parcel_links WHERE parcel_id=?', item.parcel.id))?.external_order_id, '90031');
});

test('auditoría Quad: una descarga de comprobante fuera de host permitido nunca toca la red', async t => {
  const f = await fixture(t), item = await f.shipment('QUAD-SSRF-QA');
  let calls = 0;
  const quad = new QuadOperations(f.store, f.config, async () => { calls++; return new Response('unexpected'); });
  await assert.rejects(quad.saveProof(f.actor, item.parcel.id, 'PHOTO', 'https://attacker.invalid/proof.png'), (error: any) => error.code === 'QUADMINDS_PROOF_UNAVAILABLE');
  assert.equal(calls, 0);
});

test('auditoría Quad: la lista de IPs públicas bloquea rangos privados IPv4 e IPv6', () => {
  for (const address of ['0.1.2.3', '10.1.2.3', '100.100.100.200', '127.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.1', '224.0.0.1', '::', '::1', '::ffff:169.254.169.254', 'fc00::1', 'fe80::1', 'ff02::1', '2001:db8::1',
    '64:ff9b::a9fe:a9fe', '64:ff9b:1::a9fe:a9fe', '100::1', '100:0:0:1::1', '2001:2::1', '2001:10::1', '3fff::1', '5f00::1', '2002:a9fe:a9fe::1']) {
    assert.equal(isPublicAddress(address), false, `${address} debe rechazarse`);
  }
  for (const address of ['8.8.8.8', '203.0.114.1', '2606:4700:4700::1111']) {
    assert.equal(isPublicAddress(address), true, `${address} debe aceptarse como dirección pública`);
  }
});
