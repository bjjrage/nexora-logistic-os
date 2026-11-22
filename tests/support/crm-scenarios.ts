import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { createApp } from '../../server/app.ts';
import { hash, type Role } from '../../server/auth.ts';
import type { Database } from '../../server/database.ts';

const command = () => ({commandId: randomUUID()});

async function staff(store: Database, orgId: string, role: Role) {
  const id = randomUUID(), token = randomBytes(32).toString('hex');
  const driverId = role === 'DRIVER' ? randomUUID() : null;
  if (driverId) await store.run('INSERT INTO drivers (id,org_id,name) VALUES (?,?,?)', driverId, orgId, 'Driver QA');
  await store.run('INSERT INTO users (id,org_id,username,name,password_hash,role,driver_id) VALUES (?,?,?,?,?,?,?)',
    id, orgId, 'crm-qa-' + id, role + ' QA', 'unused', role, driverId);
  await store.run('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)', hash(token), id, '2099-01-01T00:00:00.000Z');
  return {id, token: 'logistics_session=' + token};
}

async function customer(store: Database, orgId: string) {
  const id = randomUUID(), client = randomUUID(), token = randomBytes(32).toString('hex');
  await store.run('INSERT INTO clients (id,org_id,name) VALUES (?,?,?)', client, orgId, 'Cliente operativo QA');
  await store.run('INSERT INTO customer_accounts (id,org_id,client_id,name,username,password_hash,created_at) VALUES (?,?,?,?,?,?,?)',
    id, orgId, client, 'Cliente QA', 'crm-qa-' + id, 'unused', '2026-01-01T00:00:00.000Z');
  await store.run('INSERT INTO customer_sessions (token_hash,account_id,expires_at) VALUES (?,?,?)', hash(token), id, '2099-01-01T00:00:00.000Z');
  return {id, token: 'nexora_customer_session=' + token};
}

export async function exerciseCrm(store: Database, volume: number) {
  const a = randomUUID(), b = randomUUID();
  for (const orgId of [a,b]) await store.run('INSERT INTO organizations (id,name,timezone) VALUES (?,?,?)',
    orgId, 'CRM fixture '+orgId, 'America/Asuncion');
  const admin = await staff(store, a, 'ADMIN');
  const ops = await staff(store, a, 'OPERATIONS');
  const foreign = await staff(store, b, 'ADMIN');
  const depot = await staff(store, a, 'DEPOT');
  const driver = await staff(store, a, 'DRIVER');
  const portal = await customer(store, a);
  const listener = createApp(store).listen(0,'127.0.0.1');
  await once(listener, 'listening');
  const origin = 'http://127.0.0.1:' + (listener.address() as AddressInfo).port;

  async function request(path: string, token: string, input?: object, method = input ? 'POST' : 'GET') {
    const response = await fetch(origin + path, {
      method, headers: {Cookie: token, 'Content-Type': 'application/json', 'X-Requested-With': 'logistics-os'},
      body: input && JSON.stringify(input),
    });
    return {status: response.status, body: await response.json()};
  }

  async function get(path: string, token = admin.token) {
    const result = await request('/api/crm' + path, token);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body;
  }

  async function send(path: string, input: object, status = 201, token = admin.token, method = 'POST') {
    const result = await request('/api/crm' + path, token, input, method);
    assert.equal(result.status, status, JSON.stringify(result.body));
    return result.body;
  }

  try {
    const create = {...command(), name: 'Ñandutí QA', sector: 'Moda', city: 'Luque', department: 'Central',
      campaign: 'Piloto A', source: 'Feria', instagram: 'https://www.instagram.com/nanduti_qa/?refer=1',
      phone: '0981 555 333', email: 'INFO@example.test', ownerId: ops.id, tags: ['Pyme']};
    const concurrent = await Promise.all([
      send('/prospects', create),
      send('/prospects', create),
    ]);
    const first = concurrent[0].id;
    const path = '/prospects/' + first;
    assert.equal(concurrent[1].id, first);
    const second = await send('/prospects', {...command(), name: 'Segundo QA', city: 'Luque', sector: 'Moda'}, 201, ops.token);
    assert.notEqual(second.id, first);
    const duplicate = await send('/prospects', {...command(), name: 'Otro nombre', instagram: '@nanduti_qa'}, 409);
    assert.equal(duplicate.error.code, 'CRM_DUPLICATE');
    await send('/prospects', {...command(), name: create.name, city: create.city}, 201, foreign.token);
    assert.equal((await get('/prospects?q=nanduti')).total, 1);
    assert.equal((await get('/prospects?q=%25')).total, 0);
    assert.equal((await get('/prospects?tag=Pyme')).total, 1);
    assert.equal((await get(path)).prospect.score, 100);
    assert.equal((await get(path)).prospect.recordType, 'PROSPECT');
    assert.equal((await get(path)).prospect.phone, '595981555333');
    assert.equal((await send('/prospects', {...command(), name: 'Intruso', ownerId: foreign.id}, 400)).error.code, 'VALIDATION_ERROR');
    for (const token of [driver.token, portal.token, depot.token]) {
      assert.equal((await request('/api/crm' + path, token)).status, 403);
      assert.equal((await request('/api/crm/prospects', token, {...command(), name:'Intruso'})).status, 403);
    }
    assert.equal((await request('/api/crm' + path, '')).status, 401);
    assert.equal((await request('/api/customer-data/crm/prospects', portal.token)).status, 404);
    assert.equal((await request('/api/crm' + path, foreign.token)).status, 404);
    assert.equal((await request('/api/crm' + path + '/stage', foreign.token, {
      ...command(), stage: 'VALIDATED', reason: 'Intrusión', expectedVersion: 1,
    })).status, 404);

    const contactA = await send(path + '/contacts', {...command(), name: 'Ana QA', email: 'ANA@example.test', preferredChannel: 'EMAIL'});
    const contactB = await send(path + '/contacts', {...command(), name: 'Bruno QA', phone: '0981 001 223'});
    await send(path + '/contacts', {...command(), name: 'Ana duplicada', email: 'ana@example.test'}, 409);
    await send(path + '/contacts/' + contactA.id, {
      ...command(), name: 'Ana QA', email: 'ana@example.test', noContact: true, expectedVersion: 1,
    }, 200, ops.token, 'PUT');
    const detail = await get(path);
    assert.equal(detail.contacts.length, 2);
    assert.equal(detail.contacts.find((contact: {id:string}) => contact.id === contactA.id).noContact, true);
    const blocked = await send(path + '/activities', {...command(), kind: 'MESSAGE', contactId: contactA.id, detail: 'Bloqueado'}, 409);
    assert.equal(blocked.error.code, 'CRM_DO_NOT_CONTACT');
    await send(path + '/activities', {...command(), kind: 'CALL', detail: 'Contacto obligatorio'}, 400);
    await send(path + '/activities', {...command(), kind: 'NOTE', contactId: contactA.id, detail: 'Solicitud de baja'});
    await send(path + '/activities', {...command(), kind: 'CALL', contactId: contactB.id, detail: 'Conversación registrada'});

    await send(path + '/stage', {...command(), stage: 'PILOT', expectedVersion: 1, reason: 'Salto'}, 409);
    const steps = ['VALIDATED','CONTACTED','CONVERSING','QUALIFIED','PROPOSAL','PILOT','ACTIVATED','PILOT','DISCARDED','IDENTIFIED'];
    for (const [index, stage] of steps.entries()) {
      const input = {...command(), stage, expectedVersion: index + 1, reason: 'Evidencia ' + stage};
      await send(path + '/stage', input, 200);
      if (index === 0) await send(path + '/stage', input, 200);
    }
    await send(path, {...create, ...command(), expectedVersion: 1}, 409, admin.token, 'PUT');
    await send(path, {...create, ...command(), name: 'Ñandutí actualizado', expectedVersion: 11}, 200, ops.token, 'PUT');
    assert.equal((await get(path)).prospect.name, 'Ñandutí actualizado');
    const task = await send(path + '/tasks', {...command(), title: 'Consultar requisitos',
      dueAt: '2026-01-01T12:00:00Z', ownerId: ops.id});
    assert.equal((await get('/tasks?state=OVERDUE')).rows[0].id, task.id);
    await send('/tasks/' + task.id + '/complete', command(), 200, ops.token);
    await send('/tasks/' + task.id + '/complete', command(), 200, ops.token);
    assert.equal((await get('/tasks?state=OVERDUE')).total, 0);
    assert.equal((await get('/tasks?state=DONE')).total, 1);
    const timeline = await get(path + '/timeline?limit=5');
    assert.equal(timeline.total, 15);
    assert.equal(timeline.rows.length, 5);
    assert.equal((await get(path + '/timeline')).rows.filter((event: {kind:string}) => event.kind === 'TASK_COMPLETED').length, 1);
    const summary = await get('/dashboard?campaign=Piloto+A');
    assert.equal(summary.total, 1);
    assert.equal(summary.reached.CONVERSING, 1);
    assert.equal(summary.reached.PILOT, 1);
    assert.equal(summary.reached.ACTIVATED, 1);
    assert.equal((await get('/options')).campaigns[0], 'Piloto A');

    const csv = '\uFEFFnombre;rubro;ciudad;campaña;instagram;correo;notas\r\n' +
      'Duplicado;Moda;Asunción;Piloto B;@nanduti_qa;;Ya existe\r\n' +
      'Inválido;Moda;Asunción;Piloto B;;correo-inválido;Error\r\n' +
      Array.from({length: volume}, (_, i) => 'Comercio QA ' + i + ';Moda;Asunción;Piloto B;@demo_st_' + i + ';;"Línea 1\nLínea 2"').join('\n') +
      '\nDoble;Moda;Asunción;Piloto B;@demo_st_0;;Otra fila';
    const preview = await send('/import/preview', {csv}, 200);
    assert.equal(preview.total, volume + 3);
    assert.equal(preview.valid, volume);
    assert.equal(preview.errors[0].row, 3);
    assert.equal(preview.duplicates.length, 2);
    assert.equal(preview.duplicates[0].row, 2);
    assert.equal((await get('/prospects?campaign=Piloto+B')).total, 0);
    await send('/import', {...command(), csv: csv + 'x', previewId: preview.previewId}, 409);
    const batch = {...command(), csv, previewId: preview.previewId};
    const results = await Promise.all([send('/import', batch), send('/import', batch)]);
    assert.deepEqual(results[0], {imported: volume, errors: 1, duplicates: 2});
    assert.deepEqual(results[0], results[1]);
    const last = await get('/prospects?campaign=Piloto+B&limit=2&offset=' + (volume - 1));
    assert.equal(last.total, volume);
    assert.equal(last.rows.length, 1);
    assert.equal((await get('/dashboard?campaign=Piloto+B')).total, volume);
    assert.equal((await get('/prospects', foreign.token)).total, 1);
    assert.equal((await store.one('SELECT COUNT(*) AS total FROM clients WHERE org_id=?', a))?.total, 1);

    return {a, b, first, foreignId: foreign.id};
  } finally {
    listener.closeAllConnections();
    await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  }
}
