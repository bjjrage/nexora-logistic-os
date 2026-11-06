import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { test } from 'node:test';
import { createApp } from '../server/app.ts';
import { Store } from '../server/db.ts';
import { Inventory } from '../server/inventory.ts';

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
  for (const [cookie,own,foreign] of [[loginA.cookie,'A','B'],[loginB.cookie,'B','A']] as const) {
    const movements=await request(f.base,'/api/inventory/movements?limit=1',{cookie});
    assert.equal(movements.status,200);assert.equal(movements.body.items.length,1);
    assert.match(movements.body.items[0].sku,new RegExp('AUDIT-'+own));
    for(const path of ['/api/inventory/movements/export.csv','/api/orders/export.csv']){
      const exported=await request(f.base,path+'?clientId='+f.clients[own==='A'?1:0],{cookie});
      assert.equal(exported.status,200);assert.match(exported.body.raw,new RegExp('AUDIT-'+own));
      assert.doesNotMatch(exported.body.raw,new RegExp('AUDIT-'+foreign+'-|AUDIT-ORDER-'+foreign));
    }
  }

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
  for(const path of ['/api/inventory/movements','/api/inventory/movements/export.csv','/api/orders/export.csv']){
    assert.equal((await request(f.base,path,{cookie:loginA.cookie})).status,401);
    assert.equal((await request(f.base,path,{cookie:driverLogin.cookie})).status,403);
    assert.equal((await request(f.base,path)).status,401);
  }
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

test('depósito: accesos filtrados por cliente, reactivación auditada y sesiones revocadas permanecen inválidas',async t=>{
  const f=await fixture(t);
  const second=await f.addAccount(f.clients[0],'customer-a-second');assert.equal(second.status,200);
  const scoped=await request(f.base,'/api/customer-access?clientId='+f.clients[0],{cookie:f.adminCookie});
  assert.equal(scoped.status,200);assert.equal(scoped.body.items.length,2);
  assert.ok(scoped.body.items.every((item:Json)=>item.clientId===f.clients[0]&&!('passwordHash' in item)));
  assert.equal((await request(f.base,'/api/customer-access?clientId=invalid',{cookie:f.adminCookie})).status,400);
  const foreignOrg=randomUUID(),foreignClient=randomUUID(),foreignAccount=randomUUID();
  await f.store.run('INSERT INTO organizations VALUES(?,?,?)',foreignOrg,'Otra organización','UTC');
  await f.store.run('INSERT INTO clients VALUES(?,?,?)',foreignClient,foreignOrg,'Cliente privado');
  await f.store.run('INSERT INTO customer_accounts(id,org_id,client_id,name,username,password_hash,enabled,created_at) VALUES(?,?,?,?,?,?,0,?)',foreignAccount,foreignOrg,foreignClient,'Privado','foreign-'+foreignAccount,'unusable-fixture',new Date().toISOString());
  assert.equal((await request(f.base,'/api/customer-access?clientId='+foreignClient,{cookie:f.adminCookie})).status,404);
  assert.equal((await f.post('/api/customer-access/'+foreignAccount+'/enable',{commandId:f.command()})).status,404);
  const a=await login(f.base,'customer-a'),other=await login(f.base,'customer-a-second');
  assert.equal((await request(f.base,'/api/customer-access/'+f.b+'/enable',{method:'POST',cookie:a.cookie,body:{commandId:f.command()}})).status,403);
  assert.equal((await f.post('/api/customer-access/'+f.a+'/revoke',{commandId:f.command()})).status,200);
  assert.equal((await request(f.base,'/api/inventory',{cookie:other.cookie})).status,200);
  const commandId=f.command();
  for(let i=0;i<2;i++)assert.equal((await f.post('/api/customer-access/'+f.a+'/enable',{commandId})).status,200);
  assert.equal((await request(f.base,'/api/inventory',{cookie:a.cookie})).status,401);
  assert.equal((await login(f.base,'customer-a')).status,200);
  assert.equal((await f.store.one('SELECT COUNT(*) AS n FROM audit WHERE org_id=? AND command_id=?', (await f.store.one('SELECT org_id FROM customer_accounts WHERE id=?',f.a))!.org_id,commandId))!.n,1);
  const operations=await f.post('/api/users',{commandId:f.command(),name:'Coordinación',username:'portal-operations',password,role:'OPERATIONS'});assert.equal(operations.status,200);
  const ops=await login(f.base,'portal-operations');
  assert.equal((await request(f.base,'/api/customer-access?clientId='+f.clients[0],{cookie:ops.cookie})).status,403);
  assert.equal((await request(f.base,'/api/customer-access/'+f.a+'/enable',{method:'POST',cookie:ops.cookie,body:{commandId:f.command()}})).status,403);
});

test('portal: historial completo paginado, CSV sin truncar y protección de fórmulas; el cliente solo consulta',async t=>{
  const f=await fixture(t),a=await login(f.base,'customer-a');
  const actor=(await f.store.one('SELECT id,org_id FROM users WHERE username=?','audit-admin'))!;
  for(let i=0;i<501;i++)await f.store.run('INSERT INTO inventory_movements(id,org_id,client_id,product_id,quantity,to_location_id,action,reference,actor_id,command_id,created_at) VALUES(?,?,?,?,1,?,?,?,?,?,?)',randomUUID(),actor.org_id,f.clients[0],f.productA,f.locationId,'RECEIVE','HISTORY-'+i,actor.id,randomUUID(),'2026-11-01T00:00:00.000Z');
  const first=await request(f.base,'/api/inventory/movements?limit=200',{cookie:a.cookie});
  const last=await request(f.base,'/api/inventory/movements?limit=200&offset=400',{cookie:a.cookie});
  assert.equal(first.body.total,503);assert.equal(first.body.items.length,200);assert.equal(last.body.items.length,103);
  assert.ok(!last.body.items.some((row:Json)=>first.body.items.some((item:Json)=>item.id===row.id)));
  const search=await request(f.base,'/api/inventory/movements?q=HISTORY-500',{cookie:a.cookie});assert.equal(search.body.total,1);
  const all=await request(f.base,'/api/inventory/movements/export.csv?limit=1&offset=400',{cookie:a.cookie});
  assert.equal(all.body.raw.trim().split('\r\n').length,504);
  for(const [offset,length] of [[0,200],[200,5]])await f.post('/api/orders/import',{commandId:f.command(),orders:Array.from({length},(_,i)=>({clientId:f.clients[0],externalId:'BULK-'+(offset+i),orderDate:'2026-11-01',destination:'Destino',recipientName:'Persona',lines:[{productId:f.productA,quantity:1}]}))}).then(result=>assert.equal(result.status,201));
  const orders=await request(f.base,'/api/orders/export.csv?limit=1&offset=100',{cookie:a.cookie});
  assert.equal(orders.body.raw.trim().split('\r\n').length,207);assert.doesNotMatch(orders.body.raw,/AUDIT-ORDER-B/);
  await f.store.run('UPDATE inventory_orders SET destination=?,recipient_name=? WHERE id=?',' =SUM(1,1)','@PERSONA',f.orderA);
  const safeOrders=await request(f.base,'/api/orders/export.csv',{cookie:a.cookie});
  assert.ok(safeOrders.body.raw.includes('"\' =SUM(1,1)"'));assert.ok(safeOrders.body.raw.includes('"\'@PERSONA"'));
  const forbiddenBodies:[string,Json][]=[
    ['/api/inventory/receipts',{clientId:f.clients[0],productId:f.productA,locationId:f.locationId,quantity:1}],
    ['/api/inventory/movements',{clientId:f.clients[0],productId:f.productA,fromLocationId:f.locationId,toLocationId:f.foreignLocationId,quantity:1}],
    ['/api/inventory/adjustments',{clientId:f.clients[0],productId:f.productA,locationId:f.locationId,quantityDelta:1,reason:'Intento'}],
    ['/api/orders',{clientId:f.clients[0],externalId:'FORBIDDEN',orderDate:'2026-11-01',destination:'Destino',recipientName:'Persona',lines:[{productId:f.productA,quantity:1}]}],
    ['/api/orders/'+f.orderA+'/reserve',{}]
  ];
  for(const [path,body] of forbiddenBodies)assert.equal((await request(f.base,path,{method:'POST',cookie:a.cookie,body:{commandId:f.command(),...body}})).status,403,path);
  const inventory=new Inventory(f.store),missingClient={id:f.a,orgId:actor.org_id,name:'Sin cliente',role:'CUSTOMER',clientId:null,driverId:null};
  for(const read of [()=>inventory.movementsPage(missingClient),()=>inventory.exportMovementsCsv(missingClient),()=>inventory.exportOrdersCsv(missingClient)])await assert.rejects(read,(error:any)=>error.code==='FORBIDDEN');
});
