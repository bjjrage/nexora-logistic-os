import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { test } from 'node:test';
import { createApp } from '../server/app.ts';
import { Store } from '../server/db.ts';

type Json = Record<string, any>;
type Reply = { status: number; body: Json; cookie?: string };
const password = 'Audit-Customer-QA-2026!';

async function fixture(t: any) {
  const directory = mkdtempSync(join(tmpdir(), 'nexora-customer-audit-'));
  const store = new Store(join(directory, 'customer.sqlite'));
  const server: Server = createApp(store).listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const adminLogin = await request(base, '/api/setup', {
    method: 'POST', body: { organizationName: 'Auditoría clientes', timezone: 'America/Asuncion', username: 'audit-admin', password },
  });
  assert.equal(adminLogin.status, 201);
  const adminCookie = adminLogin.cookie!;
  const command = () => randomUUID();
  const post = (path: string, body: Json) => request(base, path, { method: 'POST', cookie: adminCookie, body });
  const clients = await Promise.all(['Cliente A', 'Cliente B'].map(async name => {
    const result = await post('/api/clients', { commandId: command(), name });
    assert.equal(result.status, 200);
    return result.body.id as string;
  }));
  const addAccount = (clientId: string, username: string) => post('/api/customer-access', {
    commandId: command(), clientId, name: `Usuario ${username}`, username, password,
  });
  const a = await addAccount(clients[0], 'customer-a');
  const b = await addAccount(clients[1], 'customer-b');
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const location = await post('/api/inventory/locations', { commandId: command(), code: 'AUDIT-DEPOT', name: 'Depósito de auditoría', kind: 'DEPOT' });
  assert.equal(location.status, 201);
  const foreignLocation = await post('/api/inventory/locations', { commandId: command(), code: 'AUDIT-B-PRIVATE', name: 'Ubicación exclusiva cliente B', kind: 'STORAGE' });
  assert.equal(foreignLocation.status, 201);
  const product = async (clientId: string, sku: string, tracking: 'QUANTITY' | 'SERIAL') => await post('/api/inventory/products', {
    commandId: command(), clientId, sku, barcode: null, name: `Producto ${sku}`, tracking, unit: 'unidad', weightGrams: 100, volumeCm3: 100,
  });
  const productA = await product(clients[0], 'AUDIT-A-QTY', 'QUANTITY');
  const productB = await product(clients[1], 'AUDIT-B-QTY', 'QUANTITY');
  const serialProductA = await product(clients[0], 'AUDIT-A-SERIAL', 'SERIAL');
  assert.equal(productA.status, 201);
  assert.equal(productB.status, 201);
  assert.equal(serialProductA.status, 201);
  for (const [clientId, productId, quantity, serials, locationId] of [
    [clients[0], productA.body.id, 5, undefined, location.body.id],
    [clients[1], productB.body.id, 7, undefined, foreignLocation.body.id],
    [clients[0], serialProductA.body.id, 1, [{ serial: 'AUDIT-SERIAL-A-1' }], location.body.id],
  ] as const) {
    const receipt = await post('/api/inventory/receipts', { commandId: command(), clientId, productId, locationId, quantity, serials, reference: 'AUDIT-RECEIPT' });
    assert.equal(receipt.status, 200);
  }
  const order = async (clientId: string, externalId: string, productId: string) => await post('/api/orders', {
    commandId: command(), clientId, externalId, orderDate: '2026-10-15', destination: `Destino ${externalId}`, recipientName: `Receptor ${externalId}`,
    recipientPhone: '', originText: 'Depósito', proofPolicy: 'RECEIVER_PHOTO', lines: [{ productId, quantity: 1 }],
  });
  const orderA = await order(clients[0], 'AUDIT-ORDER-A', productA.body.id);
  const orderB = await order(clients[1], 'AUDIT-ORDER-B', productB.body.id);
  assert.equal(orderA.status, 201);
  assert.equal(orderB.status, 201);
  return { base, store, adminCookie, command, post, addAccount, clients, a: a.body.id as string, b: b.body.id as string, locationId: location.body.id as string, foreignLocationId: foreignLocation.body.id as string, productA: productA.body.id as string, productB: productB.body.id as string, serialProductA: serialProductA.body.id as string, orderA: orderA.body.id as string, orderB: orderB.body.id as string };
}

async function request(base: string, path: string, options: {
  method?: string; cookie?: string; body?: Json;
} = {}): Promise<Reply> {
  const headers: Record<string, string> = { 'X-Requested-With': 'logistics-os' };
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? 'GET', headers,
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const text = await response.text();
  let body: Json = {};
  try { body = text ? JSON.parse(text) as Json : {}; } catch { body = { raw: text }; }
  const setCookie = response.headers.get('set-cookie');
  return { status: response.status, body, ...(setCookie ? { cookie: setCookie.split(';')[0] } : {}) };
}

async function login(base: string, username: string): Promise<Reply> {
  return await request(base, '/api/login', { method: 'POST', body: { username, password } });
}

test('auditoría: sesiones de dos clientes quedan aisladas de las APIs internas y la revocación expira la sesión', async t => {
  const f = await fixture(t);
  const [loginA, loginB] = await Promise.all([login(f.base, 'customer-a'), login(f.base, 'customer-b')]);
  assert.equal(loginA.status, 200);
  assert.equal(loginB.status, 200);
  assert(loginA.cookie && loginB.cookie);

  const [sessionA, sessionB] = await Promise.all([
    request(f.base, '/api/session', { cookie: loginA.cookie }),
    request(f.base, '/api/session', { cookie: loginB.cookie }),
  ]);
  assert.equal(sessionA.body.user.role, 'CUSTOMER');
  assert.equal(sessionA.body.user.clientId, f.clients[0]);
  assert.equal(sessionB.body.user.role, 'CUSTOMER');
  assert.equal(sessionB.body.user.clientId, f.clients[1]);

  const inventoryA = await request(f.base, '/api/inventory', { cookie: loginA.cookie });
  assert.equal(inventoryA.status, 200);
  assert.deepEqual(inventoryA.body.products.map((item: Json) => item.sku).sort(), ['AUDIT-A-QTY', 'AUDIT-A-SERIAL']);
  assert.equal(inventoryA.body.balances.every((item: Json) => item.clientId === f.clients[0]), true);
  assert.equal(inventoryA.body.locations.some((item: Json) => item.code === 'AUDIT-B-PRIVATE'), false);
  const forcedClientB = await request(f.base, `/api/inventory?clientId=${f.clients[1]}`, { cookie: loginA.cookie });
  assert.equal(forcedClientB.status, 200);
  assert.deepEqual(forcedClientB.body.products.map((item: Json) => item.sku).sort(), ['AUDIT-A-QTY', 'AUDIT-A-SERIAL']);
  assert.equal(forcedClientB.body.locations.some((item: Json) => item.code === 'AUDIT-B-PRIVATE'), false);
  const inventoryB = await request(f.base, '/api/inventory', { cookie: loginB.cookie });
  assert.equal(inventoryB.body.locations.some((item: Json) => item.code === 'AUDIT-B-PRIVATE'), true);
  const ordersA = await request(f.base, '/api/orders/read', { cookie: loginA.cookie });
  assert.equal(ordersA.status, 200);
  assert.deepEqual(ordersA.body.items.map((item: Json) => item.externalId), ['AUDIT-ORDER-A']);
  const foreignOrder = await request(f.base, `/api/orders/${f.orderB}`, { cookie: loginA.cookie });
  assert.ok(foreignOrder.status === 403 || foreignOrder.status === 404);
  assert.equal(foreignOrder.body.externalId, undefined);
  const csvA = await request(f.base, '/api/inventory/export.csv', { cookie: loginA.cookie });
  assert.equal(csvA.status, 200);
  assert.match(csvA.body.raw, /AUDIT-A-QTY/);
  assert.doesNotMatch(csvA.body.raw, /AUDIT-B-QTY/);
  assert.match(csvA.body.raw, /AUDIT-A-SERIAL/, 'El CSV debe incluir las unidades serializadas visibles en el portal.');

  const driver = await f.post('/api/drivers', { commandId: f.command(), name: 'Chofer interno', username: 'audit-driver', password });
  assert.equal(driver.status, 200);
  const driverLogin = await login(f.base, 'audit-driver');
  assert.equal(driverLogin.status, 200);
  assert.equal((await request(f.base, '/api/inventory', { cookie: driverLogin.cookie })).status, 403);
  assert.equal((await request(f.base, '/api/inventory/export.csv', { cookie: driverLogin.cookie })).status, 403);

  for (const cookie of [loginA.cookie, loginB.cookie]) {
    assert.equal((await request(f.base, '/api/bootstrap', { cookie })).status, 403);
    assert.equal((await request(f.base, '/api/shipments', { cookie })).status, 403);
    assert.equal((await request(f.base, '/api/customer-access', { cookie })).status, 403);
  }

  const revoked = await f.post(`/api/customer-access/${f.a}/revoke`, { commandId: f.command() });
  assert.equal(revoked.status, 200);
  assert.equal((await request(f.base, '/api/session', { cookie: loginA.cookie })).body.user, null);
  assert.equal((await request(f.base, '/api/bootstrap', { cookie: loginA.cookie })).status, 401);
  assert.equal((await login(f.base, 'customer-a')).status, 401);
  assert.equal((await request(f.base, '/api/session', { cookie: loginB.cookie })).body.user.clientId, f.clients[1]);
});

test('auditoría: usuario interno y usuario cliente no pueden compartir nombre de acceso', async t => {
  const f = await fixture(t);
  const internalFirst = await f.post('/api/users', {
    commandId: f.command(), name: 'Usuario interno', username: 'shared-login-a', password, role: 'OPERATIONS',
  });
  assert.equal(internalFirst.status, 200);
  assert.equal((await f.addAccount(f.clients[0], 'shared-login-a')).status, 409);

  const customerFirst = await f.addAccount(f.clients[0], 'shared-login-b');
  assert.equal(customerFirst.status, 200);
  const internalSecond = await f.post('/api/users', {
    commandId: f.command(), name: 'Usuario interno B', username: 'shared-login-b', password, role: 'OPERATIONS',
  });
  assert.equal(internalSecond.status, 409);
});

test('auditoría: el rol DRIVER no puede consultar ni exportar el inventario completo del tenant', async t => {
  const f = await fixture(t);
  const driver = await f.post('/api/drivers', { commandId: f.command(), name: 'Chofer interno', username: 'audit-driver-only', password });
  assert.equal(driver.status, 200);
  const driverLogin = await login(f.base, 'audit-driver-only');
  assert.equal(driverLogin.status, 200);
  assert.equal((await request(f.base, '/api/inventory', { cookie: driverLogin.cookie })).status, 403);
  assert.equal((await request(f.base, '/api/orders/read', { cookie: driverLogin.cookie })).status, 403);
  assert.equal((await request(f.base, '/api/inventory/export.csv', { cookie: driverLogin.cookie })).status, 403);
});
