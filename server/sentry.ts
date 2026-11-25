import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as Sentry from '@sentry/node';

const serverDirectory = fileURLToPath(new URL('.', import.meta.url)).replaceAll('\\', '/');
const environments = new Set(['development', 'test', 'staging', 'production']);

export const clientErrorKinds = ['UI_ERROR', 'UNHANDLED_REJECTION', 'API_ERROR'] as const;
type ClientErrorKind = typeof clientErrorKinds[number];

function applicationFrame(frame: Sentry.StackFrame): Sentry.StackFrame | undefined {
    if (!frame.filename) return;
    let filename = frame.filename;
    if (filename.startsWith('file:')) {
        try { filename = fileURLToPath(filename); } catch { return; }
    }
    filename = filename.replaceAll('\\', '/');
    if (!filename.startsWith(serverDirectory)) return;
    const name = filename.slice(serverDirectory.length);
    if (!/^[\w-]+\.ts$/.test(name) || !existsSync(new URL(name, import.meta.url))) return;
    return { filename: `server/${name}`, lineno: frame.lineno, colno: frame.colno, in_app: true };
}

function minimizeEvent(event: Sentry.ErrorEvent, release: string, environment: string): Sentry.ErrorEvent | null {
    const source = event.tags?.nexora_source;
    const base: Sentry.ErrorEvent = {
        type: undefined,
        event_id: event.event_id,
        timestamp: event.timestamp,
        platform: 'node',
        level: 'error',
        release,
        environment,
    };
    if (source === 'client') {
        const kind = event.tags?.kind;
        if (!clientErrorKinds.some(allowed => allowed === kind)) return null;
        return { ...base, message: 'Client error', tags: { nexora_source: source, kind }, fingerprint: ['client', String(kind)] };
    }
    if (source !== 'http' && source !== 'fatal') return null;

    const original = event.exception?.values?.at(-1);
    const frames = (original?.stacktrace?.frames ?? []).flatMap(frame => applicationFrame(frame) ?? []);
    const location = frames.at(-1);
    const fingerprint = [source, location?.filename ?? 'server', String(location?.lineno ?? 0)];
    return {
        ...base,
        tags: { nexora_source: source },
        fingerprint,
        exception: { values: [{
            type: 'Error',
            value: source === 'http' ? 'Unexpected server error' : 'Unhandled server error',
            stacktrace: frames.length ? { frames } : undefined,
        }] },
    };
}

export function initializeSentry(dsn = process.env.SENTRY_DSN, transport?: Sentry.NodeOptions['transport']) {
    if (!dsn?.trim()) return;
    const configuredEnvironment = process.env.NODE_ENV ?? 'development';
    const environment = environments.has(configuredEnvironment) ? configuredEnvironment : 'development';
    const configuredRelease = process.env.RELEASE_SHA ?? '';
    const release = /^[a-f0-9]{7,64}$/i.test(configuredRelease) ? configuredRelease : 'local';
    Sentry.init({
        dsn: dsn.trim(),
        environment,
        release,
        defaultIntegrations: false,
        enableOpenTelemetrySetup: false,
        enableRuntimeChannelInjection: false,
        tracesSampleRate: 0,
        traceLifecycle: 'static',
        spotlight: false,
        debug: false,
        dataCollection: {
            userInfo: false,
            cookies: false,
            httpHeaders: false,
            httpBodies: [],
            urlQueryParams: false,
            databaseQueryData: false,
            stackFrameVariables: false,
            frameContextLines: 0,
        },
        includeServerName: false,
        sendClientReports: false,
        maxBreadcrumbs: 0,
        transport,
        beforeSend: event => minimizeEvent(event, release, environment),
    });
}

export function reportServerError(error: unknown, source: 'http' | 'fatal') {
    if (Sentry.isEnabled()) Sentry.captureException(error, { tags: { nexora_source: source } });
}

export function reportClientError(kind: ClientErrorKind) {
    if (Sentry.isEnabled()) Sentry.captureMessage('Client error', { level: 'error', tags: { nexora_source: 'client', kind } });
}

export function closeSentry(timeout = 2000) {
    if (Sentry.isEnabled()) return Sentry.close(timeout);
}
