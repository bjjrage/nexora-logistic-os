import { createHash, randomUUID } from 'node:crypto';
import type { Actor } from './auth.ts';
import type { Database, Row } from './database.ts';
import { camel } from './db.ts';
import { DomainError, ensure } from './errors.ts';
import { z } from 'zod';
import {verifyVehicleCapacity} from './vehicle-capacity.ts';
import {verifyProductCodes} from './product-codes.ts';

export type InventoryActor = Omit<Actor, 'role'> & { role: string; clientId?: string | null };
type ItemInput = { productId: string; quantity: number; serials?: string[] };
const now = () => new Date().toISOString();
const uuid = z.uuid();
const nonEmpty = z.string().trim().min(1).max(500);
const positive = z.number().int().positive().max(200);
const orderDateInput = z.union([z.iso.date(), z.iso.datetime({ offset: true })]).transform(value => value.slice(0, 10));
const quantityInput = z.object({ productId: uuid, quantity: positive, serials: z.array(nonEmpty).max(200).optional() });
const orderLineInput = z.object({ productId: uuid, quantity: positive });
const orderInput = z.object({
  clientId: uuid, externalId: nonEmpty.max(160), orderDate: orderDateInput,
  destination: nonEmpty, recipientName: nonEmpty, recipientPhone: z.string().trim().max(80).default(''),
  originText: z.string().trim().max(500).default(''), proofPolicy: z.enum(['RECEIVER', 'RECEIVER_PHOTO']).default('RECEIVER_PHOTO'),
  windowStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional().default(null),
  windowEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional().default(null),
  serviceMinutes: z.number().int().positive().max(480).nullable().optional().default(null),
  restrictions: z.string().trim().max(1000).default(''),
  lines: z.array(orderLineInput).min(1).max(200)
}).superRefine((value, ctx) => {
  if (value.lines.reduce((total, line) => total + line.quantity, 0) > 200)
    ctx.addIssue({ code: 'custom', message: 'Un pedido admite hasta 200 unidades.', path: ['lines'] });
  if (new Set(value.lines.map(line => line.productId)).size !== value.lines.length)
    ctx.addIssue({ code: 'custom', message: 'Cada producto debe aparecer una sola vez por pedido.', path: ['lines'] });
  if ((value.windowStart === null) !== (value.windowEnd === null) || value.windowStart && value.windowEnd && value.windowStart >= value.windowEnd)
    ctx.addIssue({ code: 'custom', message: 'La ventana debe incluir inicio y fin, en orden.', path: ['windowEnd'] });
  if (value.proofPolicy !== 'RECEIVER_PHOTO')
    ctx.addIssue({ code: 'custom', message: 'Los pedidos de inventario requieren comprobante fotográfico. El circuito QuadMinds exige además su firma.', path: ['proofPolicy'] });
});
const csvOrderRowInput = z.object({
  clientId: uuid, externalId: nonEmpty.max(160), orderDate: orderDateInput, destination: nonEmpty,
  recipientName: nonEmpty, recipientPhone: z.string().trim().max(80).default(''), originText: z.string().trim().max(500).default(''),
  proofPolicy: z.enum(['RECEIVER', 'RECEIVER_PHOTO']).default('RECEIVER_PHOTO'),
  windowStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().default(null),
  windowEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().default(null),
  serviceMinutes: z.number().int().positive().max(480).nullable().default(null),
  restrictions: z.string().trim().max(1000).default(''), productId: uuid.optional(), sku: nonEmpty.max(100).optional(),
  quantity: z.number().int().positive().max(200)
}).superRefine((value, ctx) => {
  if (!value.productId && !value.sku) ctx.addIssue({ code: 'custom', message: 'Incluí SKU o productId.', path: ['sku'] });
  if ((value.windowStart === null) !== (value.windowEnd === null) || value.windowStart && value.windowEnd && value.windowStart >= value.windowEnd)
    ctx.addIssue({ code: 'custom', message: 'La ventana debe incluir inicio y fin, en orden.', path: ['windowEnd'] });
  if (value.proofPolicy !== 'RECEIVER_PHOTO') ctx.addIssue({ code: 'custom', message: 'El pedido requiere comprobante fotográfico.', path: ['proofPolicy'] });
});
export const inventorySchemas = {
  product: z.object({ commandId: uuid, clientId: uuid, sku: nonEmpty.max(100), barcode: nonEmpty.max(160).optional().nullable(), name: nonEmpty, tracking: z.enum(['QUANTITY', 'SERIAL']), unit: nonEmpty.max(40).default('unidad'), weightGrams: z.number().int().positive().nullable().optional().default(null), volumeCm3: z.number().int().positive().nullable().optional().default(null) }),
  productUpdate: z.object({ commandId: uuid, sku: nonEmpty.max(100).optional(), barcode: nonEmpty.max(160).nullable().optional(), name: nonEmpty.optional(), unit: nonEmpty.max(40).optional(), weightGrams: z.number().int().positive().nullable().optional(), volumeCm3: z.number().int().positive().nullable().optional(), active: z.boolean().optional() }).refine(value => Object.keys(value).some(key => key !== 'commandId'), 'Incluí al menos un campo para actualizar.'),
  location: z.object({ commandId: uuid, code: nonEmpty.max(80), name: nonEmpty, kind: z.enum(['DEPOT', 'STORAGE', 'QUARANTINE']).default('STORAGE') }),
  locationUpdate: z.object({ commandId: uuid, code: nonEmpty.max(80).optional(), name: nonEmpty.optional(), kind: z.enum(['DEPOT', 'STORAGE', 'QUARANTINE']).optional(), active: z.boolean().optional() }).refine(value => Object.keys(value).some(key => key !== 'commandId'), 'Incluí al menos un campo para actualizar.'),
  receive: z.object({ commandId: uuid, clientId: uuid, productId: uuid, locationId: uuid, quantity: positive, serials: z.array(z.object({ serial: nonEmpty.max(160), barcode: nonEmpty.max(160).optional().nullable() })).max(200).optional(), reference: z.string().trim().max(160).default(''), reason: z.string().trim().max(500).default('') }),
  move: z.object({ commandId: uuid, clientId: uuid, productId: uuid, quantity: positive, fromLocationId: uuid, toLocationId: uuid, serials: z.array(nonEmpty.max(160)).max(200).optional(), reason: z.string().trim().max(500).default('') }),
  adjust: z.object({ commandId: uuid, clientId: uuid, productId: uuid, locationId: uuid, quantityDelta: z.number().int().min(-200).max(200).refine(value => value !== 0), serials: z.array(z.object({ serial: nonEmpty.max(160), barcode: nonEmpty.max(160).optional().nullable() })).max(200).optional(), reason: nonEmpty.max(500) }),
  order: z.object({ commandId: uuid }).extend(orderInput.shape).superRefine((value, ctx) => {
    const issue = orderInput.safeParse(value);
    if (!issue.success) for (const item of issue.error.issues) ctx.addIssue({ code: 'custom', path: item.path, message: item.message });
  }),
  orderUpdate: z.object({ commandId: uuid, date: orderDateInput.optional(), orderDate: orderDateInput.optional(), destination: nonEmpty.optional(), recipientName: nonEmpty.optional(), recipientPhone: z.string().trim().max(80).optional(), originText: z.string().trim().max(500).optional(), windowStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(), windowEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(), serviceMinutes: z.number().int().positive().max(480).nullable().optional(), restrictions: z.string().trim().max(1000).optional(), lines: z.array(orderLineInput).min(1).max(200).optional() }).refine(value => Object.keys(value).some(key => key !== 'commandId'), 'Include at least one editable field.').superRefine((value, ctx) => {
    if (value.date && value.orderDate && value.date !== value.orderDate) ctx.addIssue({ code: 'custom', path: ['orderDate'], message: 'Send only one order date value.' });
  }),
  orderCancel: z.object({ commandId: uuid, reason: nonEmpty.max(500) }),
  importOrders: z.object({ commandId: uuid, orders: z.array(orderInput).min(1).max(200) }).superRefine((value, ctx) => {
    const keys = value.orders.map(order => `${order.clientId}\u0000${order.externalId}`);
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: 'custom', message: 'El archivo contiene números de pedido repetidos.', path: ['orders'] });
  }),
  importCsv: z.object({ commandId: uuid, csv: z.string().min(1).max(2_000_000) }),
  reserve: z.object({ commandId: uuid, locationId: uuid.optional() }),
  load: z.object({ commandId: uuid, routeId: uuid, expectedVersion: z.number().int().positive(), codes: z.array(nonEmpty.max(200)).min(1).max(200) }),
  return: z.object({ commandId: uuid, locationId: uuid, returns: z.array(z.object({ returnId: uuid, evidenceId: uuid })).min(1).max(200) }),
  release: z.object({ commandId: uuid, reason: nonEmpty.max(500), locationId: uuid, parcelIds: z.array(uuid).max(200).optional(), serials: z.array(nonEmpty.max(160)).max(200).optional() }).refine(value => Boolean(value.parcelIds?.length || value.serials?.length), 'Indicá los bultos o series que inspeccionaste.')
};

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const bodyHash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const freshCode = () => `B-${randomUUID().replaceAll('-', '').slice(0, 20).toUpperCase()}`;
const normalizeOrderAlias = (value: Row): Row => value && typeof value === 'object' ? { ...value, orderDate: value.orderDate ?? value.date } : value;
const normalizeImportAliases = (value: Row): Row => {
  if (!value || typeof value !== 'object' || !Array.isArray(value.orders)) return value;
  return { ...value, orders: value.orders.map((order: Row) => normalizeOrderAlias({ ...order, clientId: order?.clientId ?? value.clientId })) };
};

export class Inventory {
  readonly store: Database;
  constructor(store: Database) { this.store = store; }

  private async record(table: string, id: string, actor: InventoryActor): Promise<Row> {
    const row = await this.store.one(`SELECT * FROM ${table} WHERE id=? AND org_id=?`, id, actor.orgId);
    ensure(row, 'NOT_FOUND', 'No se encontró el recurso autorizado.', 404);
    return row;
  }
  private allow(actor: InventoryActor, roles: string[]) { ensure(roles.includes(actor.role), 'FORBIDDEN', 'Tu rol no permite esta operación.', 403); }
  private readAccess(actor: InventoryActor) { this.allow(actor, ['ADMIN', 'OPERATIONS', 'DEPOT', 'CUSTOMER']); }
  private async client(actor: InventoryActor, clientId: string, allowCustomerRead = false): Promise<Row> {
    if (actor.role === 'CUSTOMER') {
      ensure(allowCustomerRead && actor.clientId && actor.clientId === clientId, 'FORBIDDEN', 'El cliente no tiene acceso a esta mercadería.', 403);
    }
    const row = await this.store.one('SELECT * FROM clients WHERE id=? AND org_id=?', clientId, actor.orgId);
    ensure(row, 'NOT_FOUND', 'No se encontró el cliente autorizado.', 404);
    return row;
  }
  private async product(actor: InventoryActor, productId: string, clientId?: string): Promise<Row> {
    const row = await this.store.one('SELECT * FROM inventory_products WHERE id=? AND org_id=?', productId, actor.orgId);
    ensure(row, 'NOT_FOUND', 'No se encontró el producto autorizado.', 404);
    if (clientId) ensure(row.client_id === clientId, 'FORBIDDEN', 'El producto pertenece a otro cliente.', 403);
    return row;
  }
  private async location(actor: InventoryActor, locationId: string): Promise<Row> {
    const row = await this.store.one('SELECT * FROM inventory_locations WHERE id=? AND org_id=?', locationId, actor.orgId);
    ensure(row, 'NOT_FOUND', 'No se encontró la ubicación autorizada.', 404);
    return row;
  }
  private async quarantineLocation(actor: InventoryActor, hint: string): Promise<Row> {
    const byId = await this.store.one("SELECT * FROM inventory_locations WHERE id=? AND org_id=? AND kind='QUARANTINE' AND active=1", hint, actor.orgId);
    if (byId) return byId;
    const byCode = await this.store.one("SELECT * FROM inventory_locations WHERE code=? AND org_id=? AND kind='QUARANTINE' AND active=1", hint, actor.orgId);
    if (byCode) return byCode;
    const byName = await this.store.all("SELECT * FROM inventory_locations WHERE name=? AND org_id=? AND kind='QUARANTINE' AND active=1 ORDER BY id", hint, actor.orgId);
    ensure(byName.length === 1, 'NOT_FOUND', 'El retorno requiere una ubicación de cuarentena activa y única.', 404);
    return byName[0];
  }
  private async command<T extends Row>(actor: InventoryActor, operation: string, input: Row, work: () => Promise<T>, roles: string[] = ['ADMIN', 'OPERATIONS', 'DEPOT']): Promise<T> {
    this.allow(actor, roles);
    ensure(typeof input.commandId === 'string' && /^[a-f0-9-]{36}$/i.test(input.commandId), 'VALIDATION_ERROR', 'Se requiere commandId UUID.', 400);
    return await this.store.transaction(async () => {
      const digest = bodyHash(input);
      const previous = await this.store.one('SELECT * FROM inventory_commands WHERE org_id=? AND command_id=?', actor.orgId, input.commandId);
      if (previous) {
        ensure(previous.actor_id === actor.id && previous.operation === operation && previous.body_hash === digest, 'DUPLICATE_COMMAND', 'La clave ya se usó con otra operación, identidad o contenido.');
        return JSON.parse(previous.response) as T;
      }
      const result = await work();
      await this.store.run('INSERT INTO inventory_commands VALUES(?,?,?,?,?,?,?)', actor.orgId, actor.id, input.commandId, operation, digest, JSON.stringify(result), now());
      const auditMeta: Row = { result: result.status ?? result.state ?? 'APPLIED' };
      if (typeof input.reason === 'string') auditMeta.reason = input.reason;
      await this.store.run('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)', randomUUID(), actor.orgId, actor.id, `inventory.${operation}`, String(result.id ?? ''), input.commandId, JSON.stringify(auditMeta), now());
      return result;
    });
  }
  private async appendMovement(actor: InventoryActor, input: {
    clientId: string; productId: string; quantity: number; serialId?: string | null; fromLocationId?: string | null;
    toLocationId?: string | null; fromStatus?: string | null; toStatus?: string | null; fromCustodyId?: string | null;
    toCustodyId?: string | null; orderId?: string | null; parcelId?: string | null; action: string;
    reference?: string | null; reason?: string | null; commandId: string;
  }) {
    await this.store.run(`INSERT INTO inventory_movements
      (id,org_id,client_id,product_id,quantity,serial_id,from_location_id,to_location_id,from_status,to_status,from_custody_id,to_custody_id,order_id,parcel_id,action,reference,reason,actor_id,command_id,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, randomUUID(), actor.orgId, input.clientId, input.productId, input.quantity,
      input.serialId ?? null, input.fromLocationId ?? null, input.toLocationId ?? null, input.fromStatus ?? null,
      input.toStatus ?? null, input.fromCustodyId ?? null, input.toCustodyId ?? null, input.orderId ?? null,
      input.parcelId ?? null, input.action, input.reference ?? null, input.reason ?? null, actor.id, input.commandId, now());
  }
  private async changeBalance(actor: InventoryActor, b: { clientId: string; productId: string; locationId: string; status: string; custodyId?: string; orderId?: string; delta: number }) {
    const custodyId = b.custodyId ?? '', orderId = b.orderId ?? '';
    await this.store.run(`INSERT INTO inventory_balances(id,org_id,client_id,product_id,location_id,status,custody_id,order_id,quantity,updated_at)
      VALUES(?,?,?,?,?,?,?,?,0,?) ON CONFLICT(org_id,client_id,product_id,location_id,status,custody_id,order_id) DO NOTHING`,
      randomUUID(), actor.orgId, b.clientId, b.productId, b.locationId, b.status, custodyId, orderId, now());
    const result = await this.store.run('UPDATE inventory_balances SET quantity=quantity+?,updated_at=? WHERE org_id=? AND client_id=? AND product_id=? AND location_id=? AND status=? AND custody_id=? AND order_id=? AND quantity+?>=0',
      b.delta, now(), actor.orgId, b.clientId, b.productId, b.locationId, b.status, custodyId, orderId, b.delta);
    ensure(Number(result.changes) === 1, b.delta < 0 ? 'INSUFFICIENT_STOCK' : 'INVENTORY_CONFLICT', b.delta < 0 ? 'No hay unidades disponibles en esa ubicación.' : 'No se pudo actualizar el saldo.');
  }
  private async newParcel(actor: InventoryActor, order: Row, line: Row, product: Row, locationId: string, serialId?: string | null) {
    const parcelId = randomUUID(), code = freshCode();
    await this.store.run('INSERT INTO parcels VALUES(?,?,?,?,?,?,?,?,?)', parcelId, actor.orgId, order.shipment_id, code, 'RECEIVED', 'DEPOT', locationId, product.weight_grams ?? null, product.volume_cm3 ?? null);
    await this.store.run("INSERT INTO inventory_order_parcels(id,org_id,client_id,order_id,line_id,product_id,parcel_id,serial_id,location_id,custody_id,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'',?,?,?)", randomUUID(), actor.orgId, order.client_id, order.id, line.id, product.id, parcelId, serialId ?? null, locationId, 'RESERVED', now(), now());
    if (serialId) await this.store.run('UPDATE inventory_units SET parcel_id=?,updated_at=? WHERE id=? AND org_id=?', parcelId, now(), serialId, actor.orgId);
    return { id: parcelId, code, productId: product.id, serialId: serialId ?? null };
  }
  private async recomputeOrder(actor: InventoryActor, orderId: string) {
    const counts = await this.store.one(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN state='RESERVED' THEN 1 ELSE 0 END) AS reserved,
      SUM(CASE WHEN state='VEHICLE' THEN 1 ELSE 0 END) AS vehicle,
      SUM(CASE WHEN state='DELIVERED' THEN 1 ELSE 0 END) AS delivered,
      SUM(CASE WHEN state='QUARANTINE' THEN 1 ELSE 0 END) AS quarantine,
      SUM(CASE WHEN state='RELEASED' THEN 1 ELSE 0 END) AS released
      FROM inventory_order_parcels WHERE org_id=? AND order_id=?`, actor.orgId, orderId);
    if (!counts || !counts.total) return;
    let status = 'RESERVED';
    if (counts.delivered === counts.total) status = 'DELIVERED';
    else if (counts.delivered > 0 || counts.quarantine > 0 || counts.released > 0) status = 'PARTIAL';
    else if (counts.vehicle === counts.total) status = 'LOADED';
    else if (counts.vehicle > 0) status = 'PARTIALLY_LOADED';
    else if (counts.reserved === 0) status = 'LOADED';
    await this.store.run('UPDATE inventory_orders SET status=?,updated_at=? WHERE id=? AND org_id=?', status, now(), orderId, actor.orgId);
  }
  private async transferParcel(actor: InventoryActor, item: Row, to: 'VEHICLE' | 'DELIVERED' | 'QUARANTINE', custodyId: string, commandId: string) {
    const product = await this.product(actor, item.product_id, item.client_id);
    const from = item.state;
    if (to === 'VEHICLE') ensure(from === 'RESERVED', 'INVALID_TRANSITION', 'La unidad no está reservada para la carga.');
    if (to === 'DELIVERED') ensure(from === 'VEHICLE', 'INVALID_TRANSITION', 'La unidad no está en custodia del vehículo.');
    if (to === 'QUARANTINE') ensure(from === 'VEHICLE', 'INVALID_TRANSITION', 'La unidad no está en custodia del vehículo.');
    if (item.serial_id) {
      const unit = await this.store.one('SELECT * FROM inventory_units WHERE id=? AND org_id=? AND client_id=?', item.serial_id, actor.orgId, item.client_id);
      ensure(unit && unit.status === from && (from !== 'VEHICLE' || unit.custody_id === item.custody_id), 'INVENTORY_CONFLICT', 'Cambió el estado de la unidad serializada.');
      const result = await this.store.run('UPDATE inventory_units SET status=?,custody_id=?,order_id=?,location_id=?,updated_at=? WHERE id=? AND org_id=? AND status=?',
        to, to === 'VEHICLE' ? custodyId : '', to === 'DELIVERED' ? item.order_id : item.order_id,
        to === 'QUARANTINE' ? custodyId : item.location_id, now(), unit.id, actor.orgId, from);
      ensure(Number(result.changes) === 1, 'INVENTORY_CONFLICT', 'Cambió el estado de la unidad serializada.');
    }
    else {
      await this.changeBalance(actor, { clientId: item.client_id, productId: item.product_id, locationId: item.location_id, status: from, custodyId: from === 'VEHICLE' ? item.custody_id : '', orderId: item.order_id, delta: -1 });
      if (to === 'VEHICLE') await this.changeBalance(actor, { clientId: item.client_id, productId: item.product_id, locationId: item.location_id, status: 'VEHICLE', custodyId, orderId: item.order_id, delta: 1 });
      if (to === 'QUARANTINE') await this.changeBalance(actor, { clientId: item.client_id, productId: item.product_id, locationId: custodyId, status: 'QUARANTINE', orderId: item.order_id, delta: 1 });
    }
    const targetLocation = to === 'QUARANTINE' ? custodyId : item.location_id;
    const updated = await this.store.run('UPDATE inventory_order_parcels SET state=?,location_id=?,custody_id=?,updated_at=? WHERE id=? AND org_id=? AND state=?', to, targetLocation, to === 'VEHICLE' ? custodyId : '', now(), item.id, actor.orgId, from);
    ensure(Number(updated.changes) === 1, 'INVENTORY_CONFLICT', 'Cambió el estado de la unidad reservada.');
    if (to === 'DELIVERED') await this.store.run('UPDATE inventory_order_lines SET delivered_quantity=delivered_quantity+1 WHERE id=? AND org_id=?', item.line_id, actor.orgId);
    if (to === 'QUARANTINE') await this.store.run('UPDATE inventory_order_lines SET returned_quantity=returned_quantity+1 WHERE id=? AND org_id=?', item.line_id, actor.orgId);
    if (to === 'VEHICLE') await this.store.run('UPDATE inventory_order_lines SET loaded_quantity=loaded_quantity+1 WHERE id=? AND org_id=?', item.line_id, actor.orgId);
    const fromStatus = from === 'RESERVED' ? 'RESERVED' : 'VEHICLE';
    const toStatus = to;
    await this.appendMovement(actor, { clientId: item.client_id, productId: product.id, quantity: 1, serialId: item.serial_id,
      fromLocationId: item.location_id, toLocationId: targetLocation, fromStatus, toStatus,
      fromCustodyId: from === 'VEHICLE' ? item.custody_id ?? null : null, toCustodyId: to === 'VEHICLE' ? custodyId : null,
      orderId: item.order_id, parcelId: item.parcel_id, action: to === 'VEHICLE' ? 'LOAD' : to === 'DELIVERED' ? 'DELIVER' : 'RETURN',
      reference: item.order_id, commandId });
    await this.recomputeOrder(actor, item.order_id);
  }

  async createProduct(actor: InventoryActor, input: Row) {
    const b = inventorySchemas.product.parse(input);
    return this.command(actor, 'products.create', b, async () => {
      await this.client(actor, b.clientId);
      const id = randomUUID(), time = now();
      await verifyProductCodes(this.store,actor.orgId,b.clientId,id,b.sku,b.barcode??null);
      await this.store.run('INSERT INTO inventory_products VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?)', id, actor.orgId, b.clientId, b.sku, b.barcode ?? null, b.name, b.tracking, b.unit, b.weightGrams, b.volumeCm3, time, time);
      return { id, clientId: b.clientId, sku: b.sku, barcode: b.barcode ?? null, name: b.name, tracking: b.tracking, unit: b.unit, weightGrams: b.weightGrams, volumeCm3: b.volumeCm3, active: true };
    }, ['ADMIN', 'OPERATIONS']);
  }
  async updateProduct(actor: InventoryActor, id: string, input: Row) {
    const b = inventorySchemas.productUpdate.parse(input);
    return this.command(actor, `products.${id}.update`, b, async () => {
      const product = await this.product(actor, id);
      const next = { sku: b.sku ?? product.sku, barcode: b.barcode === undefined ? product.barcode : b.barcode, name: b.name ?? product.name, unit: b.unit ?? product.unit, weightGrams: b.weightGrams === undefined ? product.weight_grams : b.weightGrams, volumeCm3: b.volumeCm3 === undefined ? product.volume_cm3 : b.volumeCm3, active: b.active === undefined ? Boolean(product.active) : b.active };
      await verifyProductCodes(this.store,actor.orgId,product.client_id,id,next.sku,next.barcode);
      await this.store.run('UPDATE inventory_products SET sku=?,barcode=?,name=?,unit=?,weight_grams=?,volume_cm3=?,active=?,updated_at=? WHERE id=? AND org_id=?', next.sku, next.barcode, next.name, next.unit, next.weightGrams, next.volumeCm3, next.active ? 1 : 0, now(), id, actor.orgId);
      return { id, ...next };
    }, ['ADMIN', 'OPERATIONS']);
  }
  async createLocation(actor: InventoryActor, input: Row) {
    const b = inventorySchemas.location.parse(input);
    return this.command(actor, 'locations.create', b, async () => {
      const id = randomUUID();
      await this.store.run('INSERT INTO inventory_locations VALUES(?,?,?,?,?,1,?)', id, actor.orgId, b.code, b.name, b.kind, now());
      return { id, code: b.code, name: b.name, kind: b.kind, active: true };
    }, ['ADMIN', 'OPERATIONS']);
  }
  async updateLocation(actor: InventoryActor, id: string, input: Row) {
    const b = inventorySchemas.locationUpdate.parse(input);
    return this.command(actor, `locations.${id}.update`, b, async () => {
      const location = await this.location(actor, id);
      const next = { code: b.code ?? location.code, name: b.name ?? location.name, kind: b.kind ?? location.kind, active: b.active === undefined ? Boolean(location.active) : b.active };
      if (!next.active || next.kind === 'QUARANTINE' && location.kind !== 'QUARANTINE') {
        const balances = await this.store.one('SELECT id FROM inventory_balances WHERE org_id=? AND location_id=? AND quantity>0 LIMIT 1', actor.orgId, id);
        const units = await this.store.one("SELECT id FROM inventory_units WHERE org_id=? AND location_id=? AND status IN('AVAILABLE','RESERVED','VEHICLE','QUARANTINE') LIMIT 1", actor.orgId, id);
        ensure(!balances && !units, 'INVALID_TRANSITION', 'Trasladá o resolvé el stock antes de archivar la ubicación o convertirla en cuarentena.');
      }
      await this.store.run('UPDATE inventory_locations SET code=?,name=?,kind=?,active=? WHERE id=? AND org_id=?', next.code, next.name, next.kind, next.active ? 1 : 0, id, actor.orgId);
      return { id, ...next };
    }, ['ADMIN', 'OPERATIONS']);
  }

  async receive(actor: InventoryActor, input: Row) {
    const b = inventorySchemas.receive.parse(input);
    return this.command(actor, 'receipts.create', b, async () => {
      const client = await this.client(actor, b.clientId), product = await this.product(actor, b.productId, client.id), location = await this.location(actor, b.locationId);
      ensure(product.active && location.active && location.kind !== 'QUARANTINE', 'INVALID_TRANSITION', 'El producto o la ubicación no admite recepciones.');
      if (product.tracking === 'SERIAL') ensure(b.serials?.length === b.quantity, 'VALIDATION_ERROR', 'Indicá un número de serie por unidad.', 400);
      else ensure(!b.serials?.length, 'VALIDATION_ERROR', 'Este producto se controla por cantidad, sin series individuales.', 400);
      if (product.tracking === 'QUANTITY') {
        await this.changeBalance(actor, { clientId: client.id, productId: product.id, locationId: location.id, status: 'AVAILABLE', delta: b.quantity });
        await this.appendMovement(actor, { clientId: client.id, productId: product.id, quantity: b.quantity, toLocationId: location.id, toStatus: 'AVAILABLE', action: 'RECEIVE', reference: b.reference, reason: b.reason, commandId: b.commandId });
      } else {
        const seen = new Set<string>();
        for (const entry of b.serials!) {
          ensure(!seen.has(entry.serial), 'VALIDATION_ERROR', 'Hay números de serie repetidos en la recepción.', 400); seen.add(entry.serial);
          const id = randomUUID(), time = now();
          await this.store.run('INSERT INTO inventory_units(id,org_id,client_id,product_id,serial,barcode,location_id,status,custody_id,order_id,parcel_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,\'AVAILABLE\',\'\',\'\',NULL,?,?)', id, actor.orgId, client.id, product.id, entry.serial, entry.barcode ?? null, location.id, time, time);
          await this.appendMovement(actor, { clientId: client.id, productId: product.id, quantity: 1, serialId: id, toLocationId: location.id, toStatus: 'AVAILABLE', action: 'RECEIVE', reference: b.reference, reason: b.reason, commandId: b.commandId });
        }
      }
      return { id: b.commandId, received: b.quantity, tracking: product.tracking };
    });
  }
  async move(actor: InventoryActor, input: Row) {
    const b = inventorySchemas.move.parse(input);
    return this.command(actor, 'stock.move', b, async () => {
      const product = await this.product(actor, b.productId, b.clientId), from = await this.location(actor, b.fromLocationId), to = await this.location(actor, b.toLocationId);
      await this.client(actor, b.clientId);
      ensure(from.id !== to.id && from.active && to.active && to.kind !== 'QUARANTINE', 'VALIDATION_ERROR', 'Elegí dos ubicaciones distintas y activas para stock disponible.', 400);
      if (product.tracking === 'QUANTITY') {
        ensure(!b.serials?.length, 'VALIDATION_ERROR', 'Este producto se mueve por cantidad.', 400);
        await this.changeBalance(actor, { clientId: b.clientId, productId: product.id, locationId: from.id, status: 'AVAILABLE', delta: -b.quantity });
        await this.changeBalance(actor, { clientId: b.clientId, productId: product.id, locationId: to.id, status: 'AVAILABLE', delta: b.quantity });
        await this.appendMovement(actor, { clientId: b.clientId, productId: product.id, quantity: b.quantity, fromLocationId: from.id, toLocationId: to.id, fromStatus: 'AVAILABLE', toStatus: 'AVAILABLE', action: 'MOVE', reason: b.reason, commandId: b.commandId });
      } else {
        ensure(b.serials?.length === b.quantity && new Set(b.serials).size === b.quantity, 'VALIDATION_ERROR', 'Escaneá una serie distinta por unidad.', 400);
        for (const serial of b.serials!) {
          const unit = await this.store.one('SELECT * FROM inventory_units WHERE org_id=? AND client_id=? AND product_id=? AND serial=?', actor.orgId, b.clientId, product.id, serial);
          ensure(unit && unit.status === 'AVAILABLE' && unit.location_id === from.id, 'INSUFFICIENT_STOCK', `La serie ${serial} no está disponible en origen.`);
          const changed = await this.store.run("UPDATE inventory_units SET location_id=?,updated_at=? WHERE id=? AND status='AVAILABLE' AND location_id=?", to.id, now(), unit.id, from.id);
          ensure(Number(changed.changes) === 1, 'INVENTORY_CONFLICT', 'Cambió la custodia de una serie.');
          await this.appendMovement(actor, { clientId: b.clientId, productId: product.id, quantity: 1, serialId: unit.id, fromLocationId: from.id, toLocationId: to.id, fromStatus: 'AVAILABLE', toStatus: 'AVAILABLE', action: 'MOVE', reason: b.reason, commandId: b.commandId });
        }
      }
      return { id: b.commandId, moved: b.quantity };
    });
  }
  async adjust(actor: InventoryActor, input: Row) {
    const b = inventorySchemas.adjust.parse(input);
    return this.command(actor, 'stock.adjust', b, async () => {
      const product = await this.product(actor, b.productId, b.clientId), location = await this.location(actor, b.locationId);
      await this.client(actor, b.clientId);
      ensure(location.active && location.kind !== 'QUARANTINE' && (b.quantityDelta < 0 || product.active), 'INVALID_TRANSITION', 'El producto o la ubicación no admite ajustes de stock disponible.');
      const amount = Math.abs(b.quantityDelta);
      if (product.tracking === 'QUANTITY') {
        ensure(!b.serials?.length, 'VALIDATION_ERROR', 'Este producto se ajusta por cantidad.', 400);
        await this.changeBalance(actor, { clientId: b.clientId, productId: product.id, locationId: location.id, status: 'AVAILABLE', delta: b.quantityDelta });
        await this.appendMovement(actor, { clientId: b.clientId, productId: product.id, quantity: amount, fromLocationId: b.quantityDelta < 0 ? location.id : null, toLocationId: b.quantityDelta > 0 ? location.id : null, fromStatus: b.quantityDelta < 0 ? 'AVAILABLE' : null, toStatus: b.quantityDelta > 0 ? 'AVAILABLE' : null, action: 'ADJUST', reason: b.reason, commandId: b.commandId });
      } else if (b.quantityDelta > 0) {
        ensure(b.serials?.length === amount && new Set(b.serials.map(x => x.serial)).size === amount, 'VALIDATION_ERROR', 'Indicá series nuevas distintas por cada unidad agregada.', 400);
        for (const item of b.serials!) {
          const id = randomUUID(), time = now();
          await this.store.run('INSERT INTO inventory_units(id,org_id,client_id,product_id,serial,barcode,location_id,status,custody_id,order_id,parcel_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,\'AVAILABLE\',\'\',\'\',NULL,?,?)', id, actor.orgId, b.clientId, product.id, item.serial, item.barcode ?? null, location.id, time, time);
          await this.appendMovement(actor, { clientId: b.clientId, productId: product.id, quantity: 1, serialId: id, toLocationId: location.id, toStatus: 'AVAILABLE', action: 'ADJUST', reason: b.reason, commandId: b.commandId });
        }
      } else {
        ensure(b.serials?.length === amount && new Set(b.serials.map(entry => entry.serial)).size === amount, 'VALIDATION_ERROR', 'Escaneá series distintas para las unidades que se dan de baja.', 400);
        for (const entry of b.serials!) {
          const unit = await this.store.one('SELECT * FROM inventory_units WHERE org_id=? AND client_id=? AND product_id=? AND serial=?', actor.orgId, b.clientId, product.id, entry.serial);
          ensure(unit && unit.status === 'AVAILABLE' && unit.location_id === location.id, 'INSUFFICIENT_STOCK', `La serie ${entry.serial} no está disponible para ajustar.`);
          const changed = await this.store.run("UPDATE inventory_units SET status='ADJUSTED',updated_at=? WHERE id=? AND status='AVAILABLE' AND location_id=?", now(), unit.id, location.id);
          ensure(Number(changed.changes) === 1, 'INVENTORY_CONFLICT', 'Cambió la custodia de una serie.');
          await this.appendMovement(actor, { clientId: b.clientId, productId: product.id, quantity: 1, serialId: unit.id, fromLocationId: location.id, fromStatus: 'AVAILABLE', action: 'ADJUST', reason: b.reason, commandId: b.commandId });
        }
      }
      return { id: b.commandId, quantityDelta: b.quantityDelta };
    });
  }

  private async validateOrderProducts(actor: InventoryActor, order: z.infer<typeof orderInput>) {
    await this.client(actor, order.clientId);
    const products: Row[] = [];
    for (const line of order.lines) {
      const product = await this.product(actor, line.productId, order.clientId);
      ensure(product.active, 'INVALID_TRANSITION', `El producto ${product.sku} está archivado.`);
      products.push(product);
    }
    return products;
  }
  private async insertOrder(actor: InventoryActor, order: z.infer<typeof orderInput>) {
    const products = await this.validateOrderProducts(actor, order);
    ensure(!await this.store.one('SELECT id FROM inventory_orders WHERE org_id=? AND client_id=? AND external_id=?', actor.orgId, order.clientId, order.externalId), 'DUPLICATE_ORDER', `El pedido ${order.externalId} ya existe.`);
    const id = randomUUID(), shipmentId = randomUUID(), time = now();
    await this.store.run('INSERT INTO shipments VALUES(?,?,?,?,?,?,?,?,?,?)', shipmentId, actor.orgId, order.clientId, order.externalId, order.originText || 'Depósito Nexora', order.destination, order.recipientName, order.recipientPhone, order.proofPolicy, time);
    await this.store.run(`INSERT INTO inventory_orders(id,org_id,client_id,external_id,order_date,destination,recipient_name,recipient_phone,origin_text,window_start,window_end,service_minutes,restrictions,status,shipment_id,proof_policy,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, actor.orgId, order.clientId, order.externalId, order.orderDate, order.destination, order.recipientName, order.recipientPhone, order.originText, order.windowStart, order.windowEnd, order.serviceMinutes, order.restrictions, 'DRAFT', shipmentId, order.proofPolicy, time, time);
    for (let index = 0; index < order.lines.length; index++) {
      const line = order.lines[index];
      await this.store.run('INSERT INTO inventory_order_lines VALUES(?,?,?,?,?,?,0,0,0,0)', randomUUID(), actor.orgId, order.clientId, id, line.productId, line.quantity);
    }
    return { id, clientId: order.clientId, externalId: order.externalId, shipmentId, status: 'DRAFT', lineCount: order.lines.length, parcelIds: [] as string[] };
  }
  async createOrder(actor: InventoryActor, input: Row) {
    this.allow(actor, ['ADMIN', 'OPERATIONS']);
    const b = inventorySchemas.order.parse(normalizeOrderAlias(input));
    return this.command(actor, 'orders.create', b, async () => await this.insertOrder(actor, b), ['ADMIN', 'OPERATIONS']);
  }
  async updateOrder(actor: InventoryActor, orderId: string, input: Row) {
    this.allow(actor, ['ADMIN', 'OPERATIONS']);
    const b = inventorySchemas.orderUpdate.parse(input);
    return this.command(actor, `orders.${orderId}.update`, b, async () => {
      const order = await this.record('inventory_orders', orderId, actor);
      ensure(order.status === 'DRAFT', 'INVALID_TRANSITION', 'Only draft orders may be edited.');
      ensure(!await this.store.one('SELECT id FROM inventory_order_parcels WHERE org_id=? AND order_id=? LIMIT 1', actor.orgId, order.id), 'INVALID_TRANSITION', 'The order already has reserved units and cannot be edited.');
      const currentLines = await this.store.all('SELECT product_id,quantity FROM inventory_order_lines WHERE org_id=? AND order_id=? ORDER BY id', actor.orgId, order.id);
      const merged = orderInput.parse({
        clientId: order.client_id, externalId: order.external_id, orderDate: b.orderDate ?? b.date ?? order.order_date,
        destination: b.destination ?? order.destination, recipientName: b.recipientName ?? order.recipient_name,
        recipientPhone: b.recipientPhone ?? order.recipient_phone, originText: b.originText ?? order.origin_text,
        proofPolicy: order.proof_policy,
        windowStart: b.windowStart === undefined ? order.window_start : b.windowStart,
        windowEnd: b.windowEnd === undefined ? order.window_end : b.windowEnd,
        serviceMinutes: b.serviceMinutes === undefined ? order.service_minutes : b.serviceMinutes,
        restrictions: b.restrictions ?? order.restrictions,
        lines: b.lines ?? currentLines.map(line => ({ productId: line.product_id, quantity: line.quantity }))
      });
      await this.validateOrderProducts(actor, merged);
      const time = now();
      await this.store.run(`UPDATE inventory_orders SET order_date=?,destination=?,recipient_name=?,recipient_phone=?,origin_text=?,window_start=?,window_end=?,service_minutes=?,restrictions=?,updated_at=? WHERE id=? AND org_id=? AND status='DRAFT'`, merged.orderDate, merged.destination, merged.recipientName, merged.recipientPhone, merged.originText, merged.windowStart, merged.windowEnd, merged.serviceMinutes, merged.restrictions, time, order.id, actor.orgId);
      await this.store.run('UPDATE shipments SET origin_text=?,destination_text=?,recipient_name=?,recipient_phone=? WHERE id=? AND org_id=?', merged.originText || 'Depósito Nexora', merged.destination, merged.recipientName, merged.recipientPhone, order.shipment_id, actor.orgId);
      if (b.lines) {
        await this.store.run('DELETE FROM inventory_order_lines WHERE org_id=? AND order_id=?', actor.orgId, order.id);
        for (const line of merged.lines) await this.store.run('INSERT INTO inventory_order_lines VALUES(?,?,?,?,?,?,0,0,0,0)', randomUUID(), actor.orgId, order.client_id, order.id, line.productId, line.quantity);
      }
      return await this.orderView(actor, await this.record('inventory_orders', order.id, actor));
    }, ['ADMIN', 'OPERATIONS']);
  }
  async cancelOrder(actor: InventoryActor, orderId: string, input: Row) {
    this.allow(actor, ['ADMIN', 'OPERATIONS']);
    const b = inventorySchemas.orderCancel.parse(input);
    return this.command(actor, `orders.${orderId}.cancel`, b, async () => {
      const order = await this.record('inventory_orders', orderId, actor);
      ensure(order.status === 'DRAFT', 'INVALID_TRANSITION', 'Only draft orders may be cancelled.');
      ensure(!await this.store.one('SELECT id FROM inventory_order_parcels WHERE org_id=? AND order_id=? LIMIT 1', actor.orgId, order.id), 'INVALID_TRANSITION', 'The order already has reserved units and cannot be cancelled.');
      const updated = await this.store.run("UPDATE inventory_orders SET status='CANCELLED',updated_at=? WHERE id=? AND org_id=? AND status='DRAFT'", now(), order.id, actor.orgId);
      ensure(Number(updated.changes) === 1, 'INVALID_TRANSITION', 'The order is no longer a draft.');
      return { id: order.id, status: 'CANCELLED', reason: b.reason };
    }, ['ADMIN', 'OPERATIONS']);
  }
  private async createOrders(actor: InventoryActor, commandInput: Row, orders: z.infer<typeof orderInput>[]) {
    return this.command(actor, 'orders.import', commandInput, async () => {
      for (const order of orders) await this.validateOrderProducts(actor, order);
      for (const order of orders) ensure(!await this.store.one('SELECT id FROM inventory_orders WHERE org_id=? AND client_id=? AND external_id=?', actor.orgId, order.clientId, order.externalId), 'DUPLICATE_ORDER', `El pedido ${order.externalId} ya existe.`);
      const created = [];
      for (const order of orders) created.push(await this.insertOrder(actor, order));
      return { imported: created.length, orders: created };
    }, ['ADMIN', 'OPERATIONS']);
  }
  private async existingImportRun(actor: InventoryActor, commandId: string, digest: string) {
    const prior = await this.store.one('SELECT * FROM inventory_import_runs WHERE org_id=? AND command_id=?', actor.orgId, commandId);
    if (!prior) return undefined;
    ensure(prior.actor_id === actor.id && prior.body_hash === digest, 'DUPLICATE_COMMAND', 'La clave de importación ya se usó con otra identidad o contenido.');
    const errors = JSON.parse(prior.errors) as Row[];
    if (prior.status === 'REJECTED') throw new DomainError('VALIDATION_ERROR', 'La importación anterior fue rechazada.', 400, { runId: prior.id, rowErrors: errors });
    return { ...JSON.parse(prior.result), importRunId: prior.id };
  }
  private async recordImportRun(actor: InventoryActor, input: { commandId: string; source: 'CSV' | 'JSON'; digest: string; status: 'IMPORTED' | 'REJECTED'; rowCount: number; acceptedCount: number; rowErrors: Row[]; result?: Row | null }) {
    return await this.store.transaction(async () => {
      const prior = await this.store.one('SELECT * FROM inventory_import_runs WHERE org_id=? AND command_id=?', actor.orgId, input.commandId);
      if (prior) {
        ensure(prior.actor_id === actor.id && prior.body_hash === input.digest, 'DUPLICATE_COMMAND', 'La clave de importación ya se usó con otra identidad o contenido.');
        return prior;
      }
      const id = randomUUID();
      const errors = input.rowErrors.slice(0, 500).map(error => ({ row: error.row, field: error.field, code: error.code, message: error.message }));
      await this.store.run(`INSERT INTO inventory_import_runs(id,org_id,actor_id,command_id,source,body_hash,status,row_count,accepted_count,errors,result,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, id, actor.orgId, actor.id, input.commandId, input.source, input.digest, input.status, input.rowCount,
      input.acceptedCount, JSON.stringify(errors), input.result ? JSON.stringify(input.result) : null, now());
      return { id, errors: JSON.stringify(errors), status: input.status, result: input.result ? JSON.stringify(input.result) : null };
    });
  }
  private async previewCsvRows(actor: InventoryActor, csv: string) {
    let rows: Array<Record<string, string> & { __row?: string; __columnMismatch?: string }>;
    try { rows = parseCsv(csv); }
    catch (error) {
      const failure = error instanceof DomainError ? error : new DomainError('VALIDATION_ERROR', 'El CSV no se pudo leer.', 400);
      return { orders: [], rowCount: 0, rowErrors: [{ row: 1, field: 'csv', code: failure.code, message: failure.message }], summaries: [] };
    }
    const rowErrors: Row[] = [], groups = new Map<string, { order: Row; firstRow: number }>();
    const headerFields = ['orderDate','destination','recipientName','recipientPhone','originText','proofPolicy','windowStart','windowEnd','serviceMinutes','restrictions'];
    for (const row of rows) {
      const rowNumber = Number(row.__row);
      if (row.__columnMismatch) { rowErrors.push({ row: rowNumber, field: 'csv', code: 'COLUMN_COUNT', message: 'La fila tiene una cantidad de columnas distinta a la cabecera.' }); continue; }
      const candidate = {
        clientId: row.clientId, externalId: row.externalId, orderDate: row.orderDate, destination: row.destination,
        recipientName: row.recipientName, recipientPhone: row.recipientPhone ?? '', originText: row.originText ?? '',
        proofPolicy: row.proofPolicy || 'RECEIVER_PHOTO', windowStart: row.windowStart || null, windowEnd: row.windowEnd || null,
        serviceMinutes: row.serviceMinutes?.trim() ? Number(row.serviceMinutes) : null, restrictions: row.restrictions ?? '',
        productId: row.productId || undefined, sku: row.sku || undefined, quantity: Number(row.quantity)
      };
      const parsed = csvOrderRowInput.safeParse(candidate);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) rowErrors.push({ row: rowNumber, field: issue.path.join('.') || 'row', code: issue.code, message: issue.message });
        continue;
      }
      let product: Row | undefined;
      try {
        await this.client(actor, parsed.data.clientId);
        if (parsed.data.productId) product = await this.product(actor, parsed.data.productId, parsed.data.clientId);
        if (parsed.data.sku) {
          const bySku = await this.store.one('SELECT * FROM inventory_products WHERE org_id=? AND client_id=? AND sku=? AND active=1', actor.orgId, parsed.data.clientId, parsed.data.sku);
          ensure(bySku, 'NOT_FOUND', 'El SKU no está activo para ese cliente.', 404);
          if (product) ensure(product.id === bySku.id, 'VALIDATION_ERROR', 'SKU y productId señalan productos distintos.', 400);
          else product = bySku;
        }
        ensure(product?.active, 'NOT_FOUND', 'El producto no está activo para ese cliente.', 404);
      } catch (error) {
        const failure = error instanceof DomainError ? error : new DomainError('VALIDATION_ERROR', 'No se pudo validar el producto.', 400);
        rowErrors.push({ row: rowNumber, field: parsed.data.productId ? 'productId' : 'sku', code: failure.code, message: failure.message });
        continue;
      }
      const key = `${parsed.data.clientId}\u0000${parsed.data.externalId}`;
      let group = groups.get(key);
      if (!group) {
        group = { firstRow: rowNumber, order: { clientId: parsed.data.clientId, externalId: parsed.data.externalId,
          orderDate: parsed.data.orderDate, destination: parsed.data.destination, recipientName: parsed.data.recipientName,
          recipientPhone: parsed.data.recipientPhone, originText: parsed.data.originText, proofPolicy: parsed.data.proofPolicy,
          windowStart: parsed.data.windowStart, windowEnd: parsed.data.windowEnd, serviceMinutes: parsed.data.serviceMinutes,
          restrictions: parsed.data.restrictions, lines: [] } };
        groups.set(key, group);
      } else {
        for (const field of headerFields) {
          if (group.order[field] !== (parsed.data as unknown as Row)[field]) rowErrors.push({ row: rowNumber, field, code: 'ORDER_HEADER_MISMATCH', message: `El pedido ${parsed.data.externalId} usa valores distintos para ${field} entre sus líneas.` });
        }
      }
      const line = group.order.lines.find((entry: Row) => entry.productId === product!.id);
      if (line) line.quantity += parsed.data.quantity;
      else group.order.lines.push({ productId: product!.id, quantity: parsed.data.quantity });
    }
    const orders: z.infer<typeof orderInput>[] = [];
    for (const group of groups.values()) {
      const parsed = orderInput.safeParse(group.order);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) rowErrors.push({ row: group.firstRow, field: issue.path.join('.') || 'order', code: issue.code, message: issue.message });
        continue;
      }
      if (await this.store.one('SELECT id FROM inventory_orders WHERE org_id=? AND client_id=? AND external_id=?', actor.orgId, parsed.data.clientId, parsed.data.externalId))
        rowErrors.push({ row: group.firstRow, field: 'externalId', code: 'DUPLICATE_ORDER', message: 'El número de pedido ya fue importado para este cliente.' });
      orders.push(parsed.data);
    }
    return { orders, rowCount: rows.length, rowErrors: rowErrors.slice(0, 500), summaries: orders.map(order => ({ clientId: order.clientId, externalId: order.externalId, lineCount: order.lines.length, unitCount: order.lines.reduce((sum, line) => sum + line.quantity, 0) })) };
  }
  async previewImport(actor: InventoryActor, input: Row) {
    this.allow(actor, ['ADMIN', 'OPERATIONS']);
    if (typeof input?.csv === 'string') {
      const parsed = inventorySchemas.importCsv.safeParse(input);
      if (!parsed.success) return { valid: false, rowCount: 0, acceptedCount: 0, orders: [], rowErrors: parsed.error.issues.slice(0, 500).map(issue => ({ row: 1, field: issue.path.join('.') || 'csv', code: issue.code, message: issue.message })) };
      const report = await this.previewCsvRows(actor, parsed.data.csv);
      return { valid: report.rowErrors.length === 0, rowCount: report.rowCount, acceptedCount: report.orders.length, orders: report.summaries, rowErrors: report.rowErrors };
    }
    const rawOrders = Array.isArray(input?.orders) ? input.orders : [];
    const rowErrors: Row[] = [], orders: z.infer<typeof orderInput>[] = [], firstByKey = new Map<string, number>();
    if (!rawOrders.length || rawOrders.length > 200) rowErrors.push({ row: 1, field: 'orders', code: 'INVALID_COUNT', message: 'Incluí entre 1 y 200 pedidos.' });
    for (let index = 0; index < Math.min(rawOrders.length, 200); index++) {
      const normalized = normalizeOrderAlias({ ...rawOrders[index], clientId: rawOrders[index]?.clientId ?? input?.clientId });
      const parsed = orderInput.safeParse(normalized);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) rowErrors.push({ row: index + 1, field: issue.path.join('.') || 'order', code: issue.code, message: issue.message });
        continue;
      }
      const key = `${parsed.data.clientId}\u0000${parsed.data.externalId}`;
      const priorRow = firstByKey.get(key);
      if (priorRow !== undefined) {
        rowErrors.push({ row: index + 1, field: 'externalId', code: 'DUPLICATE_ORDER_IN_FILE', message: `El pedido ya aparece en la fila ${priorRow}.` });
        continue;
      }
      firstByKey.set(key, index + 1);
      try {
        await this.validateOrderProducts(actor, parsed.data);
        if (await this.store.one('SELECT id FROM inventory_orders WHERE org_id=? AND client_id=? AND external_id=?', actor.orgId, parsed.data.clientId, parsed.data.externalId))
          rowErrors.push({ row: index + 1, field: 'externalId', code: 'DUPLICATE_ORDER', message: 'El número de pedido ya fue importado para este cliente.' });
        else orders.push(parsed.data);
      } catch (error) {
        const failure = error instanceof DomainError ? error : new DomainError('VALIDATION_ERROR', 'No se pudo validar este pedido.', 400);
        rowErrors.push({ row: index + 1, field: failure.code === 'NOT_FOUND' || failure.code === 'FORBIDDEN' ? 'clientId/productId' : 'order', code: failure.code, message: failure.message });
      }
    }
    return { valid: rowErrors.length === 0, rowCount: rawOrders.length, acceptedCount: orders.length,
      orders: orders.map(order => ({ clientId: order.clientId, externalId: order.externalId, lineCount: order.lines.length, unitCount: order.lines.reduce((sum, line) => sum + line.quantity, 0) })), rowErrors: rowErrors.slice(0, 500) };
  }
  async importOrders(actor: InventoryActor, input: Row) {
    this.allow(actor, ['ADMIN', 'OPERATIONS']);
    const normalized = normalizeImportAliases(input);
    const parsed = inventorySchemas.importOrders.safeParse(normalized);
    const commandId = typeof normalized?.commandId === 'string' && /^[a-f0-9-]{36}$/i.test(normalized.commandId) ? normalized.commandId : null;
    if (!parsed.success) {
      const rowErrors = parsed.error.issues.slice(0, 500).map(issue => ({ row: Array.isArray(issue.path) && typeof issue.path[1] === 'number' ? Number(issue.path[1]) + 1 : 1, field: issue.path.slice(2).join('.') || 'orders', code: issue.code, message: issue.message }));
      if (commandId) await this.recordImportRun(actor, { commandId, source: 'JSON', digest: bodyHash(normalized), status: 'REJECTED', rowCount: Array.isArray(normalized?.orders) ? normalized.orders.length : 0, acceptedCount: 0, rowErrors });
      throw new DomainError('VALIDATION_ERROR', 'La importación JSON tiene errores de validación.', 400, { rowErrors });
    }
    const b = parsed.data, digest = bodyHash(b);
    const prior = await this.existingImportRun(actor, b.commandId, digest);
    if (prior) return prior;
    const preview = await this.previewImport(actor, b);
    if (!preview.valid) {
      const run = await this.recordImportRun(actor, { commandId: b.commandId, source: 'JSON', digest, status: 'REJECTED', rowCount: preview.rowCount, acceptedCount: preview.acceptedCount, rowErrors: preview.rowErrors });
      if(run.status==='IMPORTED')return {...JSON.parse(run.result),importRunId:run.id};
      throw new DomainError('VALIDATION_ERROR', 'La importación JSON fue rechazada sin crear pedidos.', 400, { runId: run.id, rowErrors: preview.rowErrors });
    }
    try {
      return await this.store.transaction(async () => {
        const result = await this.createOrders(actor, b, b.orders);
        const run = await this.recordImportRun(actor, { commandId: b.commandId, source: 'JSON', digest, status: 'IMPORTED', rowCount: b.orders.length, acceptedCount: b.orders.length, rowErrors: [], result });
        return { ...result, importRunId: run.id };
      });
    } catch (error) {
      if (!(error instanceof DomainError) || error.status >= 500 || ['VERSION_CONFLICT','INVENTORY_CONFLICT'].includes(error.code)) throw error;
      const failure = error;
      const rowErrors = [{ row: 0, field: 'orders', code: failure.code, message: failure.message }];
      const run = await this.recordImportRun(actor, { commandId: b.commandId, source: 'JSON', digest, status: 'REJECTED', rowCount: b.orders.length, acceptedCount: 0, rowErrors });
      if(run.status==='IMPORTED')return {...JSON.parse(run.result),importRunId:run.id};
      throw new DomainError(failure.code, failure.message, failure.status, { runId: run.id, rowErrors });
    }
  }
  async importCsv(actor: InventoryActor, input: Row) {
    this.allow(actor, ['ADMIN', 'OPERATIONS']);
    const parsed = inventorySchemas.importCsv.safeParse(input);
    const commandId = typeof input?.commandId === 'string' && /^[a-f0-9-]{36}$/i.test(input.commandId) ? input.commandId : null;
    const digest = bodyHash(input);
    if (!parsed.success) {
      const rowErrors = parsed.error.issues.slice(0, 500).map(issue => ({ row: 1, field: issue.path.join('.') || 'csv', code: issue.code, message: issue.message }));
      if (commandId) await this.recordImportRun(actor, { commandId, source: 'CSV', digest, status: 'REJECTED', rowCount: 0, acceptedCount: 0, rowErrors });
      throw new DomainError('VALIDATION_ERROR', 'El CSV tiene errores de validación.', 400, { rowErrors });
    }
    const b = parsed.data, prior = await this.existingImportRun(actor, b.commandId, digest);
    if (prior) return prior;
    const prepared = await this.previewCsvRows(actor, b.csv);
    if (prepared.rowErrors.length) {
      const run = await this.recordImportRun(actor, { commandId: b.commandId, source: 'CSV', digest, status: 'REJECTED', rowCount: prepared.rowCount, acceptedCount: 0, rowErrors: prepared.rowErrors });
      if(run.status==='IMPORTED')return {...JSON.parse(run.result),importRunId:run.id};
      throw new DomainError('VALIDATION_ERROR', 'El CSV fue rechazado sin crear pedidos.', 400, { runId: run.id, rowErrors: prepared.rowErrors });
    }
    try {
      return await this.store.transaction(async () => {
        const result = await this.createOrders(actor, b, prepared.orders);
        const run = await this.recordImportRun(actor, { commandId: b.commandId, source: 'CSV', digest, status: 'IMPORTED', rowCount: prepared.rowCount, acceptedCount: prepared.orders.length, rowErrors: [], result });
        return { ...result, importRunId: run.id };
      });
    } catch (error) {
      if (!(error instanceof DomainError) || error.status >= 500 || ['VERSION_CONFLICT','INVENTORY_CONFLICT'].includes(error.code)) throw error;
      const failure = error;
      const rowErrors = [{ row: 0, field: 'csv', code: failure.code, message: failure.message }];
      const run = await this.recordImportRun(actor, { commandId: b.commandId, source: 'CSV', digest, status: 'REJECTED', rowCount: prepared.rowCount, acceptedCount: 0, rowErrors });
      if(run.status==='IMPORTED')return {...JSON.parse(run.result),importRunId:run.id};
      throw new DomainError(failure.code, failure.message, failure.status, { runId: run.id, rowErrors });
    }
  }
  async importHistory(actor: InventoryActor) {
    this.allow(actor, ['ADMIN', 'OPERATIONS']);
    const rows = await this.store.all('SELECT id,command_id,source,status,row_count,accepted_count,errors,result,created_at FROM inventory_import_runs WHERE org_id=? ORDER BY created_at DESC,id DESC LIMIT 200', actor.orgId);
    return { items: rows.map(row => ({ id: row.id, commandId: row.command_id, source: row.source, status: row.status, rowCount: row.row_count, acceptedCount: row.accepted_count,
      rowErrors: JSON.parse(row.errors), createdAt: row.created_at, ...(row.result ? { result: JSON.parse(row.result) } : {}) })) };
  }
  async reserveOrder(actor: InventoryActor, orderId: string, input: Row) {
    const b = inventorySchemas.reserve.parse(input);
    return this.command(actor, `orders.${orderId}.reserve`, b, async () => {
      const order = await this.record('inventory_orders', orderId, actor);
      await this.client(actor, order.client_id);
      ensure(order.status === 'DRAFT', 'INVALID_TRANSITION', 'El pedido ya está reservado o procesado.');
      if (b.locationId) { const location = await this.location(actor, b.locationId); ensure(location.active, 'INVALID_TRANSITION', 'La ubicación está archivada.'); }
      const lines = await this.store.all('SELECT * FROM inventory_order_lines WHERE order_id=? AND org_id=? ORDER BY id', order.id, actor.orgId);
      const planned: Array<{ line: Row; product: Row; locationId: string; unit?: Row }> = [];
      for (const line of lines) {
        const product = await this.product(actor, line.product_id, order.client_id);
        if (product.tracking === 'SERIAL') {
      const available = await this.store.all(`SELECT u.* FROM inventory_units u JOIN inventory_locations l ON l.id=u.location_id AND l.org_id=u.org_id
            WHERE u.org_id=? AND u.client_id=? AND u.product_id=? AND u.status='AVAILABLE' AND l.active=1 AND l.kind<>'QUARANTINE' ${b.locationId ? 'AND u.location_id=?' : ''}
            ORDER BY u.created_at,u.id LIMIT ?`, ...(b.locationId ? [actor.orgId, order.client_id, product.id, b.locationId, line.quantity] : [actor.orgId, order.client_id, product.id, line.quantity]));
          ensure(available.length >= line.quantity, 'INSUFFICIENT_STOCK', `Faltan unidades del producto ${product.sku}.`);
          for (const unit of available) planned.push({ line, product, locationId: unit.location_id, unit });
        } else {
          let remaining = line.quantity;
          const balances = await this.store.all(`SELECT b.* FROM inventory_balances b JOIN inventory_locations l ON l.id=b.location_id AND l.org_id=b.org_id
          WHERE b.org_id=? AND b.client_id=? AND b.product_id=? AND b.status='AVAILABLE' AND b.order_id='' AND l.active=1 AND l.kind<>'QUARANTINE' AND b.quantity>0 ${b.locationId ? 'AND b.location_id=?' : ''}
            ORDER BY l.kind,l.code,b.id`, ...(b.locationId ? [actor.orgId, order.client_id, product.id, b.locationId] : [actor.orgId, order.client_id, product.id]));
          for (const balance of balances) {
            const take = Math.min(remaining, Number(balance.quantity));
            for (let i = 0; i < take; i++) planned.push({ line, product, locationId: balance.location_id });
            remaining -= take;
            if (!remaining) break;
          }
          ensure(remaining === 0, 'INSUFFICIENT_STOCK', `Faltan unidades del producto ${product.sku}.`);
        }
      }
      ensure(planned.length > 0 && planned.length <= 200, 'VALIDATION_ERROR', 'El pedido debe contener entre 1 y 200 unidades reservables.', 400);
      const parcels: Row[] = [];
      for (const item of planned) {
        const orderLine = item.line;
        if (item.unit) {
          const result = await this.store.run("UPDATE inventory_units SET status='RESERVED',order_id=?,updated_at=? WHERE id=? AND status='AVAILABLE'", order.id, now(), item.unit.id);
          ensure(Number(result.changes) === 1, 'INVENTORY_CONFLICT', 'Cambió la disponibilidad de una serie.');
          await this.appendMovement(actor, { clientId: order.client_id, productId: item.product.id, quantity: 1, serialId: item.unit.id, fromLocationId: item.locationId, toLocationId: item.locationId, fromStatus: 'AVAILABLE', toStatus: 'RESERVED', orderId: order.id, action: 'RESERVE', reference: order.external_id, commandId: b.commandId });
          parcels.push(await this.newParcel(actor, order, orderLine, item.product, item.locationId, item.unit.id));
        } else {
          await this.changeBalance(actor, { clientId: order.client_id, productId: item.product.id, locationId: item.locationId, status: 'AVAILABLE', delta: -1 });
          await this.changeBalance(actor, { clientId: order.client_id, productId: item.product.id, locationId: item.locationId, status: 'RESERVED', orderId: order.id, delta: 1 });
          await this.appendMovement(actor, { clientId: order.client_id, productId: item.product.id, quantity: 1, fromLocationId: item.locationId, toLocationId: item.locationId, fromStatus: 'AVAILABLE', toStatus: 'RESERVED', orderId: order.id, action: 'RESERVE', reference: order.external_id, commandId: b.commandId });
          parcels.push(await this.newParcel(actor, order, orderLine, item.product, item.locationId));
        }
        await this.store.run('UPDATE inventory_order_lines SET reserved_quantity=reserved_quantity+1 WHERE id=? AND org_id=?', orderLine.id, actor.orgId);
      }
      await this.store.run("UPDATE inventory_orders SET status='RESERVED',updated_at=? WHERE id=? AND org_id=?", now(), order.id, actor.orgId);
      return { id: order.id, status: 'RESERVED', reserved: parcels.length, shipmentId: order.shipment_id, parcels };
    });
  }

  async loadOrder(actor: InventoryActor, orderId: string, input: Row) {
    const b = inventorySchemas.load.parse(input);
    return this.command(actor, `orders.${orderId}.load`, b, async () => {
      const order = await this.record('inventory_orders', orderId, actor), route = await this.record('routes', b.routeId, actor);
      await this.client(actor, order.client_id);
      ensure(route.state === 'READY' && route.version === b.expectedVersion, 'VERSION_CONFLICT', 'La ruta cambió; actualizá los datos antes de cargar.');
      const vehicleId = route.vehicle_id, claimed = new Set<string>(), parcels: Row[] = [];
      const candidates = await this.store.all(`SELECT op.*,p.code,p.state AS parcel_state,p.custody_type,p.custody_id,p.id AS actual_parcel_id,
          pr.barcode AS product_barcode,u.serial AS unit_serial,u.barcode AS unit_barcode,
          CASE WHEN EXISTS(SELECT 1 FROM route_assignments a WHERE a.org_id=op.org_id AND a.route_id=? AND a.parcel_id=op.parcel_id AND a.active=1) THEN 1 ELSE 0 END AS route_assigned
        FROM inventory_order_parcels op JOIN parcels p ON p.id=op.parcel_id AND p.org_id=op.org_id
        JOIN inventory_products pr ON pr.id=op.product_id AND pr.org_id=op.org_id
        LEFT JOIN inventory_units u ON u.id=op.serial_id AND u.org_id=op.org_id AND u.client_id=op.client_id
        WHERE op.org_id=? AND op.order_id=? ORDER BY op.created_at,op.id`, route.id, actor.orgId, order.id);
      const planned: Row[] = new Array(b.codes.length);
      // A model barcode must never consume a unit explicitly identified later in the batch.
      for (const [index, scan] of b.codes.entries()) {
        const labels = candidates.filter(item => item.code === scan);
        const exact = labels.length ? labels : candidates.filter(item => item.unit_serial === scan || item.unit_barcode === scan);
        if (!exact.length) continue;
        ensure(exact.length === 1, 'VALIDATION_ERROR', `El código ${scan} identifica varias series. Usá la etiqueta del bulto.`, 400);
        const item = exact[0];
        ensure(!claimed.has(item.actual_parcel_id), 'NOT_FOUND', `El código ${scan} repite una unidad del pedido.`, 404);
        planned[index] = item; claimed.add(item.actual_parcel_id);
      }
      for (const [index, scan] of b.codes.entries()) {
        if (planned[index]) continue;
        const item = candidates.find(item => item.product_barcode === scan && item.state === 'RESERVED' && item.route_assigned === 1 && !claimed.has(item.actual_parcel_id));
        ensure(item, 'NOT_FOUND', `El código ${scan} no corresponde a una unidad pendiente del pedido y asignada a esta ruta.`, 404);
        planned[index] = item; claimed.add(item.actual_parcel_id);
      }
      const loadingIds=planned.filter(item=>item.parcel_state!=='LOADED').map(item=>item.actual_parcel_id);
      const loading=loadingIds.length?await this.store.all(`SELECT * FROM parcels WHERE org_id=? AND id IN (${loadingIds.map(()=>'?').join(',')})`,actor.orgId,...loadingIds):[];
      await verifyVehicleCapacity(this.store,actor.orgId,vehicleId,loading);
      for (const item of planned) {
        ensure(await this.store.one('SELECT id FROM route_assignments WHERE org_id=? AND route_id=? AND parcel_id=? AND active=1', actor.orgId, route.id, item.actual_parcel_id), 'FORBIDDEN', 'La unidad no está asignada a esta ruta.', 403);
        if (item.parcel_state === 'LOADED' && item.custody_type === 'VEHICLE' && item.custody_id === vehicleId) { parcels.push({ id: item.actual_parcel_id, code: item.code, alreadyLoaded: true }); continue; }
        ensure(item.state === 'RESERVED' && item.parcel_state === 'RECEIVED' && item.custody_type === 'DEPOT', 'INVALID_TRANSITION', 'La unidad no está en depósito y reservada.');
        await this.store.run('INSERT INTO custody_events VALUES(?,?,?,?,?,?,?,?,?,?,?)', randomUUID(), actor.orgId, item.actual_parcel_id, actor.id, item.custody_type, item.custody_id, 'VEHICLE', vehicleId, 'LOADED', now(), b.commandId);
        const changed = await this.store.run("UPDATE parcels SET state='LOADED',custody_type='VEHICLE',custody_id=? WHERE id=? AND org_id=? AND state='RECEIVED' AND custody_type='DEPOT'", vehicleId, item.actual_parcel_id, actor.orgId);
        ensure(Number(changed.changes) === 1, 'INVENTORY_CONFLICT', 'Cambió la custodia del bulto.');
        await this.transferParcel(actor, item, 'VEHICLE', vehicleId, b.commandId);
        parcels.push({ id: item.actual_parcel_id, code: item.code, alreadyLoaded: false });
      }
      const loaded = parcels.filter(parcel => !parcel.alreadyLoaded).length;
      const version = route.version + (loaded ? 1 : 0);
      if (loaded) await this.store.run('UPDATE routes SET version=version+1 WHERE id=? AND org_id=? AND version=?', route.id, actor.orgId, route.version);
      return { id: order.id, orderId: order.id, routeId: route.id, loaded, alreadyLoaded: parcels.length - loaded, version, parcels, status: (await this.record('inventory_orders', order.id, actor)).status };
    });
  }

  async syncParcelTransition(actor: InventoryActor, parcelId: string, fromState: string, toState: string, custodyType: string, custodyId: string, commandId: string) {
    ensure(actor.role !== 'CUSTOMER', 'FORBIDDEN', 'El cliente no puede modificar la custodia.', 403);
    const transition = toState === 'LOADED' || toState === 'IN_TRANSIT' ? 'VEHICLE' : toState === 'DELIVERED' ? 'DELIVERED' : toState === 'RETURNED_TO_DEPOT' ? 'QUARANTINE' : null;
    if (!transition || toState === 'IN_TRANSIT') {
      if (toState === 'IN_TRANSIT') {
        const found = await this.store.one('SELECT order_id FROM inventory_order_parcels WHERE org_id=? AND parcel_id=?', actor.orgId, parcelId);
        if (found) await this.store.run("UPDATE inventory_orders SET status='IN_TRANSIT',updated_at=? WHERE id=? AND org_id=? AND status IN('LOADED','PARTIALLY_LOADED','RESERVED')", now(), found.order_id, actor.orgId);
      }
      return { synced: false };
    }
    return await this.store.transaction(async () => {
      const item = await this.store.one('SELECT * FROM inventory_order_parcels WHERE org_id=? AND parcel_id=?', actor.orgId, parcelId);
      if (!item) return { synced: false };
      const wanted = transition;
      if (item.state === wanted) return { synced: true, alreadySynced: true, orderId: item.order_id };
      ensure(item.state === (wanted === 'VEHICLE' ? 'RESERVED' : 'VEHICLE'), 'INVALID_TRANSITION', `La unidad tiene estado ${item.state}; no se puede sincronizar ${fromState} → ${toState}.`);
      if (wanted === 'DELIVERED') {
        const policy=await this.store.one('SELECT c.delivery_provider FROM inventory_orders o LEFT JOIN client_delivery_policies c ON c.org_id=o.org_id AND c.client_id=o.client_id WHERE o.id=? AND o.org_id=?',item.order_id,actor.orgId);
        const link = await this.store.one("SELECT provider_result,evidence_state FROM quad_parcel_links WHERE org_id=? AND parcel_id=?", actor.orgId, parcelId);
        if(policy?.delivery_provider==='NEXORA'&&!link){
          ensure(await this.store.one('SELECT id FROM evidence WHERE org_id=? AND parcel_id=?',actor.orgId,parcelId),'EVIDENCE_REQUIRED','La entrega del pedido Nexora requiere una foto del bulto.');
        }else{
        ensure(link?.provider_result === 'DELIVERED' && link.evidence_state === 'COMPLETE', 'EVIDENCE_REQUIRED', 'La entrega del pedido requiere resultado y evidencia completos de QuadMinds.');
        const proofs = await this.store.all(`SELECT q.kind,e.sha256 FROM quad_proofs q JOIN evidence e ON e.id=q.evidence_id AND e.org_id=q.org_id
          WHERE q.org_id=? AND q.parcel_id=?`, actor.orgId, parcelId);
        const photos = new Set(proofs.filter(proof => proof.kind === 'PHOTO').map(proof => proof.sha256));
        const signatures = new Set(proofs.filter(proof => proof.kind === 'SIGNATURE').map(proof => proof.sha256));
        ensure([...photos].some(photo => [...signatures].some(signature => signature !== photo)), 'EVIDENCE_REQUIRED', 'La entrega del pedido requiere foto y firma distintas almacenadas desde QuadMinds.');
        }
      }
      const location = wanted === 'QUARANTINE' ? await this.quarantineLocation(actor, custodyId) : { id: item.location_id };
      if (wanted === 'VEHICLE') ensure(custodyType === 'VEHICLE', 'INVALID_TRANSITION', 'La carga debe quedar bajo custodia del vehículo.');
      if (wanted === 'DELIVERED') ensure(custodyType === 'RECIPIENT', 'INVALID_TRANSITION', 'La entrega debe quedar bajo custodia del destinatario.');
      if (wanted === 'QUARANTINE') ensure(custodyType === 'DEPOT' && location.id, 'INVALID_TRANSITION', 'El retorno debe recibirse en depósito.');
      await this.transferParcel(actor, item, wanted, wanted === 'VEHICLE' ? custodyId : location.id, commandId);
      return { synced: true, orderId: item.order_id, parcelId };
    });
  }

  async returnOrder(actor: InventoryActor, orderId: string, input: Row) {
    const b = inventorySchemas.return.parse(input);
    return this.command(actor, `orders.${orderId}.return`, b, async () => {
      const order = await this.record('inventory_orders', orderId, actor);
      await this.client(actor, order.client_id);
      const location = await this.location(actor, b.locationId);
      ensure(location.active && location.kind === 'QUARANTINE', 'INVALID_TRANSITION', 'Los retornos deben recibirse en una ubicación activa de cuarentena.');
      const results = [];
      for (const entry of b.returns) {
        const returned = await this.record('returns', entry.returnId, actor);
        const item = await this.store.one('SELECT op.*,p.state AS parcel_state,p.custody_type,p.custody_id FROM inventory_order_parcels op JOIN parcels p ON p.id=op.parcel_id WHERE op.org_id=? AND op.order_id=? AND op.parcel_id=?', actor.orgId, order.id, returned.parcel_id);
        ensure(item && returned.state === 'AUTHORIZED' && item.parcel_state === 'RETURN_PENDING' && item.custody_type === 'VEHICLE', 'INVALID_TRANSITION', 'El retorno autorizado no pertenece a este pedido o ya fue recibido.');
        const evidence = await this.store.one('SELECT id FROM evidence WHERE id=? AND org_id=? AND parcel_id=?', entry.evidenceId, actor.orgId, returned.parcel_id);
        ensure(evidence, 'EVIDENCE_REQUIRED', 'La foto de recepción debe corresponder al bulto.');
        await this.store.run('INSERT INTO return_evidence VALUES(?,?,?,?,?,?,?,?)', returned.id, actor.orgId, 'DEPOT', entry.evidenceId, actor.id, now(), 'RECEIPT', null);
        const receiptId = randomUUID();
        await this.store.run('INSERT INTO receipts VALUES(?,?,?,?,?,?)', receiptId, actor.orgId, order.shipment_id, location.id, actor.id, now());
        await this.store.run('INSERT INTO receipt_items VALUES(?,?)', receiptId, returned.parcel_id);
        await this.store.run('INSERT INTO custody_events VALUES(?,?,?,?,?,?,?,?,?,?,?)', randomUUID(), actor.orgId, returned.parcel_id, actor.id, 'VEHICLE', returned.custody_id ?? item.custody_id, 'DEPOT', location.id, 'RETURN_RECEIVED', now(), b.commandId);
        await this.store.run("UPDATE parcels SET state='RETURNED_TO_DEPOT',custody_type='DEPOT',custody_id=? WHERE id=? AND org_id=? AND state='RETURN_PENDING'", location.id, returned.parcel_id, actor.orgId);
        await this.store.run("UPDATE returns SET state='AT_DEPOT',depot_receipt_id=? WHERE id=? AND org_id=? AND state='AUTHORIZED'", receiptId, returned.id, actor.orgId);
        await this.store.run('UPDATE route_assignments SET active=0 WHERE org_id=? AND parcel_id=?', actor.orgId, returned.parcel_id);
        await this.store.run('UPDATE routes SET version=version+1 WHERE id=? AND org_id=?', returned.route_id, actor.orgId);
        const syncResult = await this.syncParcelTransition(actor, returned.parcel_id, 'RETURN_PENDING', 'RETURNED_TO_DEPOT', 'DEPOT', location.id, b.commandId);
        results.push({ id: returned.id, state: 'AT_DEPOT', parcelId: returned.parcel_id, synced: syncResult.synced });
      }
      return { id: order.id, returns: results, status: (await this.record('inventory_orders', order.id, actor)).status };
    });
  }

  async release(actor: InventoryActor, orderId: string, input: Row) {
    const b = inventorySchemas.release.parse(input);
    return this.command(actor, `orders.${orderId}.release`, b, async () => {
      const order = await this.record('inventory_orders', orderId, actor);
      await this.client(actor, order.client_id);
      const target = await this.location(actor, b.locationId);
      ensure(target.active && target.kind !== 'QUARANTINE', 'INVALID_TRANSITION', 'Seleccioná una ubicación disponible para el stock liberado.');
      const items = await this.store.all(`SELECT op.*,u.serial FROM inventory_order_parcels op LEFT JOIN inventory_units u ON u.id=op.serial_id AND u.org_id=op.org_id WHERE op.org_id=? AND op.order_id=? AND op.state='QUARANTINE'
        ${b.parcelIds?.length ? `AND op.parcel_id IN (${b.parcelIds.map(() => '?').join(',')})` : ''} ORDER BY op.created_at,op.id`, actor.orgId, order.id, ...(b.parcelIds ?? []));
      const selected = b.serials?.length ? items.filter(item => b.serials!.includes(item.serial)) : items;
      if (b.serials?.length) ensure(selected.length === b.serials.length, 'NOT_FOUND', 'Alguna serie indicada no está en cuarentena.', 404);
      let count = 0;
      for (const item of selected) {
        if (item.serial_id) {
          const unit = await this.store.one('SELECT * FROM inventory_units WHERE id=? AND org_id=? AND status=\'QUARANTINE\'', item.serial_id, actor.orgId);
          ensure(unit, 'INVENTORY_CONFLICT', 'La serie ya no está en cuarentena.');
          const changed = await this.store.run("UPDATE inventory_units SET status='AVAILABLE',custody_id='',order_id='',location_id=?,updated_at=? WHERE id=? AND status='QUARANTINE'", target.id, now(), unit.id);
          ensure(Number(changed.changes) === 1, 'INVENTORY_CONFLICT', 'Cambió la custodia de una serie.');
        } else {
          await this.changeBalance(actor, { clientId: order.client_id, productId: item.product_id, locationId: item.location_id, status: 'QUARANTINE', orderId: order.id, delta: -1 });
          await this.changeBalance(actor, { clientId: order.client_id, productId: item.product_id, locationId: target.id, status: 'AVAILABLE', delta: 1 });
        }
        await this.store.run("UPDATE inventory_order_parcels SET state='RELEASED',location_id=?,custody_id='',updated_at=? WHERE id=? AND org_id=? AND state='QUARANTINE'", target.id, now(), item.id, actor.orgId);
        await this.appendMovement(actor, { clientId: order.client_id, productId: item.product_id, quantity: 1, serialId: item.serial_id, fromLocationId: item.location_id, toLocationId: target.id, fromStatus: 'QUARANTINE', toStatus: 'AVAILABLE', orderId: order.id, parcelId: item.parcel_id, action: 'RELEASE', reason: b.reason, commandId: b.commandId });
        count++;
      }
      if (b.parcelIds?.length) ensure(count === b.parcelIds.length, 'INVALID_TRANSITION', 'Algún bulto indicado no está en cuarentena.');
      return { id: order.id, released: count };
    });
  }

  async catalogPage(actor:InventoryActor,input:unknown={}){
    this.readAccess(actor);
    const page=z.object({clientId:z.uuid().optional(),q:z.string().trim().max(200).default(''),limit:z.coerce.number().int().min(1).max(200).default(25),offset:z.coerce.number().int().min(0).max(1000000).default(0)}).parse(input);
    if(page.clientId)await this.client(actor,page.clientId,true);
    const clientId=actor.role==='CUSTOMER'?actor.clientId:page.clientId;
    ensure(actor.role!=='CUSTOMER'||clientId,'FORBIDDEN','Sesión sin cliente.',403);
    const filters=['p.org_id=?'],args:any[]=[actor.orgId];if(clientId){filters.push('p.client_id=?');args.push(clientId);}
    if(page.q){filters.push('(lower(p.sku) LIKE ? OR lower(p.name) LIKE ? OR lower(p.barcode) LIKE ?)');args.push(...Array(3).fill('%'+page.q.toLowerCase()+'%'));}
    const from=`FROM inventory_products p WHERE ${filters.join(' AND ')}`;
    const total=Number((await this.store.one(`SELECT COUNT(*) AS n ${from}`,...args))?.n??0);
    const rows=await this.store.all(`SELECT p.* ${from} ORDER BY p.name,p.id LIMIT ? OFFSET ?`,...args,page.limit,page.offset);
    return {items:rows.map((row):Row=>({...camel(row),active:Boolean(row.active)})),total,limit:page.limit,offset:page.offset};
  }
  async lookupCode(actor:InventoryActor,input:unknown):Promise<{product:Row|null;unit:Row|null}>{
    this.readAccess(actor);const body=z.object({clientId:z.uuid(),code:z.string().trim().min(1).max(200)}).parse(input);await this.client(actor,body.clientId,true);
    const products=await this.store.all('SELECT * FROM inventory_products WHERE org_id=? AND client_id=? AND active=1 AND (lower(sku)=? OR lower(barcode)=?) LIMIT 2',actor.orgId,body.clientId,body.code.toLowerCase(),body.code.toLowerCase());
    const units=await this.store.all('SELECT * FROM inventory_units WHERE org_id=? AND client_id=? AND (lower(serial)=? OR lower(barcode)=?) LIMIT 2',actor.orgId,body.clientId,body.code.toLowerCase(),body.code.toLowerCase());
    ensure(products.length<=1&&units.length<=1,'VALIDATION_ERROR','El código identifica más de un producto o serie. Revisá el catálogo.',409);
    ensure(!products[0]||!units[0]||products[0].id===units[0].product_id,'VALIDATION_ERROR','El código coincide con un producto y una serie diferentes. Revisá el catálogo.',409);
    const product=products[0]??(units[0]?await this.product(actor,units[0].product_id,body.clientId):null);
    return {product:product?{...camel(product),active:Boolean(product.active)}:null,unit:units[0]?camel(units[0]):null};
  }
  async stockPage(actor:InventoryActor,input:unknown={}){
    this.readAccess(actor);const page=z.object({clientId:z.uuid().optional(),status:z.enum(['','AVAILABLE','RESERVED','VEHICLE','QUARANTINE','DELIVERED','ADJUSTED']).default(''),q:z.string().trim().max(200).default(''),limit:z.coerce.number().int().min(1).max(200).default(25),offset:z.coerce.number().int().min(0).max(1000000).default(0)}).parse(input);
    if(page.clientId)await this.client(actor,page.clientId,true);const clientId=actor.role==='CUSTOMER'?actor.clientId:page.clientId;ensure(actor.role!=='CUSTOMER'||clientId,'FORBIDDEN','Sesión sin cliente.',403);
    const filters=['x.org_id=?'],args:any[]=[actor.orgId];if(clientId){filters.push('x.client_id=?');args.push(clientId);}if(page.status){filters.push('x.status=?');args.push(page.status);}if(page.q){filters.push('(lower(p.sku) LIKE ? OR lower(p.name) LIKE ? OR lower(x.serial) LIKE ? OR lower(l.code) LIKE ? OR lower(c.name) LIKE ? OR lower(o.external_id) LIKE ?)');args.push(...Array(6).fill('%'+page.q.toLowerCase()+'%'));}
    const source=`FROM (SELECT id,org_id,client_id,product_id,location_id,status,order_id,quantity,'' AS serial FROM inventory_balances WHERE quantity>0 UNION ALL SELECT id,org_id,client_id,product_id,location_id,status,order_id,1 AS quantity,serial FROM inventory_units) x JOIN inventory_products p ON p.id=x.product_id AND p.org_id=x.org_id JOIN inventory_locations l ON l.id=x.location_id AND l.org_id=x.org_id JOIN clients c ON c.id=x.client_id AND c.org_id=x.org_id LEFT JOIN inventory_orders o ON o.id=x.order_id AND o.org_id=x.org_id WHERE ${filters.join(' AND ')}`;
    const total=Number((await this.store.one(`SELECT COUNT(*) AS n ${source}`,...args))?.n??0);
    const rows=await this.store.all(`SELECT x.id AS key,x.client_id,c.name AS client_name,x.product_id,p.sku,p.name AS product_name,x.serial,p.barcode,l.code AS location_code,x.quantity,p.unit,x.status,COALESCE(o.external_id,'—') AS order_reference ${source} ORDER BY p.sku,x.id LIMIT ? OFFSET ?`,...args,page.limit,page.offset);
    return {items:rows.map(camel),total,limit:page.limit,offset:page.offset};
  }
  async bootstrap(actor: InventoryActor, clientFilter?: string) {
    this.readAccess(actor);
    let clientId: string | undefined;
    if (actor.role === 'CUSTOMER') { ensure(actor.clientId, 'FORBIDDEN', 'La sesión de cliente no tiene un cliente asociado.', 403); clientId = actor.clientId; }
    else if (clientFilter) { await this.client(actor, clientFilter); clientId = clientFilter; }
    const args = clientId ? [actor.orgId, clientId] : [actor.orgId];
    const predicate = clientId ? 'AND client_id=?' : '';
    const customerLocationPredicate = actor.role === 'CUSTOMER' ? `AND (
      EXISTS(SELECT 1 FROM inventory_balances b WHERE b.org_id=l.org_id AND b.location_id=l.id AND b.client_id=? AND b.quantity<>0)
      OR EXISTS(SELECT 1 FROM inventory_units u WHERE u.org_id=l.org_id AND u.location_id=l.id AND u.client_id=?)
      OR EXISTS(SELECT 1 FROM inventory_movements m WHERE m.org_id=l.org_id AND m.client_id=? AND (m.from_location_id=l.id OR m.to_location_id=l.id))
    )` : '';
    const customerLocationArgs = actor.role === 'CUSTOMER' ? [clientId!, clientId!, clientId!] : [];
    const movementFilter = `FROM inventory_movements WHERE org_id=? ${clientId ? 'AND client_id=?' : ''}`;
    const movementArgs = clientId ? [actor.orgId, clientId] : [actor.orgId];
    const [products, locations, balances, units, movements, productCount, locationCount, balanceCount, unitCount, movementCount, balanceTotals, unitTotals] = await Promise.all([
      this.store.all(`SELECT * FROM inventory_products WHERE org_id=? ${predicate} ORDER BY name,id LIMIT 1000`, ...args),
      this.store.all(`SELECT l.* FROM inventory_locations l WHERE l.org_id=? ${customerLocationPredicate} ORDER BY l.code,l.id LIMIT 1000`, actor.orgId, ...customerLocationArgs),
      this.store.all(`SELECT * FROM inventory_balances WHERE org_id=? ${predicate} AND quantity>0 ORDER BY product_id,location_id,status LIMIT 1000`, ...args),
      this.store.all(`SELECT * FROM inventory_units WHERE org_id=? ${predicate} ORDER BY created_at,id LIMIT 1001`, ...args),
      this.store.all(`SELECT * ${movementFilter} ORDER BY created_at DESC,id DESC LIMIT 501`, ...movementArgs),
      this.store.one(`SELECT COUNT(*) AS count FROM inventory_products WHERE org_id=? ${predicate}`, ...args),
      this.store.one(`SELECT COUNT(*) AS count FROM inventory_locations l WHERE l.org_id=? ${customerLocationPredicate}`, actor.orgId, ...customerLocationArgs),
      this.store.one(`SELECT COUNT(*) AS count FROM inventory_balances WHERE org_id=? ${predicate} AND quantity>0`, ...args),
      this.store.one(`SELECT COUNT(*) AS count FROM inventory_units WHERE org_id=? ${predicate}`, ...args),
      this.store.one(`SELECT COUNT(*) AS count ${movementFilter}`, ...movementArgs),
      this.store.all(`SELECT client_id,status,SUM(quantity) AS quantity FROM inventory_balances WHERE org_id=? ${predicate} GROUP BY client_id,status`, ...args),
      this.store.all(`SELECT client_id,status,COUNT(*) AS quantity FROM inventory_units WHERE org_id=? ${predicate} GROUP BY client_id,status`, ...args)
    ]);
    const totals = { AVAILABLE: 0, RESERVED: 0, VEHICLE: 0, QUARANTINE: 0 };
    const clientTotals: Record<string, typeof totals> = {};
    for (const row of [...balanceTotals,...unitTotals]) {
      const status = row.status as keyof typeof totals;
      if (!(status in totals)) continue;
      const quantity = Number(row.quantity);
      totals[status] += quantity;
      clientTotals[row.client_id] ??= { AVAILABLE: 0, RESERVED: 0, VEHICLE: 0, QUARANTINE: 0 };
      clientTotals[row.client_id][status] += quantity;
    }
    const limits = { products: 1000, locations: 1000, balances: 1000, units: 1000, movements: 500 };
    const hasMore = { products: Number(productCount?.count??0)>limits.products, locations: Number(locationCount?.count??0)>limits.locations, balances: Number(balanceCount?.count??0)>limits.balances, units: Number(unitCount?.count ?? 0) > limits.units!, movements: Number(movementCount?.count ?? 0) > limits.movements };
    return { products: products.map(row => ({ ...camel(row), active: Boolean(row.active) })), locations: locations.map(row => ({ ...camel(row), active: Boolean(row.active) })), balances: balances.map(camel), units: units.slice(0, 1000).map(camel), movements: movements.slice(0, 500).map(camel),
      counts: { products: Number(productCount?.count ?? 0), locations: Number(locationCount?.count ?? 0), balances: Number(balanceCount?.count ?? 0), units: Number(unitCount?.count ?? 0), movements: Number(movementCount?.count ?? 0) }, limits, hasMore, totals, clientTotals };
  }
  async orders(actor: InventoryActor, clientFilter?: string,options:unknown={}) {
    this.readAccess(actor);
    let clientId: string | undefined;
    if (actor.role === 'CUSTOMER') { ensure(actor.clientId, 'FORBIDDEN', 'La sesión de cliente no tiene un cliente asociado.', 403); clientId = actor.clientId; }
    else if (clientFilter) { await this.client(actor, clientFilter); clientId = clientFilter; }
    const page=z.object({limit:z.coerce.number().int().min(1).max(200).default(50),offset:z.coerce.number().int().min(0).max(1000000).default(0),q:z.string().trim().max(200).default(''),status:z.enum(['','DRAFT','RESERVED','PARTIALLY_LOADED','LOADED','IN_TRANSIT','PARTIAL','DELIVERED','CANCELLED','EXCEPTION']).default('')}).parse(options);
    const predicates=['o.org_id=?'],args:any[]=[actor.orgId];
    if(clientId){predicates.push('o.client_id=?');args.push(clientId);}
    if(page.status){predicates.push('o.status=?');args.push(page.status);}
    if(page.q){predicates.push('(lower(o.external_id) LIKE ? OR lower(o.recipient_name) LIKE ? OR lower(o.destination) LIKE ? OR lower(o.recipient_phone) LIKE ? OR lower(c.name) LIKE ?)');args.push(...Array(5).fill('%'+page.q.toLowerCase()+'%'));}
    const from=`FROM inventory_orders o JOIN clients c ON c.id=o.client_id AND c.org_id=o.org_id WHERE ${predicates.join(' AND ')}`;
    const total=Number((await this.store.one(`SELECT COUNT(*) AS n ${from}`,...args))?.n??0);
    const orders = await this.store.all(`SELECT o.*,c.name AS client_name ${from} ORDER BY o.order_date DESC,o.created_at DESC,o.id LIMIT ? OFFSET ?`,...args,page.limit,page.offset);
    const items: Row[] = [];
    for (const order of orders) items.push(await this.orderView(actor, order));
    return { items,total,limit:page.limit,offset:page.offset,hasMore:page.offset+items.length<total };
  }
  async order(actor: InventoryActor, orderId: string) {
    this.readAccess(actor);
    const order = await this.record('inventory_orders', orderId, actor);
    await this.client(actor, order.client_id, true);
    return await this.orderView(actor, order);
  }
  private async orderView(actor: InventoryActor, order: Row) {
    const [lines, parcels] = await Promise.all([
      this.store.all(`SELECT l.*,p.sku,p.name,p.unit,p.tracking,
        CASE WHEN p.tracking='SERIAL' THEN (SELECT COUNT(*) FROM inventory_units u JOIN inventory_locations loc ON loc.id=u.location_id AND loc.org_id=u.org_id WHERE u.org_id=l.org_id AND u.client_id=p.client_id AND u.product_id=l.product_id AND u.status='AVAILABLE' AND loc.active=1 AND loc.kind<>'QUARANTINE')
        ELSE (SELECT COALESCE(SUM(b.quantity),0) FROM inventory_balances b JOIN inventory_locations loc ON loc.id=b.location_id AND loc.org_id=b.org_id WHERE b.org_id=l.org_id AND b.client_id=p.client_id AND b.product_id=l.product_id AND b.status='AVAILABLE' AND b.order_id='' AND b.quantity>0 AND loc.active=1 AND loc.kind<>'QUARANTINE') END AS available_quantity
        FROM inventory_order_lines l JOIN inventory_products p ON p.id=l.product_id AND p.org_id=l.org_id WHERE l.order_id=? AND l.org_id=? ORDER BY l.id`, order.id, actor.orgId),
      this.store.all(`SELECT p.id,p.code,op.product_id,op.serial_id,op.state,q.provider_result,q.evidence_state,qp.kind,e.sha256
        FROM inventory_order_parcels op JOIN parcels p ON p.id=op.parcel_id AND p.org_id=op.org_id
        LEFT JOIN quad_parcel_links q ON q.parcel_id=op.parcel_id AND q.org_id=op.org_id
        LEFT JOIN quad_proofs qp ON qp.parcel_id=op.parcel_id AND qp.org_id=op.org_id
        LEFT JOIN evidence e ON e.id=qp.evidence_id AND e.org_id=qp.org_id
        WHERE op.order_id=? AND op.org_id=? ORDER BY p.code`, order.id, actor.orgId)
    ]);
    const parcelsById = new Map<string, Row>();
    for (const row of parcels) {
      let parcel = parcelsById.get(row.id);
      if (!parcel) {
        parcel = { id: row.id, code: row.code, productId: row.product_id, serialId: row.serial_id, state: row.state,
          deliveryResult: row.provider_result ?? 'PENDING', evidenceState: row.evidence_state ?? 'PENDING', photoHashes: new Set<string>(), signatureHashes: new Set<string>() };
        parcelsById.set(row.id, parcel);
      }
      if (row.kind === 'PHOTO' && row.sha256) parcel.photoHashes.add(row.sha256);
      if (row.kind === 'SIGNATURE' && row.sha256) parcel.signatureHashes.add(row.sha256);
    }
    const orderParcels = [...parcelsById.values()].map(parcel => {
      const distinctProofs = [...parcel.photoHashes].some(photo => [...parcel.signatureHashes].some(signature => signature !== photo));
      return { id: parcel.id, code: parcel.code, productId: parcel.productId, serialId: parcel.serialId, state: parcel.state,
        deliveryResult: parcel.deliveryResult, evidenceState: parcel.evidenceState,
        evidenceStatus: parcel.deliveryResult === 'DELIVERED' && parcel.evidenceState === 'COMPLETE' && distinctProofs ? 'COMPLETE' : 'PENDING' };
    });
    return { ...camel(order), parcelIds: orderParcels.map(parcel => parcel.id), parcels: orderParcels,
      lines: lines.map(line => ({ id: line.id, productId: line.product_id, sku: line.sku, name: line.name, unit: line.unit, tracking: line.tracking, requested: line.quantity, reserved: line.reserved_quantity, loaded: line.loaded_quantity, delivered: line.delivered_quantity, returned: line.returned_quantity, available: Number(line.available_quantity) })) };
  }
  async exportCsv(actor: InventoryActor, clientFilter?: string) {
    this.readAccess(actor);
    let clientId: string | undefined;
    if (actor.role === 'CUSTOMER') {
      ensure(actor.clientId, 'FORBIDDEN', 'La sesión de cliente no tiene un cliente asociado.', 403);
      clientId = actor.clientId;
    } else if (clientFilter) {
      await this.client(actor, clientFilter);
      clientId = clientFilter;
    }
    const args = clientId ? [actor.orgId, clientId] : [actor.orgId];
    const predicate = clientId ? 'AND client_id=?' : '';
    const [rawProducts, rawLocations, rawBalances, rawUnits] = await Promise.all([
      this.store.all(`SELECT * FROM inventory_products WHERE org_id=? ${predicate} ORDER BY name,id`, ...args),
      this.store.all('SELECT * FROM inventory_locations WHERE org_id=? ORDER BY code,id', actor.orgId),
      this.store.all(`SELECT * FROM inventory_balances WHERE org_id=? ${predicate} AND quantity>0 ORDER BY product_id,location_id,status,custody_id,order_id`, ...args),
      this.store.all(`SELECT * FROM inventory_units WHERE org_id=? ${predicate} ORDER BY created_at,id`, ...args)
    ]);
    const products = rawProducts.map(camel), locations = rawLocations.map(camel), balances = rawBalances.map(camel), units = rawUnits.map(camel);
    const rows = [['type','clientId','productId','sku','name','locationId','location','status','custodyId','orderId','quantity','serial','barcode']];
    const productMap = new Map(products.map(row => [row.id, row]));
    const locationMap = new Map(locations.map(row => [row.id, row]));
    for (const balance of balances) {
      const product: any = productMap.get(balance.productId), location: any = locationMap.get(balance.locationId);
      if (product) rows.push(['QUANTITY',balance.clientId,balance.productId,product.sku,product.name,balance.locationId,location?.name ?? '',balance.status,balance.custodyId,balance.orderId,balance.quantity,'','']);
    }
    for (const unit of units) {
      const product: any = productMap.get(unit.productId), location: any = locationMap.get(unit.locationId);
      if (product) rows.push(['SERIAL',unit.clientId,unit.productId,product.sku,product.name,unit.locationId,location?.name ?? '',unit.status,unit.custodyId,unit.orderId,1,unit.serial,unit.barcode ?? '']);
    }
    const quote = (value: unknown) => {
      const raw = String(value ?? '');
      const unsafePrefix = /^[\u0000-\u001f\u007f\ufeff]/.test(raw) || /^[\s\u0000-\u001f\u007f\ufeff]*[=+\-@]/.test(raw);
      const text = typeof value === 'string' && unsafePrefix ? `'${raw}` : raw;
      return `"${text.replaceAll('"', '""')}"`;
    };
    return rows.map(row => row.map(quote).join(',')).join('\r\n') + '\r\n';
  }
}

function parseCsv(source: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.length === 0) quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); if (row.some(cell => cell.trim())) rows.push(row); row = []; field = ''; }
    else field += char;
  }
  ensure(!quoted, 'VALIDATION_ERROR', 'El CSV contiene una comilla sin cerrar.', 400);
  if (field || row.length) { row.push(field.replace(/\r$/, '')); if (row.some(cell => cell.trim())) rows.push(row); }
  ensure(rows.length >= 2, 'VALIDATION_ERROR', 'El CSV debe tener cabecera y al menos una línea.', 400);
  const headers = rows[0].map((header, index) => header.trim().replace(/^\uFEFF/, '') || '__empty_' + index);
  if (headers.includes('date') && !headers.includes('orderDate')) headers[headers.indexOf('date')] = 'orderDate';
  ensure(new Set(headers).size === headers.length, 'VALIDATION_ERROR', 'El CSV contiene nombres de columna duplicados.', 400);
  const required = ['clientId','externalId','orderDate','destination','recipientName','quantity'];
  ensure(required.every(name => headers.includes(name)), 'VALIDATION_ERROR', `Faltan columnas CSV: ${required.filter(name => !headers.includes(name)).join(', ')}.`, 400);
  ensure(headers.includes('productId') || headers.includes('sku'), 'VALIDATION_ERROR', 'Incluí la columna SKU o productId.', 400);
  ensure(rows.length - 1 <= 10000, 'VALIDATION_ERROR', 'El CSV supera el máximo de 10.000 líneas.', 400);
  return rows.slice(1).map((values, index) => {
    const parsed: Record<string, string> = Object.fromEntries(headers.map((header, i) => [header, (values[i] ?? '').trim()]));
    parsed.__row = String(index + 2);
    if (values.length !== headers.length) parsed.__columnMismatch = String(values.length);
    return parsed;
  });
}
