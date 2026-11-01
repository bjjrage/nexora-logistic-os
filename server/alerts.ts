import { randomUUID } from 'node:crypto';
import type { Database } from './database.ts';

// Alert content is intentionally limited to operational metadata. Never enqueue bodies,
// exception messages, SQL or user supplied values.
const ALERTED = new Set(['server.error', 'server.fatal', 'inventory.mismatch']);
const MAX_PENDING = 10_000;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_RETRIES_MS = [1_000, 5_000, 30_000, 120_000];
const MINIMUM_INTERVAL_MS = 60_000;

type LogEntry = Record<string, unknown>;
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type AlertOutboxOptions = {
  url?: string;
  secret?: string;
  fetcher?: Fetcher;
  maxAttempts?: number;
  retryDelaysMs?: number[];
  requestTimeoutMs?: number;
  pollIntervalMs?: number;
  minimumIntervalMs?: number;
  maxPending?: number;
  retentionMs?: number;
  autoStart?: boolean;
};

export type AlertingSink = {
  handle: (entry: LogEntry) => void;
  flush: () => Promise<void>;
  close: () => void;
};

function metadata(entry: LogEntry, event: string, alertId: string) {
  const stringField = (key: string, max = 200) => typeof entry[key] === 'string' ? (entry[key] as string).slice(0, max) : undefined;
  const status = typeof entry.status === 'number' && Number.isInteger(entry.status) ? entry.status : undefined;
  return {
    alertId,
    type: event,
    at: stringField('at', 40) ?? new Date().toISOString(),
    ...(stringField('release', 100) ? { release: stringField('release', 100) } : {}),
    ...(stringField('requestId', 80) ? { requestId: stringField('requestId', 80) } : {}),
    ...(stringField('route', 200) ? { route: stringField('route', 200) } : {}),
    ...(stringField('method', 12) ? { method: stringField('method', 12) } : {}),
    ...(stringField('errorType', 80) ? { errorType: stringField('errorType', 80) } : {}),
    ...(status === undefined ? {} : { status }),
  };
}

export function createAlertingSink(
  store: Database,
  base: (entry: LogEntry) => void = entry => console.log(JSON.stringify(entry)),
  options: AlertOutboxOptions = {},
): AlertingSink {
  const url = options.url ?? process.env.ALERT_WEBHOOK_URL;
  const secret = options.secret ?? process.env.ALERT_WEBHOOK_SECRET;
  const fetcher = options.fetcher ?? fetch;
  const maxAttempts = options.maxAttempts ?? 5;
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRIES_MS;
  const requestTimeoutMs = options.requestTimeoutMs ?? 5_000;
  const minimumIntervalMs = options.minimumIntervalMs ?? MINIMUM_INTERVAL_MS;
  const maxPending = options.maxPending ?? MAX_PENDING;
  const retentionMs = options.retentionMs ?? RETENTION_MS;
  if (url && new URL(url).protocol !== 'https:') throw new Error('El canal de alertas exige HTTPS.');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || retryDelaysMs.length < maxAttempts - 1 || retryDelaysMs.some(delay => !Number.isFinite(delay) || delay < 0))
    throw new Error('La política de reintentos de alertas es inválida.');

  let timer: ReturnType<typeof setInterval> | undefined;
  let running: Promise<void> | undefined;
  let closed = false;
  const enqueues = new Set<Promise<'queued' | 'throttled' | 'full' | void>>();

  const report = (event: string, fields: LogEntry) => {
    try { base({ at: new Date().toISOString(), event, ...fields }); }
    catch { /* Logging failures must not become unhandled promise rejections. */ }
  };

  async function enqueue(entry: LogEntry, event: string) {
    const now = new Date();
    const nowIso = now.toISOString();
    const requestId = typeof entry.requestId === 'string' ? entry.requestId : null;
    const alertId = randomUUID();
    const payload = JSON.stringify(metadata(entry, event, alertId));
    const result = await store.transaction(async () => {
      const oldEnough = new Date(now.getTime() - retentionMs).toISOString();
      await store.run("DELETE FROM alert_outbox WHERE (delivered_at IS NOT NULL OR failed_at IS NOT NULL) AND created_at < ?", oldEnough);
      const recentCutoff = new Date(now.getTime() - minimumIntervalMs).toISOString();
      const recentSuccess = await store.one('SELECT id FROM alert_outbox WHERE event=? AND delivered_at>? LIMIT 1', event, recentCutoff);
      if (recentSuccess) return 'throttled';
      const pending = await store.one('SELECT count(*) AS count FROM alert_outbox WHERE delivered_at IS NULL AND failed_at IS NULL');
      if (Number(pending?.count ?? 0) >= maxPending) return 'full';
      await store.run(
        'INSERT INTO alert_outbox(id,event,request_id,payload,created_at,next_attempt_at) VALUES(?,?,?,?,?,?)',
        alertId, event, requestId, payload, nowIso, nowIso,
      );
      return 'queued';
    });
    if (result === 'full') report('alert.outbox_capacity_reached', { requestId, relatedEvent: event, maxPending });
    return result;
  }

  async function claim() {
    const now = new Date().toISOString();
    const leaseUntil = new Date(Date.now() + Math.max(requestTimeoutMs * 2, 15_000)).toISOString();
    const cutoff = new Date(Date.now() - minimumIntervalMs).toISOString();
    return store.one(
      `UPDATE alert_outbox SET attempts=attempts+1,lease_until=?
       WHERE id=(SELECT candidate.id FROM alert_outbox AS candidate
         WHERE candidate.delivered_at IS NULL AND candidate.failed_at IS NULL
           AND candidate.attempts < ? AND candidate.next_attempt_at <= ?
           AND (candidate.lease_until IS NULL OR candidate.lease_until <= ?)
           AND NOT EXISTS (SELECT 1 FROM alert_outbox AS sent WHERE sent.event=candidate.event AND sent.delivered_at > ?)
         ORDER BY candidate.created_at,candidate.id LIMIT 1)
         AND (lease_until IS NULL OR lease_until <= ?)
       RETURNING id,event,request_id,payload,attempts`,
      leaseUntil, maxAttempts, now, now, cutoff, now,
    );
  }

  async function deliverDue() {
    if (!url || closed) return;
    for (;;) {
      const now = new Date().toISOString();
      const abandoned = await store.all(
        `UPDATE alert_outbox SET failed_at=?,lease_until=NULL,last_error_type=COALESCE(last_error_type,'DeliveryInterrupted')
         WHERE delivered_at IS NULL AND failed_at IS NULL AND attempts>=?
           AND (lease_until IS NULL OR lease_until<=?)
         RETURNING id,event,request_id,attempts,last_status,last_error_type`,
        now, maxAttempts, now,
      );
      for (const row of abandoned) {
        report('alert.delivery_failed', {
          alertId: row.id, requestId: row.request_id ?? undefined, relatedEvent: row.event,
          attempts: Number(row.attempts), ...(row.last_status === null ? {} : { status: row.last_status }),
          errorType: row.last_error_type ?? 'DeliveryInterrupted',
        });
      }
      const item = await claim();
      if (!item) return;
      let status: number | null = null;
      let errorType: string | null = null;
      try {
        const response = await fetcher(url, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(requestTimeoutMs),
          headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: `Bearer ${secret}` } : {}) },
          body: typeof item.payload === 'string' ? item.payload : JSON.stringify(item.payload),
        });
        status = response.status;
        if (!response.ok) throw new Error('WebhookRejected');
        await store.run('UPDATE alert_outbox SET delivered_at=?,lease_until=NULL,last_status=?,last_error_type=NULL WHERE id=?', new Date().toISOString(), status, item.id);
      } catch (error) {
        if (errorType === null) errorType = error instanceof Error ? error.name : 'UnknownError';
        if (Number(item.attempts) >= maxAttempts) {
          const failedAt = new Date().toISOString();
          await store.run('UPDATE alert_outbox SET failed_at=?,lease_until=NULL,last_status=?,last_error_type=? WHERE id=?', failedAt, status, errorType, item.id);
          report('alert.delivery_failed', {
            alertId: item.id, requestId: item.request_id ?? undefined, relatedEvent: item.event,
            attempts: Number(item.attempts), ...(status === null ? {} : { status }), errorType,
          });
        } else {
          const delay = retryDelaysMs[Number(item.attempts) - 1] ?? retryDelaysMs.at(-1) ?? 0;
          const nextAttemptAt = new Date(Date.now() + delay).toISOString();
          await store.run('UPDATE alert_outbox SET next_attempt_at=?,lease_until=NULL,last_status=?,last_error_type=? WHERE id=?', nextAttemptAt, status, errorType, item.id);
          report('alert.delivery_retry', {
            alertId: item.id, requestId: item.request_id ?? undefined, relatedEvent: item.event,
            attempt: Number(item.attempts), ...(status === null ? {} : { status }), errorType,
          });
        }
      }
    }
  }

  async function flush() {
    if (enqueues.size) await Promise.all([...enqueues]);
    if (running) return running;
    running = deliverDue().catch(error => {
      report('alert.outbox_worker_error', { errorType: error instanceof Error ? error.name : 'UnknownError' });
    }).finally(() => { running = undefined; });
    return running;
  }

  function handle(entry: LogEntry) {
    base(entry);
    const event = String(entry.event);
    if (!url || !ALERTED.has(event)) return;
    const pending = enqueue(entry, event).catch(error => {
      report('alert.outbox_enqueue_failed', {
        requestId: typeof entry.requestId === 'string' ? entry.requestId : undefined,
        relatedEvent: event, errorType: error instanceof Error ? error.name : 'UnknownError',
      });
    });
    enqueues.add(pending);
    void pending.finally(() => {
      enqueues.delete(pending);
      void flush();
    });
  }

  if (url && options.autoStart !== false) {
    timer = setInterval(() => { void flush(); }, options.pollIntervalMs ?? 1_000);
    timer.unref?.();
    void flush(); // Resume durable pending alerts after process restart.
  }

  return {
    handle,
    flush,
    close() { closed = true; if (timer) clearInterval(timer); },
  };
}
