import {createHash, randomUUID} from 'node:crypto';
import {Router, type Express, type Request} from 'express';
import {z} from 'zod';
import {actorFromRequest, authorize, type Actor} from './auth.ts';
import {camel} from './db.ts';
import type {Database, Row} from './database.ts';
import {ensure} from './errors.ts';
import {Inventory, inventorySchemas} from './inventory.ts';

const uuid = z.uuid();
const reason = z.string().trim().min(1).max(500);
const address = z.string().trim().min(1).max(500);
const orderFields = z.object({
  orderDate: z.iso.date(), destination: address, recipientName: address,
  recipientPhone: z.string().trim().max(80).default(''),
  restrictions: z.string().trim().max(1000).default(''),
  lines: z.array(z.object({productId: uuid, quantity: z.number().int().positive().max(200)}).strict()).min(1).max(200),
}).strict();
export const customerOrderSubmitSchema = orderFields.extend({commandId: uuid, externalId: address.max(160)}).strict();
const version = z.number().int().positive();
const decision = z.object({commandId: uuid, expectedVersion: version.optional()}).strict();
const reject = decision.extend({reason});
const edit = z.object({commandId: uuid, expectedVersion: version, kind: z.literal('EDIT'), reason, order: orderFields}).strict();
const cancel = z.object({commandId: uuid, expectedVersion: version, kind: z.literal('CANCEL'), reason}).strict();
const merchantChange = z.discriminatedUnion('kind', [edit, cancel]);
const review = z.object({
  commandId: uuid, expectedVersion: version, changeId: uuid,
  outcome: z.enum(['ACKNOWLEDGED', 'REJECTED']), reason,
}).strict();
const page = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
}).strict();
const opsPage = page.extend({
  status: z.enum(['PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'CHANGE_PENDING']).default('PENDING'),
});
const timestamp = () => new Date().toISOString();
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)).digest('hex');

const tables = "'customer_order_requests','customer_order_request_changes','customer_order_request_events'";
export async function miniosReady(db: Database): Promise<boolean> {
  try {
    const row = db.kind === 'sqlite'
      ? await db.one(`SELECT COUNT(*) AS total FROM sqlite_schema WHERE type='table' AND name IN (${tables})
          AND (SELECT COUNT(*) FROM schema_migrations WHERE version IN (27,28))=2`)
      : await db.one(`SELECT COUNT(*) AS total FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
          WHERE n.nspname=current_schema() AND t.relname IN (${tables}) AND t.relkind='r'
          AND row_security_active(t.oid) AND has_table_privilege(t.oid,'SELECT') AND has_table_privilege(t.oid,'INSERT')
          AND (t.relname='customer_order_request_events' OR has_table_privilege(t.oid,'UPDATE'))
          AND EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=t.oid AND p.polname='minios_organization')
          AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='customer_order_requests'::regclass AND a.attname='cancelled_at' AND NOT a.attisdropped)`);
    return Number(row?.total) === 3;
  } catch { return false; }
}

export class CustomerOrderIntake {
  private db: Database;
  private inventory: Inventory;
  constructor(db: Database) { this.db = db; this.inventory = new Inventory(db); }

  private scoped<T>(actor: Actor, work: () => Promise<T>) {
    return this.db.transaction(async () => {
      if (this.db.kind === 'postgres')
        await this.db.one("SELECT set_config('nexora.minios_org_id', ?, true) AS tenant", actor.orgId);
      return work();
    });
  }

  private client(actor: Actor): string {
    ensure(actor.role === 'CUSTOMER' && actor.clientId, 'FORBIDDEN', 'Se requiere una cuenta de comerciante activa.', 403);
    return actor.clientId!;
  }

  private async verifyMerchant(actor: Actor, clientId: string) {
    const account = await this.db.one(`SELECT c.archived_at FROM customer_accounts a
      JOIN clients c ON c.org_id=a.org_id AND c.id=a.client_id
      WHERE a.org_id=? AND a.id=? AND a.client_id=? AND a.enabled=1`, actor.orgId, actor.id, clientId);
    ensure(account && !account.archived_at, 'FORBIDDEN', 'La cuenta comercial no está activa.', 403);
  }

  private async request(actor: Actor, id: string, clientId?: string) {
    const row = await this.db.one('SELECT * FROM customer_order_requests WHERE org_id=? AND id=?', actor.orgId, id);
    ensure(row && (!clientId || row.client_id === clientId), 'NOT_FOUND', 'Solicitud no encontrada.', 404);
    return row;
  }

  private state(row: Row) { return row.cancelled_at ? 'CANCELLED' : row.status; }

  private async dto(row: Row) {
    const {payload_json, body_hash: _hash, account_id: _account, ...visible} = row;
    const change = await this.db.one(
      'SELECT * FROM customer_order_request_changes WHERE org_id=? AND request_id=? ORDER BY requested_at DESC,id DESC LIMIT 1',
      row.org_id, row.id);
    return {...camel(visible), status: this.state(row), order: JSON.parse(payload_json),
      change: change ? this.changeView(change) : null};
  }

  private changeView(row: Row) {
    const {proposed_json, ...fields} = row;
    return {...camel(fields), proposed: proposed_json ? JSON.parse(proposed_json) : null};
  }

  private async replay(actor: Actor, id: string, commandId: string, kind: string, input: unknown) {
    const event = await this.db.one('SELECT * FROM customer_order_request_events WHERE org_id=? AND command_id=?', actor.orgId, commandId);
    if (!event) return;
    ensure(event.request_id === id && event.actor_id === actor.id && event.actor_role === actor.role
        && event.kind === kind && event.body_hash === hash(input),
      'DUPLICATE_COMMAND', 'La clave ya fue usada con otros datos.', 409);
    return JSON.parse(event.result_json);
  }

  private async record(actor: Actor, id: string, commandId: string, kind: string, input: unknown, currentVersion: number, result: Row) {
    await this.db.run(`INSERT INTO customer_order_request_events
      (org_id,request_id,command_id,actor_id,actor_role,kind,version,body_hash,result_json,occurred_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, actor.orgId, id, commandId, actor.id, actor.role, kind, currentVersion,
      hash(input), JSON.stringify(result), timestamp());
    return result;
  }

  private checkVersion(row: Row, expected?: number) {
    ensure(expected === undefined || row.version === expected, 'VERSION_CONFLICT', 'La solicitud cambió. Actualizá la lista.', 409);
  }

  private async orderPayload(actor: Actor, clientId: string, input: z.output<typeof customerOrderSubmitSchema>) {
    const {clientId: _client, commandId: _command, ...order} =
      inventorySchemas.order.parse({...input, clientId, proofPolicy: 'RECEIVER_PHOTO'});
    for (const line of order.lines) {
      const product = await this.db.one('SELECT id FROM inventory_products WHERE org_id=? AND client_id=? AND id=? AND active=1',
        actor.orgId, clientId, line.productId);
      ensure(product, 'FORBIDDEN', 'El producto no está autorizado o no está activo.', 403);
    }
    return order;
  }

  async submit(actor: Actor, input: z.output<typeof customerOrderSubmitSchema>) {
    const clientId = this.client(actor);
    return this.scoped(actor, async () => {
      await this.verifyMerchant(actor, clientId);
      const previous = await this.replay(actor, input.commandId, input.commandId, 'SUBMITTED', input);
      if (previous) return previous;
      const existing = await this.db.one('SELECT * FROM customer_order_requests WHERE org_id=? AND id=?', actor.orgId, input.commandId);
      // Solicitudes guardadas con 027 aún usan su huella original.
      if (existing) {
        const {clientId: _client, commandId: _command, ...order} =
          inventorySchemas.order.parse({...input, clientId, proofPolicy: 'RECEIVER_PHOTO'});
        ensure(existing.client_id === clientId && existing.account_id === actor.id && existing.body_hash === hash(order),
          'DUPLICATE_COMMAND', 'La clave ya fue usada con otros datos.', 409);
        return {id: existing.id, status: this.state(existing), orderId: existing.order_id ?? null};
      }
      const order = await this.orderPayload(actor, clientId, input);
      const duplicate = await this.db.one(`SELECT id FROM customer_order_requests WHERE org_id=? AND client_id=? AND external_id=?
        UNION ALL SELECT id FROM inventory_orders WHERE org_id=? AND client_id=? AND external_id=? LIMIT 1`,
        actor.orgId, clientId, order.externalId, actor.orgId, clientId, order.externalId);
      ensure(!duplicate, 'DUPLICATE_ORDER', 'Ya existe un pedido o solicitud con esa referencia.', 409);
      const time = timestamp();
      await this.db.run(`INSERT INTO customer_order_requests
        (org_id,id,client_id,account_id,external_id,payload_json,body_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
        actor.orgId, input.commandId, clientId, actor.id, order.externalId, JSON.stringify(order), hash(order), time, time);
      return this.record(actor, input.commandId, input.commandId, 'SUBMITTED', input, 1,
        {id: input.commandId, status: 'PENDING', orderId: null, version: 1});
    });
  }

  async mine(actor: Actor, query: z.output<typeof page>) {
    const clientId = this.client(actor);
    return this.scoped(actor, async () => {
      const rows = await this.db.all('SELECT * FROM customer_order_requests WHERE org_id=? AND client_id=? ORDER BY updated_at DESC,id LIMIT ? OFFSET ?',
        actor.orgId, clientId, query.limit, query.offset);
      const count = await this.db.one('SELECT COUNT(*) AS total FROM customer_order_requests WHERE org_id=? AND client_id=?', actor.orgId, clientId);
      return {rows: await Promise.all(rows.map(row => this.dto(row))), total: Number(count?.total ?? 0), ...query};
    });
  }

  async timeline(actor: Actor, id: string, query: z.output<typeof page>) {
    const clientId = actor.role === 'CUSTOMER' ? this.client(actor) : undefined;
    if (!clientId) authorize(actor, ['ADMIN', 'OPERATIONS']);
    return this.scoped(actor, async () => {
      await this.request(actor, id, clientId);
      const rows = await this.db.all(`SELECT kind,version,actor_role,result_json,occurred_at FROM customer_order_request_events
        WHERE org_id=? AND request_id=? ORDER BY version DESC LIMIT ? OFFSET ?`, actor.orgId, id, query.limit, query.offset);
      return {rows: rows.map(({result_json, ...row}) => ({...camel(row), kind: String(row.kind), detail: JSON.parse(result_json)}))};
    });
  }

  async queue(actor: Actor, query: z.output<typeof opsPage>) {
    authorize(actor, ['ADMIN', 'OPERATIONS']);
    return this.scoped(actor, async () => {
      const criteria = {
        PENDING: "r.status='PENDING' AND r.cancelled_at IS NULL",
        ACCEPTED: "r.status='ACCEPTED'",
        REJECTED: "r.status='REJECTED'",
        CANCELLED: 'r.cancelled_at IS NOT NULL',
        CHANGE_PENDING: "EXISTS(SELECT 1 FROM customer_order_request_changes ch WHERE ch.org_id=r.org_id AND ch.request_id=r.id AND ch.state='PENDING')",
      }[query.status];
      const where = ' WHERE r.org_id=? AND ' + criteria;
      const rows = await this.db.all(`SELECT r.*,c.name AS client_name FROM customer_order_requests r
        JOIN clients c ON c.id=r.client_id AND c.org_id=r.org_id ${where} ORDER BY r.updated_at DESC,r.id LIMIT ? OFFSET ?`,
        actor.orgId, query.limit, query.offset);
      const count = await this.db.one('SELECT COUNT(*) AS total FROM customer_order_requests r' + where, actor.orgId);
      return {rows: await Promise.all(rows.map(row => this.dto(row))), total: Number(count?.total ?? 0), ...query};
    });
  }

  async change(actor: Actor, id: string, body: z.output<typeof merchantChange>) {
    const clientId = this.client(actor);
    return this.scoped(actor, async () => {
      await this.verifyMerchant(actor, clientId);
      const row = await this.request(actor, id, clientId);
      const current = this.state(row);
      const accepted = current === 'ACCEPTED';
      const kind = accepted ? 'CHANGE_REQUESTED' : body.kind === 'EDIT' ? 'EDITED' : 'CANCELLED';
      // A retry must still replay after a subsequent state transition.
      const last = await this.db.one('SELECT kind FROM customer_order_request_events WHERE org_id=? AND command_id=?', actor.orgId, body.commandId);
      if (last) {
        ensure(['EDITED', 'CANCELLED', 'CHANGE_REQUESTED'].includes(last.kind), 'DUPLICATE_COMMAND', 'La clave ya fue usada.', 409);
        return this.replay(actor, id, body.commandId, last.kind, body);
      }
      this.checkVersion(row, body.expectedVersion);
      ensure(current === 'PENDING' || accepted, 'INVALID_TRANSITION', 'La solicitud está cerrada.', 409);
      const order = body.kind === 'EDIT' ? await this.orderPayload(actor, clientId,
        {...body.order, externalId: row.external_id, commandId: body.commandId}) : null;
      const time = timestamp();
      const next = row.version + 1;
      let changeId: string | null = null;
      if (accepted) {
        const pending = await this.db.one("SELECT id FROM customer_order_request_changes WHERE org_id=? AND request_id=? AND state='PENDING'", actor.orgId, id);
        ensure(!pending, 'INVALID_TRANSITION', 'Ya hay un cambio pendiente de revisión.', 409);
        changeId = body.commandId;
        await this.db.run(`INSERT INTO customer_order_request_changes
          (org_id,request_id,id,kind,reason,proposed_json,requested_at) VALUES (?,?,?,?,?,?,?)`,
          actor.orgId, id, changeId, body.kind, body.reason, order ? JSON.stringify(order) : null, time);
      }
      const cancelled = !accepted && body.kind === 'CANCEL';
      await this.db.run(`UPDATE customer_order_requests SET payload_json=?,cancelled_at=?,version=?,updated_at=? WHERE org_id=? AND id=?`,
        !accepted && order ? JSON.stringify(order) : row.payload_json, cancelled ? time : null, next, time, actor.orgId, id);
      return this.record(actor, id, body.commandId, kind, body, next,
        {id, status: cancelled ? 'CANCELLED' : current, version: next, changeId, reason: body.reason});
    });
  }

  async review(actor: Actor, id: string, body: z.output<typeof review>) {
    authorize(actor, ['ADMIN', 'OPERATIONS']);
    return this.scoped(actor, async () => {
      const previous = await this.replay(actor, id, body.commandId, 'CHANGE_REVIEWED', body);
      if (previous) return previous;
      const row = await this.request(actor, id);
      this.checkVersion(row, body.expectedVersion);
      const time = timestamp();
      const updated = await this.db.run(`UPDATE customer_order_request_changes SET state=?,review_reason=?,reviewed_at=?
        WHERE org_id=? AND request_id=? AND id=? AND state='PENDING'`,
        body.outcome, body.reason, time, actor.orgId, id, body.changeId);
      ensure(Number(updated.changes) === 1, 'INVALID_TRANSITION', 'El cambio no está pendiente.', 409);
      const next = row.version + 1;
      await this.db.run('UPDATE customer_order_requests SET version=?,updated_at=? WHERE org_id=? AND id=?', next, time, actor.orgId, id);
      return this.record(actor, id, body.commandId, 'CHANGE_REVIEWED', body, next,
        {id, status: row.status, version: next, changeId: body.changeId, outcome: body.outcome, reason: body.reason});
    });
  }

  async accept(actor: Actor, id: string, body: z.output<typeof decision>) {
    return this.decide(actor, id, body, 'ACCEPTED');
  }

  async reject(actor: Actor, id: string, body: z.output<typeof reject>) {
    return this.decide(actor, id, body, 'REJECTED', body.reason);
  }

  private async decide(actor: Actor, id: string, body: z.output<typeof decision>, status: 'ACCEPTED' | 'REJECTED', reason = '') {
    authorize(actor, ['ADMIN', 'OPERATIONS']);
    return this.scoped(actor, async () => {
      const previous = await this.replay(actor, id, body.commandId, status, body);
      if (previous) return previous;
      const row = await this.request(actor, id);
      this.checkVersion(row, body.expectedVersion);
      if (row.status === status) return {id, status, orderId: row.order_id ?? null, version: row.version};
      ensure(this.state(row) === 'PENDING', 'INVALID_TRANSITION', 'La solicitud ya fue cerrada.', 409);
      const orderId = status === 'ACCEPTED'
        ? (await this.inventory.createOrder(actor, {...JSON.parse(row.payload_json), clientId: row.client_id, commandId: row.id})).id
        : null;
      const time = timestamp();
      const next = row.version + 1;
      await this.db.run(`UPDATE customer_order_requests SET status=?,order_id=?,rejection_reason=?,decided_by=?,
        decided_at=?,updated_at=?,version=? WHERE org_id=? AND id=?`, status, orderId, reason, actor.id, time, time, next, actor.orgId, id);
      const result = {id, status, orderId, version: next, reason};
      await this.db.run('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)', randomUUID(), actor.orgId, actor.id,
        status === 'ACCEPTED' ? 'minios.order.accept' : 'minios.order.reject', id, body.commandId, JSON.stringify(result), time);
      return this.record(actor, id, body.commandId, status, body, next, result);
    });
  }
}

export function installCustomerOrderIntake(app: Express, db: Database, auth: (req: Request) => Promise<Actor>) {
  const customer = Router(), ops = Router(), service = new CustomerOrderIntake(db);
  const ready = async () => ensure(await miniosReady(db), 'MINIOS_NOT_READY', 'Las solicitudes comerciales requieren migración verificada.', 503);
  customer.use(async (req, res, next) => {
    const actor = await actorFromRequest(db, req, 'CUSTOMER');
    ensure(actor && actor.role === 'CUSTOMER' && actor.clientId, 'FORBIDDEN', 'Ingresá como comerciante.', 401);
    await ready();
    res.locals.actor = actor;
    next();
  });
  ops.use(async (req, res, next) => {
    const actor = await auth(req);
    authorize(actor, ['ADMIN', 'OPERATIONS']);
    await ready();
    res.locals.actor = actor;
    next();
  });
  const actor = (res: {locals: Record<string, unknown>}) => res.locals.actor as Actor;
  const id = (req: Request) => uuid.parse(req.params.id);
  customer.get('/', async (req, res) => res.json(await service.mine(actor(res), page.parse(req.query))));
  customer.post('/', async (req, res) => res.status(201).json(await service.submit(actor(res), customerOrderSubmitSchema.parse(req.body))));
  customer.post('/:id/change', async (req, res) => res.json(await service.change(actor(res), id(req), merchantChange.parse(req.body))));
  customer.get('/:id/history', async (req, res) => res.json(await service.timeline(actor(res), id(req), page.parse(req.query))));
  ops.get('/', async (req, res) => res.json(await service.queue(actor(res), opsPage.parse(req.query))));
  ops.get('/:id/history', async (req, res) => res.json(await service.timeline(actor(res), id(req), page.parse(req.query))));
  ops.post('/:id/accept', async (req, res) => res.json(await service.accept(actor(res), id(req), decision.parse(req.body))));
  ops.post('/:id/reject', async (req, res) => res.json(await service.reject(actor(res), id(req), reject.parse(req.body))));
  ops.post('/:id/review', async (req, res) => res.json(await service.review(actor(res), id(req), review.parse(req.body))));
  app.use('/api/customer/order-requests', customer);
  app.use('/api/minios/order-requests', ops);
}
