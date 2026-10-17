import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/db.ts';
import { createApp } from '../server/app.ts';
test('HTTP conecta documentos de chofer y mantenimiento con foto, historial e idempotencia', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'logistics-controls-http-'));
    const store = new Store(join(directory, 'http.sqlite'));
    const server = createApp(store).listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as {
        port: number;
    }).port}`;
    let cookie = '';
    const post = async (path: string, body: Record<string, unknown>, commandId = randomUUID()) => {
        const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'logistics-os', Cookie: cookie }, body: JSON.stringify({ ...body, commandId }) });
        const value = await response.json();
        if (response.headers.has('set-cookie'))
            cookie = response.headers.get('set-cookie')!.split(';')[0];
        return { status: response.status, value };
    };
    const ok = (response: {
        status: number;
        value: any;
    }) => { assert.equal(response.status, 200, JSON.stringify(response.value)); return response.value; };
    try {
        assert.equal((await post('/api/setup', { organizationName: 'QA HTTP Controles', timezone: 'UTC', username: 'admin-controls', password: 'QA-Controls-Http-2026!' })).status, 201);
        const driver = ok(await post('/api/drivers', { name: 'Chofer QA', username: 'driver-controls', password: 'QA-Driver-Http-2026!' }));
        const vehicle = ok(await post('/api/vehicles', { plate: 'QA-HTTP-001', capacityWeightGrams: 10000, capacityVolumeCm3: 10000, odometer: 100 }));
        const past = new Date(Date.now() - 60000).toISOString();
        const future = new Date(Date.now() + 86400000).toISOString();
        const document = ok(await post(`/api/drivers/${driver.id}/documents`, { name: 'Requisito interno ficticio', expiresAt: past, blocksDispatch: true }));
        const renewCommand = randomUUID();
        const renewed = ok(await post(`/api/driver-documents/${document.id}/renew`, { expiresAt: future }, renewCommand));
        assert.deepEqual(ok(await post(`/api/driver-documents/${document.id}/renew`, { expiresAt: future }, renewCommand)), renewed);
        assert.equal((await store.one('SELECT count(*) n FROM driver_document_events WHERE document_id=?', document.id))!.n, 2);
        const item = ok(await post(`/api/vehicles/${vehicle.id}/maintenance`, { description: 'Servicio ficticio QA', dueAt: null, dueOdometer: 100 }));
        const missing = await post(`/api/maintenance/${item.id}/complete`, { note: 'Trabajo QA realizado' });
        assert.equal(missing.status, 400);
        assert.equal((await store.one('SELECT state FROM maintenance WHERE id=?', item.id))!.state, 'OPEN');
        const photo = ok(await post('/api/evidence', { parcelId: null, filename: 'servicio-qa.png', mimeType: 'image/png', dataBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCioAAAAASUVORK5CYII=' }));
        const body = { note: 'Trabajo QA realizado', evidenceId: photo.id };
        const completeCommand = randomUUID();
        const completed = ok(await post(`/api/maintenance/${item.id}/complete`, body, completeCommand));
        assert.deepEqual(ok(await post(`/api/maintenance/${item.id}/complete`, body, completeCommand)), completed);
        assert.equal((await store.one('SELECT count(*) n FROM audit WHERE command_id=?', completeCommand))!.n, 1);
        const response = await fetch(base + '/api/bootstrap', { headers: { Cookie: cookie } });
        assert.equal(response.status, 200);
        const bootstrap = await response.json();
        assert.equal(bootstrap.driverDocuments.find((entry: any) => entry.id === document.id).expiresAt, future);
        assert.equal(bootstrap.maintenance.find((entry: any) => entry.id === item.id).evidenceId, photo.id);
        assert.equal(bootstrap.maintenance.find((entry: any) => entry.id === item.id).state, 'COMPLETED');
        const image = await fetch(base + `/api/evidence/${photo.id}`, { headers: { Cookie: cookie } });
        assert.equal(image.status, 200);
        assert.equal(image.headers.get('content-type'), 'image/png');
    }
    finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        await store.close();
        await rm(directory, { recursive: true, force: true });
    }
});
