import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { Database } from './database.ts';
import { Logistics } from './domain.ts';
import { authorize, type Actor } from './auth.ts';
import { DomainError, ensure } from './errors.ts';
const fieldPath = z.string().regex(/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/).max(200);
const fieldsSchema = z.object({ vehicleId: fieldPath, latitude: fieldPath, longitude: fieldPath, measuredAt: fieldPath });
export type QuadMindsConfig = {
    orgId: string;
    positionUrl: string;
    apiKey: string;
    fields: z.infer<typeof fieldsSchema>;
    itemsPath: string;
    pollIntervalMs: number;
    staleAfterMs: number;
    timeoutMs: number;
};
export type QuadMindsSettings = {
    config: QuadMindsConfig | null;
    invalid: boolean;
};
// The actual tracking endpoint and payload are supplied by QuadMinds; neither is guessed.
export function loadQuadMindsSettings(env: NodeJS.ProcessEnv = process.env): QuadMindsSettings {
    if (env.QUADMINDS_ENABLED !== 'true')
        return { config: null, invalid: false };
    try {
        const orgId = z.uuid().parse(env.QUADMINDS_ORG_ID);
        const apiKey = z.string().trim().min(1).max(4096).regex(/^[^\r\n]+$/).parse(env.QUADMINDS_API_KEY);
        const positionUrl = z.string().min(1).parse(env.QUADMINDS_POSITION_URL);
        const url = new URL(positionUrl.replaceAll('{vehicleId}', 'test'));
        if (url.protocol !== 'https:' || url.username || url.password || url.hash || /\{(?!vehicleId\})/.test(positionUrl) ||
            new URL(positionUrl.replaceAll('{vehicleId}', 'other')).origin !== url.origin)
            throw new Error('Invalid URL');
        const fields = fieldsSchema.parse(JSON.parse(env.QUADMINDS_FIELDS ?? ''));
        const itemsPath = env.QUADMINDS_ITEMS_PATH ?? '';
        if (itemsPath)
            fieldPath.parse(itemsPath);
        const milliseconds = (value: string | undefined, fallback: number, min: number, max: number) => z.coerce.number().int().min(min).max(max).parse(value ?? fallback);
        return { invalid: false, config: {
                orgId, apiKey, positionUrl, fields, itemsPath,
                pollIntervalMs: milliseconds(env.QUADMINDS_POLL_INTERVAL_MS, 30000, 10000, 3600000),
                staleAfterMs: milliseconds(env.QUADMINDS_STALE_AFTER_MS, 180000, 10000, 86400000),
                timeoutMs: milliseconds(env.QUADMINDS_TIMEOUT_MS, 8000, 100, 30000),
            } };
    }
    catch {
        return { config: null, invalid: true };
    }
}
const at = (value: unknown, path: string): unknown => path.split('.').reduce<unknown>((node, key) => node !== null && typeof node === 'object' && Object.hasOwn(node, key) ? (node as Record<string, unknown>)[key] : undefined, value);
export function normalizePosition(payload: unknown, config: QuadMindsConfig, externalId: string, now: number) {
    const root = config.itemsPath ? at(payload, config.itemsPath) : payload;
    const entries = Array.isArray(root) ? root : root == null ? [] : [root];
    ensure(entries.length <= 10000, 'TRACKING_INVALID_RESPONSE', 'La respuesta de tracking excede el límite permitido.', 502);
    const matching = entries.filter(item => {
        const id = at(item, config.fields.vehicleId);
        return (typeof id === 'string' || typeof id === 'number') && String(id) === externalId;
    });
    if (!matching.length)
        return null;
    const positions = matching.map(item => {
        const latitude = at(item, config.fields.latitude), longitude = at(item, config.fields.longitude), measuredAt = at(item, config.fields.measuredAt);
        ensure(typeof latitude === 'number' && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
            typeof longitude === 'number' && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 &&
            typeof measuredAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(measuredAt) &&
            Number.isFinite(Date.parse(measuredAt)) && Date.parse(measuredAt) <= now + 60000, 'TRACKING_INVALID_RESPONSE', 'QuadMinds devolvió coordenadas o fecha de medición inválidas.', 502);
        return { latitude, longitude, measuredAt: new Date(measuredAt).toISOString() };
    });
    return positions.sort((a, b) => b.measuredAt.localeCompare(a.measuredAt))[0];
}
const bindingSchema = z.object({ commandId: z.uuid(), externalVehicleId: z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9_.:-]+$/).nullable() });
export class QuadMindsTracking {
    private attempts = new Map<string, {
        checkedAt: number;
        error: string | null;
    }>();
    private pending = new Map<string, Promise<void>>();
    private store: Database;
    private settings: QuadMindsSettings;
    private request: typeof fetch;
    private clock: () => number;
    constructor(store: Database, settings = loadQuadMindsSettings(), request: typeof fetch = fetch, clock = Date.now) {
        this.store = store;
        this.settings = settings;
        this.request = request;
        this.clock = clock;
    }
    status(orgId?: string) {
        const config = this.settings.config;
        const configured = !!config && (!orgId || config.orgId === orgId);
        return { provider: 'QUADMINDS', status: configured ? 'CONFIGURED' : this.settings.invalid ? 'INVALID_CONFIGURATION' : 'INTEGRATION_NOT_CONFIGURED', configured,
            pollIntervalMs: config?.pollIntervalMs ?? 30000,
            message: configured ? 'Conector configurado. La conexión real se comprueba al consultar una ruta vinculada.' : this.settings.invalid ? 'Revisá la configuración de QuadMinds en el servidor.' : 'QuadMinds pendiente de endpoint, credenciales y contrato de posiciones. No hay ubicación en vivo.' };
    }
    async bindings(actor: Actor) {
        authorize(actor, ['ADMIN', 'OPERATIONS']);
        return { ...this.status(actor.orgId), bindings: await this.store.all('SELECT vehicle_id AS "vehicleId",external_vehicle_id AS "externalVehicleId" FROM vehicle_tracking_bindings WHERE org_id=?', actor.orgId) };
    }
    async bind(actor: Actor, vehicleId: string, input: unknown) {
        const body = bindingSchema.parse(input), domain = new Logistics(this.store);
        return await domain.command(actor, `vehicles.${vehicleId}.tracking`, body, ['ADMIN', 'OPERATIONS'], async () => {
            await domain.record('vehicles', vehicleId, actor);
            await this.store.run('DELETE FROM vehicle_tracking_latest WHERE org_id=? AND vehicle_id=?', actor.orgId, vehicleId);
            await this.store.run('DELETE FROM vehicle_tracking_bindings WHERE org_id=? AND vehicle_id=?', actor.orgId, vehicleId);
            if (body.externalVehicleId !== null)
                await this.store.run('INSERT INTO vehicle_tracking_bindings VALUES(?,?,?,?,?)', actor.orgId, vehicleId, body.externalVehicleId, new Date(this.clock()).toISOString(), randomUUID());
            return { id: vehicleId, externalVehicleId: body.externalVehicleId };
        });
    }
    private async refresh(config: QuadMindsConfig, vehicleId: string, externalId: string, revision: string) {
        const key = JSON.stringify([config.orgId, vehicleId, externalId, revision]);
        const pending = this.pending.get(key);
        if (pending)
            return pending;
        const previous = this.attempts.get(key);
        if (previous && this.clock() - previous.checkedAt < config.pollIntervalMs)
            return;
        // Bound process-local request metadata; positions persist in SQLite.
        if (this.attempts.size >= 1000)
            this.attempts.delete(this.attempts.keys().next().value!);
        const work = (async () => {
            let error: string | null = null;
            try {
                const response = await this.request(config.positionUrl.replaceAll('{vehicleId}', encodeURIComponent(externalId)), {
                    method: 'GET', headers: { accept: 'application/json', 'x-saas-apikey': config.apiKey },
                    signal: AbortSignal.timeout(config.timeoutMs), redirect: 'error',
                });
                if (!response.ok) {
                    await response.body?.cancel();
                    throw new DomainError('TRACKING_PROVIDER_ERROR', 'QuadMinds no respondió correctamente.', 502);
                }
                // Read a bounded body, including chunked responses; never log provider payloads or credentials.
                const reader = response.body?.getReader();
                ensure(reader, 'TRACKING_INVALID_RESPONSE', 'QuadMinds devolvió una respuesta vacía.', 502);
                const chunks: Uint8Array[] = [];
                let size = 0;
                try {
                    while (true) {
                        const part = await reader.read();
                        if (part.done)
                            break;
                        size += part.value.byteLength;
                        ensure(size <= 2000000, 'TRACKING_INVALID_RESPONSE', 'Respuesta de tracking demasiado grande.', 502);
                        chunks.push(part.value);
                    }
                }
                finally {
                    await reader.cancel().catch(() => { });
                }
                const point = normalizePosition(JSON.parse(Buffer.concat(chunks).toString('utf8')), config, externalId, this.clock());
                if (!point)
                    error = 'TRACKING_NO_POSITION';
                else {
                    await this.store.transaction(async () => {
                    // A binding edited while a request was running must not receive that request's result.
                    const binding = await this.store.one('SELECT external_vehicle_id,revision FROM vehicle_tracking_bindings WHERE org_id=? AND vehicle_id=?', config.orgId, vehicleId);
                    if (binding?.external_vehicle_id === externalId && binding?.revision === revision)
                        await this.store.run(`INSERT INTO vehicle_tracking_latest VALUES(?,?,?,?,?,?,?)
            ON CONFLICT(org_id,vehicle_id) DO UPDATE SET latitude=excluded.latitude,longitude=excluded.longitude,measured_at=excluded.measured_at,received_at=excluded.received_at
            WHERE excluded.measured_at>=vehicle_tracking_latest.measured_at`, config.orgId, vehicleId, externalId, point.latitude, point.longitude, point.measuredAt, new Date(this.clock()).toISOString());
                    });
                }
            }
            catch (failure) {
                error = failure instanceof DomainError ? failure.code : failure instanceof Error && /Timeout|Abort/.test(failure.name) ? 'TRACKING_TIMEOUT' : 'TRACKING_PROVIDER_ERROR';
            }
            this.attempts.set(key, { checkedAt: this.clock(), error });
        })();
        this.pending.set(key, work);
        try {
            await work;
        }
        finally {
            this.pending.delete(key);
        }
    }
    async route(actor: Actor, routeId: string) {
        const route = await new Logistics(this.store).route(routeId, actor);
        const config = this.settings.config;
        ensure(config && config.orgId === actor.orgId, 'INTEGRATION_NOT_CONFIGURED', this.status(actor.orgId).message, 503);
        const binding = await this.store.one('SELECT * FROM vehicle_tracking_bindings WHERE org_id=? AND vehicle_id=?', actor.orgId, route.vehicle_id);
        ensure(binding, 'TRACKING_VEHICLE_NOT_LINKED', 'Vinculá este vehículo con su identificador en QuadMinds.', 409);
        await this.refresh(config, route.vehicle_id, binding.external_vehicle_id, binding.revision);
        const current = await this.store.one('SELECT revision FROM vehicle_tracking_bindings WHERE org_id=? AND vehicle_id=?', actor.orgId, route.vehicle_id);
        ensure(current?.revision === binding.revision, 'TRACKING_BINDING_CHANGED', 'La vinculación cambió. Volvé a consultar.', 409);
        const latest = await this.store.one('SELECT * FROM vehicle_tracking_latest WHERE org_id=? AND vehicle_id=? AND external_vehicle_id=?', actor.orgId, route.vehicle_id, binding.external_vehicle_id);
        const attempt = this.attempts.get(JSON.stringify([actor.orgId, route.vehicle_id, binding.external_vehicle_id, binding.revision]));
        const ageSeconds = latest ? Math.max(0, Math.floor((this.clock() - Date.parse(latest.measured_at)) / 1000)) : null;
        const sourceError = attempt?.error ?? null;
        return { provider: 'QUADMINDS', routeId, vehicleId: route.vehicle_id, scope: 'CURRENT_VEHICLE_POSITION',
            status: !latest ? 'NO_POSITION' : sourceError || this.clock() - Date.parse(latest.measured_at) > config.staleAfterMs ? 'STALE' : 'FRESH',
            sourceError, checkedAt: attempt ? new Date(attempt.checkedAt).toISOString() : null, pollIntervalMs: config.pollIntervalMs,
            staleAfterMs: config.staleAfterMs, ageSeconds,
            position: latest ? { latitude: latest.latitude, longitude: latest.longitude, measuredAt: latest.measured_at, receivedAt: latest.received_at } : null };
    }
}
