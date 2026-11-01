import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import { passwordHash } from '../server/auth.ts';
import { PasswordRecovery } from '../server/password-recovery.ts';

const command = () => ({ commandId: randomUUID() });

test('HTTP credentials accepted for driver access authenticate; invalid limits fail before writes and revocation clears sessions', async t => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const server = createApp(store).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));

  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (path: string, body: unknown, cookie = '') => fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'logistics-os', Cookie: cookie },
    body: JSON.stringify(body),
  });
  const setup = await post('/api/setup', { organizationName: 'Credenciales QA', timezone: 'UTC', username: 'qa.admin', password: 'QA-Credentials-2026!' });
  assert.equal(setup.status, 201);
  const adminCookie = setup.headers.get('set-cookie')!.split(';')[0];
  const identity = await setup.json() as { id: string };
  const admin = await store.one('SELECT org_id FROM users WHERE id=?', identity.id);
  assert.ok(admin);

  const createdDriver = await post('/api/drivers', { ...command(), name: 'Chofer QA', username: 'driver.initial', password: 'QA-Driver-2026!' }, adminCookie);
  assert.equal(createdDriver.status, 200);
  const driver = await createdDriver.json() as { id: string };
  const oldAccess = await store.one('SELECT id FROM users WHERE driver_id=? AND password_hash<>?', driver.id, '!deleted');
  assert.ok(oldAccess);
  assert.equal((await post(`/api/users/${oldAccess.id}/delete`, command(), adminCookie)).status, 200);

  const accessPath = `/api/drivers/${driver.id}/access`;
  for (const username of ['u'.repeat(81), 'u'.repeat(100), 'has space', 'áccent', 'bad\u0000name']) {
    const result = await post(accessPath, { ...command(), username, password: 'QA-Driver-2026!' }, adminCookie);
    assert.equal(result.status, 400, `username boundary should reject length ${username.length}`);
  }
  for (const password of ['p'.repeat(5), 'p'.repeat(129), 'p'.repeat(200)]) {
    const result = await post(accessPath, { ...command(), username: 'driver.valid', password }, adminCookie);
    assert.equal(result.status, 400, `password boundary should reject length ${password.length}`);
  }
  assert.equal((await store.one('SELECT COUNT(*) AS n FROM users WHERE driver_id=? AND password_hash<>?', driver.id, '!deleted'))!.n, 0);

  const username = 'd'.repeat(80), password = 'P'.repeat(128);
  const created = await post(accessPath, { ...command(), username, password }, adminCookie);
  const createdBody = await created.json() as { id?: string; error?: unknown };
  assert.equal(created.status, 200, JSON.stringify(createdBody));
  const access = createdBody as { id: string };
  const login = await post('/api/login', { username, password });
  assert.equal(login.status, 200);
  const driverCookie = login.headers.get('set-cookie')!.split(';')[0];
  const session = await (await fetch(base + '/api/session', { headers: { Cookie: driverCookie } })).json() as { user: { id: string; driverId: string } };
  assert.equal(session.user.id, access.id);
  assert.equal(session.user.driverId, driver.id);

  const suspended = await post(`/api/users/${access.id}/access`, { ...command(), enabled: false }, adminCookie);
  assert.equal(suspended.status, 200);
  assert.equal((await (await fetch(base + '/api/session', { headers: { Cookie: driverCookie } })).json() as { user: unknown }).user, null);
  assert.equal((await post('/api/login', { username, password })).status, 401);
  assert.equal((await store.one('SELECT driver_id,enabled FROM users WHERE id=?', access.id))!.driver_id, driver.id);
  assert.equal((await store.one('SELECT COUNT(*) AS n FROM drivers WHERE id=?', driver.id))!.n, 1);

  const legacyCases = [
    { username: `Á chofer ${'x'.repeat(91)}`, password: 'L'.repeat(129) },
    { username: 'Chofer con espacio y acento á', password: 'L'.repeat(200) },
  ];
  for (const [index, legacy] of legacyCases.entries()) {
    const legacyDriverId = randomUUID(), legacyUserId = randomUUID();
    await store.run('INSERT INTO drivers VALUES(?,?,?,1)', legacyDriverId, admin.org_id, `Chofer histórico ${index + 1}`);
    await store.run('INSERT INTO users(id,org_id,username,name,password_hash,role,driver_id) VALUES(?,?,?,?,?,?,?)', legacyUserId, admin.org_id, legacy.username, `Cuenta histórica ${index + 1}`, passwordHash(legacy.password), 'DRIVER', legacyDriverId);
    assert.ok(legacy.username.length <= 100);
    const legacyLogin = await post('/api/login', legacy);
    assert.equal(legacyLogin.status, 200, `legacy credentials ${index + 1} should remain usable`);
    const legacyCookie = legacyLogin.headers.get('set-cookie')!.split(';')[0];
    const legacySession = await (await fetch(base + '/api/session', { headers: { Cookie: legacyCookie } })).json() as { user: { id: string; driverId: string } };
    assert.equal(legacySession.user.id, legacyUserId);
    assert.equal(legacySession.user.driverId, legacyDriverId);
  }
  assert.equal((await post('/api/login', { username: 'control\u0000username', password })).status, 400);

  const recovery = new PasswordRecovery(store), token = '0'.repeat(64);
  for (const resetPassword of ['R'.repeat(129), 'R'.repeat(200)]) {
    await assert.rejects(() => recovery.redeem({ token, password: resetPassword }), (error: any) => error.name === 'ZodError');
  }
  await assert.rejects(() => recovery.redeem({ token, password: 'R'.repeat(128) }), (error: any) => error.code === 'FORBIDDEN');
});
