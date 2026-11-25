import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import * as Sentry from '@sentry/node';
import { createApp } from '../server/app.ts';
import { setup } from '../server/auth.ts';
import { Store } from '../server/db.ts';
import { Diagnostics } from '../server/observability.ts';
import { closeSentry, initializeSentry, reportServerError } from '../server/sentry.ts';

test('Sentry remains inert without a DSN', () => {
    initializeSentry(' ', () => { throw new Error('Unexpected transport creation'); });
    reportServerError(new Error('Synthetic error'), 'fatal');
    assert.equal(closeSentry(), undefined);
});

test('Sentry sends one minimized event per report and drains the local transport', async t => {
    const received: Sentry.Event[] = [];
    const pending: Sentry.Event[] = [];
    const flushed: Array<number | undefined> = [];
    const syntheticPrivateText = 'SYNTHETIC_SENTRY_PRIVATE';
    const requestId = 'db832ecd-2b2c-4cf7-ae92-64b09521f301';
    initializeSentry('https://synthetic@localhost/1', () => ({
        async send(envelope) {
            for (const [header, payload] of envelope[1]) {
                assert.equal(header.type, 'event');
                assert.equal(typeof payload, 'object');
                pending.push(payload as Sentry.Event);
            }
            return { statusCode: 200 };
        },
        async flush(timeout) {
            flushed.push(timeout);
            received.push(...pending.splice(0));
            return true;
        },
    }));
    t.after(async () => { await closeSentry(); });
    const options = Sentry.getClient()?.getOptions();
    assert.equal(options?.tracesSampleRate, 0);
    assert.deepEqual(options?.integrations, []);
    const store = new Store(':memory:');
    const credentials = { username: 'admin-sentry-qa', password: 'Synthetic QA Password 2026!' };
    await setup(store, { ...credentials, organizationName: 'Synthetic Sentry QA', timezone: 'UTC' });
    const app = createApp(store, undefined, undefined, new Diagnostics(() => {})).listen(0, '127.0.0.1');
    t.after(async () => {
        await new Promise<void>(resolve => app.close(() => resolve()));
        await store.close();
    });
    await once(app, 'listening');
    const address = app.address();
    assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;
    const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'logistics-os' };
    const post = (path: string, body: string, cookie?: string) => fetch(base + path, {
        method: 'POST', headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) }, body,
    });

    const endpoint = '/api/diagnostics/events';
    const payload = JSON.stringify({ kind: 'API_ERROR', component: syntheticPrivateText, requestId });
    assert.equal((await post(endpoint, payload)).status, 401);
    const login = await post('/api/login', JSON.stringify(credentials));
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie);
    assert.equal((await post(endpoint, '{', cookie)).status, 400);
    assert.equal((await post(endpoint, '{}', cookie)).status, 400);
    assert.equal((await post(endpoint, payload, cookie)).status, 202);

    const applicationFile = new URL('../server/app.ts', import.meta.url).href;
    const error = new Error(syntheticPrivateText);
    error.name = syntheticPrivateText;
    error.stack = `Error: ${syntheticPrivateText}\n    at ${syntheticPrivateText} (${applicationFile}:42:5)`;
    t.mock.method(store, 'one', () => { throw error; });
    const failure = await fetch(`${base}/api/health?private=${syntheticPrivateText}`, { headers: { Cookie: cookie } });
    assert.equal(failure.status, 500);
    const response = await failure.json();
    assert.equal(response.error.code, 'INTERNAL_ERROR');
    assert.ok(response.error.requestId);

    Sentry.withScope(scope => {
        scope.setUser({ email: `${syntheticPrivateText}@example.test` });
        scope.setExtra('raw', syntheticPrivateText);
        scope.setContext('fixture', { payload: syntheticPrivateText });
        Sentry.addBreadcrumb({ message: syntheticPrivateText });
        reportServerError(new Error(syntheticPrivateText), 'fatal');
    });
    Sentry.captureMessage('Untagged event should be dropped');

    assert.equal(await closeSentry(500), true);
    assert.equal(flushed.length, 1);
    assert.ok(flushed[0] !== undefined && flushed[0] <= 500);
    assert.deepEqual(received.map(event => event.tags?.nexora_source).sort(), ['client', 'fatal', 'http']);
    const httpEvent = received.find(event => event.tags?.nexora_source === 'http');
    assert.deepEqual(httpEvent?.fingerprint, ['http', 'server/app.ts', '42']);
    assert.deepEqual(httpEvent?.exception?.values?.[0].stacktrace?.frames, [
        { filename: 'server/app.ts', lineno: 42, colno: 5, in_app: true },
    ]);
    const serialized = JSON.stringify(received);
    for (const value of [syntheticPrivateText, requestId, cookie, applicationFile, response.error.requestId]) {
        assert.ok(!serialized.includes(value));
    }
});
