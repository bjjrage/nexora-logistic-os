import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/db.ts';
import { setup, type Actor } from '../server/auth.ts';
import { Logistics } from '../server/domain.ts';
import { createDriverDocument, renewDriverDocument } from '../server/driver-documents.ts';
async function fixture(t: any) {
    const directory = mkdtempSync(join(tmpdir(), 'driver-documents-'));
    const store = new Store(join(directory, 'test.sqlite'));
    t.after(async () => {
        await store.close();
        rmSync(directory, { recursive: true, force: true });
    });
    const suffix = randomUUID().slice(0, 8);
    const credentials = {
        organizationName: 'Documentos QA',
        timezone: 'UTC',
        username: `admin-${suffix}`,
        password: 'Password-QA-2026!',
    };
    const { orgId, userId } = await setup(store, credentials);
    const actor: Actor = { id: userId, orgId, name: 'Admin QA', role: 'ADMIN', driverId: null };
    const domain = new Logistics(store);
    const command = () => ({ commandId: randomUUID() });
    const driverId = (await domain.createDriver(actor, {
        ...await command(),
        name: 'Chofer QA',
        username: `driver-${suffix}`,
        password: 'Password-QA-driver-2026!',
    })).id;
    const driverUser = (await store.one('SELECT id,name FROM users WHERE org_id=? AND driver_id=? AND role=?', orgId, driverId, 'DRIVER'))!;
    const driverActor: Actor = { id: driverUser.id, orgId, name: driverUser.name, role: 'DRIVER', driverId };
    return { store, domain, actor, driverActor, driverId, command, orgId };
}
async function makeOtherOrganization(store: Store) {
    const orgId = randomUUID();
    const id = randomUUID();
    await store.run('INSERT INTO organizations(id,name,timezone) VALUES(?,?,?)', orgId, 'Otra organización QA', 'UTC');
    await store.run('INSERT INTO users(id,org_id,username,name,password_hash,role,driver_id) VALUES(?,?,?,?,?,?,NULL)', id, orgId, `other-admin-${randomUUID()}`, 'Otro admin QA', 'fixture-hash', 'ADMIN');
    const actor: Actor = { id, orgId, name: 'Otro admin QA', role: 'ADMIN', driverId: null };
    const domain = new Logistics(store);
    const driverId = (await domain.createDriver(actor, {
        commandId: randomUUID(),
        name: 'Chofer externo QA',
        username: `other-driver-${randomUUID()}`,
        password: 'Password-QA-driver-2026!',
    })).id;
    return { actor, domain, driverId };
}
async function assertCode(work: () => unknown, code: string) {
    await assert.rejects(async () => await work(), (error: any) => error?.code === code);
}
test('crear documento admite vencido y registra el alta en el historial', async (t) => {
    const f = await fixture(t);
    const past = new Date(Date.now() - 60000).toISOString();
    const commandId = (await f.command()).commandId;
    const result = await createDriverDocument(f.domain, f.actor, f.driverId, {
        commandId,
        name: 'Requisito interno QA',
        expiresAt: past,
        blocksDispatch: true,
    });
    const document = (await f.store.one('SELECT * FROM driver_documents WHERE id=? AND org_id=?', result.id, f.orgId))!;
    assert.equal(document.driver_id, f.driverId);
    assert.equal(document.name, 'Requisito interno QA');
    assert.equal(document.expires_at, past);
    assert.equal(document.blocks_dispatch, 1);
    const event = (await f.store.one('SELECT * FROM driver_document_events WHERE document_id=?', result.id))!;
    assert.equal(event.actor_id, f.actor.id);
    assert.equal(event.previous_expires_at, null);
    assert.equal(event.expires_at, past);
    assert.equal(event.command_id, commandId);
});
test('renovar exige una fecha futura posterior y una repetición conserva un solo evento', async (t) => {
    const f = await fixture(t);
    const original = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const documentId = (await createDriverDocument(f.domain, f.actor, f.driverId, {
        ...await f.command(), name: 'Control de flota QA', expiresAt: original, blocksDispatch: false,
    })).id;
    const past = new Date(Date.now() - 60000).toISOString();
    await assertCode(async () => await renewDriverDocument(f.domain, f.actor, documentId, {
        ...await f.command(), expiresAt: past,
    }), 'VALIDATION_ERROR');
    const tooEarly = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    await assertCode(async () => await renewDriverDocument(f.domain, f.actor, documentId, {
        ...await f.command(), expiresAt: tooEarly,
    }), 'VALIDATION_ERROR');
    assert.equal((await f.store.one('SELECT count(*) AS n FROM driver_document_events WHERE document_id=?', documentId))!.n, 1);
    const next = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const renewalCommand = { commandId: randomUUID(), expiresAt: next };
    const first = await renewDriverDocument(f.domain, f.actor, documentId, renewalCommand);
    const retry = await renewDriverDocument(f.domain, f.actor, documentId, renewalCommand);
    assert.deepEqual(retry, first);
    assert.equal(first.id, documentId);
    assert.equal((await f.store.one('SELECT expires_at FROM driver_documents WHERE id=?', documentId))!.expires_at, next);
    const history = await f.store.all('SELECT * FROM driver_document_events WHERE document_id=? ORDER BY rowid', documentId);
    assert.equal(history.length, 2);
    assert.equal(history[0].previous_expires_at, null);
    assert.equal(history[0].expires_at, original);
    assert.equal(history[1].previous_expires_at, original);
    assert.equal(history[1].expires_at, next);
    assert.equal(history[1].actor_id, f.actor.id);
    assert.equal(history[1].command_id, renewalCommand.commandId);
});
test('un chofer no puede crear ni renovar documentos', async (t) => {
    const f = await fixture(t);
    const documentId = (await createDriverDocument(f.domain, f.actor, f.driverId, {
        ...await f.command(),
        name: 'Requisito QA',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        blocksDispatch: false,
    })).id;
    const countBefore = (await f.store.one('SELECT count(*) AS n FROM driver_documents WHERE org_id=?', f.orgId))!.n;
    await assertCode(async () => await createDriverDocument(f.domain, f.driverActor, f.driverId, {
        ...await f.command(),
        name: 'Intento QA',
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        blocksDispatch: false,
    }), 'FORBIDDEN');
    await assertCode(async () => await renewDriverDocument(f.domain, f.driverActor, documentId, {
        ...await f.command(), expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
    }), 'FORBIDDEN');
    assert.equal((await f.store.one('SELECT count(*) AS n FROM driver_documents WHERE org_id=?', f.orgId))!.n, countBefore);
    assert.equal((await f.store.one('SELECT count(*) AS n FROM driver_document_events WHERE document_id=?', documentId))!.n, 1);
});
test('un documento de otra organización no puede crearse ni renovarse desde este tenant', async (t) => {
    const f = await fixture(t);
    const other = await makeOtherOrganization(f.store);
    const foreignInitial = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const foreignDocumentId = (await createDriverDocument(other.domain, other.actor, other.driverId, {
        commandId: randomUUID(),
        name: 'Requisito externo QA',
        expiresAt: foreignInitial,
        blocksDispatch: true,
    })).id;
    const expiration = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    await assertCode(async () => await createDriverDocument(f.domain, f.actor, other.driverId, {
        ...await f.command(), name: 'Cruce QA', expiresAt: expiration, blocksDispatch: true,
    }), 'NOT_FOUND');
    await assertCode(async () => await renewDriverDocument(f.domain, f.actor, foreignDocumentId, {
        ...await f.command(), expiresAt: expiration,
    }), 'NOT_FOUND');
    assert.equal((await f.store.one('SELECT expires_at FROM driver_documents WHERE id=?', foreignDocumentId))!.expires_at, foreignInitial);
    assert.equal((await f.store.one('SELECT count(*) AS n FROM driver_document_events WHERE document_id=?', foreignDocumentId))!.n, 1);
});
