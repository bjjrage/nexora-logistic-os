import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Store } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import { setup, hash } from '../server/auth.ts';
import { Diagnostics } from '../server/observability.ts';
import { createAlertingSink } from '../server/alerts.ts';
import { createClientDiagnostics } from '../frontend/diagnostics.ts';
import { sourcePosition } from '../shared/telemetry.ts';

test('cliente envía al endpoint real la posición sanitizada del bundle', async t => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const ids = await setup(store, { organizationName: 'QA', timezone: 'UTC', username: 'telemetry-qa', password: 'QA-Telemetry-2026!' });
  const token = randomBytes(32).toString('hex');
  await store.run('INSERT INTO sessions VALUES(?,?,?)', hash(token), ids.userId, new Date(Date.now() + 60_000).toISOString());
  const entries: Record<string, unknown>[] = [];
  const server = createApp(store, undefined, undefined, new Diagnostics(entry => entries.push(entry))).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let responseStatus: number | undefined;
  let finished!: () => void;
  const requestFinished = new Promise<void>(resolve => { finished = resolve; });
  const report = createClientDiagnostics(async (input, init) => {
    const response = await fetch(new URL(String(input), origin), { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), Cookie: `logistics_session=${token}`, Origin: origin } });
    responseStatus = response.status;
    finished();
    return response;
  });
  report('UI_ERROR', 'window', undefined, sourcePosition('Error: private text\n at render (https://nexora.example/assets/index-aB_9.js:123:45)'));
  await requestFinished;
  assert.equal(responseStatus, 202);
  const event = entries.find(entry => entry.event === 'client.error');
  assert.deepEqual(event && { kind: event.kind, component: event.component, position: event.position }, {
    kind: 'UI_ERROR', component: 'window', position: { file: 'index-aB_9.js', line: 123, column: 45 },
  });
  assert.doesNotMatch(JSON.stringify(event), /private text|nexora\.example/);
  assert.equal(sourcePosition('Error at /assets/index-a.js:10000001:1'), undefined);
  const rejected = await fetch(`${origin}/api/diagnostics/events`, { method: 'POST', headers: { Cookie: `logistics_session=${token}`, 'X-Requested-With': 'logistics-os', 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ kind: 'UI_ERROR', component: 'window', position: { file: '../secret.js', line: 1, column: 1 } }) });
  assert.equal(rejected.status, 400);
});

test('alertas persisten el rechazo 503 y reintentan hasta confirmar entrega', async t => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const logs: Record<string, unknown>[] = [];
  const sent: Record<string, unknown>[] = [];
  const sink = createAlertingSink(store, entry => logs.push(entry), {
    url: 'https://alerts.example.test/hook', autoStart: false, maxAttempts: 2,
    retryDelaysMs: [0], minimumIntervalMs: 0,
    fetcher: async (_url, init) => {
      sent.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: sent.length === 1 ? 503 : 204 });
    },
  });
  sink.handle({ event: 'server.error', requestId: randomUUID(), errorType: 'DatabaseError', message: 'PRIVATE_INPUT' });
  await sink.flush();
  const row = await store.one('SELECT attempts,delivered_at,failed_at,payload FROM alert_outbox');
  assert.equal(sent.length, 2);
  assert.equal(row?.attempts, 2);
  assert.ok(row?.delivered_at);
  assert.equal(row?.failed_at, null);
  assert.match(JSON.stringify(logs), /alert\.delivery_retry/);
  assert.doesNotMatch(row?.payload ?? '', /PRIVATE_INPUT/);
  sink.close();
});

test('una respuesta 503 no activa el límite de frecuencia ni descarta el siguiente error', async t => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const sent: Record<string, unknown>[] = [];
  const requestIds = [randomUUID(), randomUUID()];
  const sink = createAlertingSink(store, () => {}, {
    url: 'https://alerts.example.test/hook', autoStart: false, maxAttempts: 3,
    retryDelaysMs: [0, 0], minimumIntervalMs: 60_000,
    fetcher: async (_url, init) => {
      sent.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: sent.length === 1 ? 503 : 204 });
    },
  });
  for (const requestId of requestIds) sink.handle({ event: 'server.error', requestId, errorType: 'DatabaseError' });
  await sink.flush();
  const rows = await store.all('SELECT request_id,attempts,delivered_at,failed_at FROM alert_outbox ORDER BY request_id');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.request_id).sort(), [...requestIds].sort());
  assert.equal(sent.length, 2);
  assert.equal(rows.filter(row => row.delivered_at).length, 1);
  assert.equal(rows.filter(row => !row.delivered_at && !row.failed_at).length, 1, 'el aviso rechazado sigue en outbox para reintento tras la ventana de frecuencia');
  sink.close();
});

test('alerta agotada deja una falla correlacionada y la cola retiene el estado', async t => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const logs: Record<string, unknown>[] = [];
  const requestId = randomUUID();
  const sink = createAlertingSink(store, entry => logs.push(entry), {
    url: 'https://alerts.example.test/hook', autoStart: false, maxAttempts: 2,
    retryDelaysMs: [0], minimumIntervalMs: 0,
    fetcher: async () => new Response(null, { status: 503 }),
  });
  sink.handle({ event: 'inventory.mismatch', requestId, errorType: 'InventoryMismatch' });
  await sink.flush();
  const row = await store.one('SELECT attempts,failed_at,delivered_at FROM alert_outbox');
  assert.equal(row?.attempts, 2);
  assert.ok(row?.failed_at);
  assert.equal(row?.delivered_at, null);
  const failure = logs.find(entry => entry.event === 'alert.delivery_failed');
  assert.equal(failure?.requestId, requestId);
  assert.equal(failure?.relatedEvent, 'inventory.mismatch');
  assert.equal(failure?.attempts, 2);
  sink.close();
});

