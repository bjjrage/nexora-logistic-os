import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { authorize, type Actor } from './auth.ts';
import type { Database } from './database.ts';
import { Logistics } from './domain.ts';
import { ensure } from './errors.ts';

const required = (max: number) => z.string().trim().min(1).max(max);
const optional = (max: number) => z.string().trim().max(max).optional();
const id = z.uuid();
const optionalId = id.nullish();
const date = z.iso.date();
const integer = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const money = integer.nonnegative();
const amount = integer.positive();
const vatRate = z.number().int().min(0).max(100);
const tax = { vatRate, vatPyg: money, netPyg: money };
const line = z.strictObject({ description: required(300), totalPyg: amount, ...tax });
const payment = z.strictObject({
  amountPyg: amount, eventDate: date, accountId: id, method: required(60), reference: optional(180),
});
const applicationsSchema = z.array(z.strictObject({ documentId: id, amountPyg: amount })).min(1).max(100);
const reason = required(500);
const reversal = { id, reason, eventDate: date };
const command = <Action extends string, Shape extends z.ZodRawShape>(action: Action, shape: Shape) =>
  z.strictObject({ commandId: id, action: z.literal(action), ...shape });
const schema = z.discriminatedUnion('action', [
  command('PARTY', {
    id: id.optional(), name: required(200), ruc: z.string().trim().regex(/^\d{1,15}(?:-\d)?$/).optional(),
    contact: optional(300), kind: z.enum(['SUPPLIER', 'BENEFICIARY']), active: z.boolean(),
  }),
  command('CATEGORY', { name: required(120) }),
  command('CENTER', { name: required(120) }),
  command('ACCOUNT', { name: required(120), kind: z.enum(['CASH', 'BANK']) }),
  command('DOCUMENT', {
    partyId: id, nature: z.enum(['EXPENSE', 'PURCHASE', 'ASSET', 'REMUNERATION']), categoryId: optionalId,
    centerId: optionalId, documentDate: date, dueDate: date, condition: z.enum(['CASH', 'CREDIT']),
    reference: optional(180), lines: z.array(line).min(1).max(100), payment: payment.optional(),
  }),
  command('SETTLEMENT', {
    partyId: id, kind: z.enum(['PAYMENT', 'ADVANCE', 'CREDIT']), amountPyg: amount,
    eventDate: date, accountId: optionalId, method: optional(60), reference: optional(180),
    description: optional(300), vatRate: vatRate.optional(), vatPyg: money.optional(),
    netPyg: money.optional(), applications: applicationsSchema.optional(),
  }),
  command('APPLY', { settlementId: id, applications: applicationsSchema }),
  command('UNAPPLY', { id, reason }),
  command('VOID_DOCUMENT', { id, reason }),
  command('REVERSE_SETTLEMENT', reversal),
  command('MOVEMENT', {
    accountId: id, kind: z.enum(['OPENING', 'ENTRY', 'EXIT', 'TRANSFER']),
    destinationAccountId: optionalId, amountPyg: integer, eventDate: date, reference: required(180),
  }),
  command('REVERSE_MOVEMENT', reversal),
  command('BUDGET', { categoryId: id, month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), amountPyg: money.nullable() }),
]);

type Command = z.infer<typeof schema>;
type Action<A extends Command['action']> = Extract<Command, { action: A }>;
type Scope = { org: string; actor: string; now: string };
type Settlement = Omit<Action<'SETTLEMENT'>, 'action' | 'commandId'>;
type Movement = {
  accountId: string; kind: 'OPENING' | 'ENTRY' | 'EXIT' | 'TRANSFER' | 'REVERSAL';
  amountPyg: number; eventDate: string; reference: string; settlementId?: string;
  transferId?: string; reversalOf?: string;
};
type Table = 'parties' | 'categories' | 'centers' | 'accounts' | 'documents' | 'settlements' |
  'applications' | 'movements' | 'import_rows';

function validateTax(total: number, rate: number, vat: number, net: number) {
  ensure(BigInt(vat) + BigInt(net) === BigInt(total) && (rate > 0 || vat === 0),
    'VALIDATION_ERROR', 'El IVA y el neto deben coincidir con el total de la línea.', 400);
}

export class Procurement {
  private store: Database;
  private logistics: Logistics;
  private clock: () => Date;

  constructor(store: Database, clock = () => new Date()) {
    this.store = store;
    this.logistics = new Logistics(store);
    this.clock = clock;
  }

  async execute(actor: Actor, raw: unknown, importRowId?: string) {
    authorize(actor, ['ADMIN']);
    const input = schema.parse(raw);
    return this.logistics.command(actor, 'PROCUREMENT_' + input.action, { ...input, importRowId }, ['ADMIN'], async () => {
      const scope = { org: actor.orgId, actor: actor.id, now: this.clock().toISOString() };
      if (importRowId) {
        ensure(input.action === 'DOCUMENT' || input.action === 'SETTLEMENT', 'VALIDATION_ERROR', 'Operación de importación inválida.', 400);
        const row = await this.row(scope, 'import_rows', importRowId);
        ensure(row.state === 'PENDING', 'IMPORT_RESOLVED', 'La fila ya fue resuelta.');
      }
      switch (input.action) {
        case 'PARTY': return this.party(scope, input);
        case 'CATEGORY': return this.named(scope, 'categories', input.name);
        case 'CENTER': return this.named(scope, 'centers', input.name);
        case 'ACCOUNT': return this.named(scope, 'accounts', input.name, input.kind);
        case 'DOCUMENT': return this.document(scope, input, importRowId);
        case 'SETTLEMENT': return this.settlement(scope, input, importRowId);
        case 'APPLY': return { id: input.settlementId, applicationIds: await this.apply(scope, input.settlementId, input.applications) };
        case 'UNAPPLY': return this.unapply(scope, input);
        case 'VOID_DOCUMENT': return this.voidDocument(scope, input);
        case 'REVERSE_SETTLEMENT': return this.reverseSettlement(scope, input);
        case 'MOVEMENT': return this.move(scope, input);
        case 'REVERSE_MOVEMENT': return this.reverseMovement(scope, input);
        case 'BUDGET': {
          await this.row(scope, 'categories', input.categoryId);
          await this.store.run(`INSERT INTO procurement_budgets(org_id,category_id,month,amount_pyg) VALUES(?,?,?,?)
             ON CONFLICT(org_id,category_id,month) DO UPDATE SET amount_pyg=excluded.amount_pyg`,
          scope.org, input.categoryId, input.month, input.amountPyg);
          return { id: input.categoryId };
        }
      }
    });
  }

  private async row(scope: Scope, table: Table, id: string) {
    const row = await this.store.one(`SELECT * FROM procurement_${table} WHERE org_id=? AND id=?`, scope.org, id);
    ensure(row, 'NOT_FOUND', 'No se encontró el registro autorizado.', 404);
    return row;
  }

  private async event(scope: Scope, subjectId: string, action: string, reason?: string) {
    await this.store.run(`INSERT INTO procurement_events(org_id,id,subject_id,action,actor_id,reason,created_at)
      VALUES(?,?,?,?,?,?,?)`, scope.org, randomUUID(), subjectId, action, scope.actor, reason ?? null, scope.now);
  }

  private async named(scope: Scope, table: 'accounts' | 'categories' | 'centers', name: string, kind?: 'CASH' | 'BANK') {
    const existing = await this.store.one(`SELECT id FROM procurement_${table} WHERE org_id=? AND lower(name)=lower(?)`, scope.org, name);
    ensure(!existing, 'DUPLICATE_NAME', 'Ya existe un registro con ese nombre.');
    const id = randomUUID();
    if (table === 'accounts') {
      await this.store.run('INSERT INTO procurement_accounts(org_id,id,name,kind) VALUES(?,?,?,?)', scope.org, id, name, kind!);
    } else {
      await this.store.run(`INSERT INTO procurement_${table}(org_id,id,name) VALUES(?,?,?)`, scope.org, id, name);
    }
    await this.event(scope, id, 'CREATE_' + table.toUpperCase());
    return { id };
  }

  private async party(scope: Scope, input: Action<'PARTY'>) {
    const id = input.id ?? randomUUID();
    if (input.ruc) {
      const existing = await this.store.one('SELECT id FROM procurement_parties WHERE org_id=? AND ruc=? AND id<>?', scope.org, input.ruc, id);
      ensure(!existing, 'DUPLICATE_RUC', 'Ya existe una contraparte con ese RUC.');
    }
    const fields = [input.name, input.ruc ?? null, input.contact || null, input.kind, Number(input.active)] as const;
    if (input.id) {
      await this.row(scope, 'parties', id);
      await this.store.run(`UPDATE procurement_parties SET name=?,ruc=?,contact=?,kind=?,active=?
        WHERE org_id=? AND id=?`, ...fields, scope.org, id);
    } else {
      await this.store.run(`INSERT INTO procurement_parties(org_id,id,name,ruc,contact,kind,active,created_at)
        VALUES(?,?,?,?,?,?,?,?)`, scope.org, id, ...fields, scope.now);
    }
    await this.event(scope, id, input.id ? 'UPDATE_PARTY' : 'CREATE_PARTY');
    return { id };
  }

  private async document(scope: Scope, input: Action<'DOCUMENT'>, importRowId?: string) {
    const party = await this.row(scope, 'parties', input.partyId);
    ensure(Number(party.active) === 1, 'INACTIVE_PARTY', 'La contraparte está inactiva.');
    if (input.categoryId) await this.row(scope, 'categories', input.categoryId);
    if (input.centerId) await this.row(scope, 'centers', input.centerId);
    ensure(input.dueDate >= input.documentDate, 'VALIDATION_ERROR', 'El vencimiento debe ser igual o posterior al documento.', 400);
    let total = 0n, vat = 0n;
    for (const line of input.lines) {
      validateTax(line.totalPyg, line.vatRate, line.vatPyg, line.netPyg);
      total += BigInt(line.totalPyg);
      vat += BigInt(line.vatPyg);
    }
    ensure(total <= BigInt(Number.MAX_SAFE_INTEGER), 'VALIDATION_ERROR', 'El total excede el importe máximo admitido.', 400);
    const id = randomUUID();
    const description = input.lines[0].description;
    await this.store.run(`INSERT INTO procurement_documents(org_id,id,party_id,nature,category_id,center_id,document_date,
      due_date,condition,reference,description,total_pyg,vat_pyg,net_pyg,actor_id,created_at,import_row_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, scope.org, id, input.partyId, input.nature, input.categoryId ?? null, input.centerId ?? null,
    input.documentDate, input.dueDate, input.condition, input.reference || null, description, Number(total), Number(vat), Number(total - vat), scope.actor, scope.now, importRowId ?? null);
    for (const [index, line] of input.lines.entries()) {
      await this.store.run(`INSERT INTO procurement_lines(org_id,id,document_id,position,description,total_pyg,vat_rate,vat_pyg,net_pyg)
        VALUES(?,?,?,?,?,?,?,?,?)`, scope.org, randomUUID(), id, index + 1, line.description, line.totalPyg, line.vatRate, line.vatPyg, line.netPyg);
    }
    await this.event(scope, id, 'CONFIRM_DOCUMENT');
    if (!input.payment) return { id };
    const result = await this.settlement(scope, {
      ...input.payment, partyId: input.partyId, kind: 'PAYMENT',
      applications: [{ documentId: id, amountPyg: input.payment.amountPyg }],
    }, importRowId);
    return { id, settlementId: result.id, applicationIds: result.applicationIds };
  }

  private async settlement(scope: Scope, input: Settlement, importRowId?: string) {
    const party = await this.row(scope, 'parties', input.partyId);
    // An inactive party can still be settled when payment is applied immediately to existing debt.
    ensure(Number(party.active) === 1 || Boolean(input.applications?.length && input.kind !== 'ADVANCE'), 'INACTIVE_PARTY', 'La contraparte está inactiva.');
    const hasTax = input.vatRate !== undefined || input.vatPyg !== undefined || input.netPyg !== undefined;
    if (input.kind === 'CREDIT') {
      ensure(!input.accountId && !input.method, 'VALIDATION_ERROR', 'Una nota de crédito no registra una salida de dinero.', 400);
      if (hasTax) {
        ensure(input.vatRate !== undefined && input.vatPyg !== undefined && input.netPyg !== undefined,
          'VALIDATION_ERROR', 'Completá tasa, IVA y neto del comprobante.', 400);
        validateTax(input.amountPyg, input.vatRate, input.vatPyg, input.netPyg);
      }
    } else {
      ensure(input.accountId && input.method && !hasTax, 'VALIDATION_ERROR', 'Indicá la cuenta y el medio del pago.', 400);
      await this.validateAccountDate(scope, input.accountId, input.eventDate);
    }
    const id = randomUUID();
    await this.store.run(`INSERT INTO procurement_settlements(org_id,id,party_id,kind,amount_pyg,event_date,account_id,method,reference,
      description,actor_id,created_at,import_row_id,vat_rate,vat_pyg,net_pyg) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    scope.org, id, input.partyId, input.kind, input.amountPyg, input.eventDate, input.accountId ?? null, input.method || null,
    input.reference || null, input.description || null, scope.actor, scope.now, importRowId ?? null,
    input.vatRate ?? null, input.vatPyg ?? null, input.netPyg ?? null);
    if (input.accountId) await this.insertMovement(scope, {
      accountId: input.accountId, kind: 'EXIT', amountPyg: -input.amountPyg, eventDate: input.eventDate,
      reference: input.reference || input.method!, settlementId: id,
    });
    await this.event(scope, id, 'REGISTER_' + input.kind);
    const applicationIds = input.applications ? await this.apply(scope, id, input.applications) : [];
    return { id, applicationIds };
  }

  private async applied(scope: Scope, field: 'document_id' | 'settlement_id', id: string) {
    const aggregate = await this.store.one(`SELECT COALESCE(SUM(amount_pyg),0) AS amount FROM procurement_applications
      WHERE org_id=? AND ${field}=? AND reversed_at IS NULL`, scope.org, id);
    return BigInt(aggregate?.amount ?? 0);
  }

  private async apply(scope: Scope, settlementId: string, applications: z.infer<typeof applicationsSchema>) {
    const settlement = await this.row(scope, 'settlements', settlementId);
    ensure(!settlement.reversed_at, 'SETTLEMENT_REVERSED', 'El pago, anticipo o crédito ya fue revertido.');
    let available = BigInt(settlement.amount_pyg) - await this.applied(scope, 'settlement_id', settlementId);
    const ids: string[] = [];
    for (const application of applications) {
      const document = await this.row(scope, 'documents', application.documentId);
      ensure(settlement.party_id === document.party_id && !document.voided_at,
        'INCOMPATIBLE_DOCUMENT', 'Seleccioná un documento vigente de la misma contraparte.');
      const balance = BigInt(document.total_pyg) - await this.applied(scope, 'document_id', document.id);
      const value = BigInt(application.amountPyg);
      ensure(value <= available, 'INSUFFICIENT_AVAILABLE', 'El importe supera el disponible del pago, anticipo o crédito.');
      ensure(value <= balance, 'INSUFFICIENT_BALANCE', 'El importe supera el saldo del documento.');
      available -= value;
      const id = randomUUID();
      await this.store.run(`INSERT INTO procurement_applications(org_id,id,party_id,settlement_id,document_id,amount_pyg,actor_id,created_at)
        VALUES(?,?,?,?,?,?,?,?)`, scope.org, id, settlement.party_id, settlementId, document.id, application.amountPyg, scope.actor, scope.now);
      await this.event(scope, document.id, 'APPLY_SETTLEMENT');
      await this.event(scope, settlementId, 'APPLY_SETTLEMENT');
      ids.push(id);
    }
    return ids;
  }

  private async unapply(scope: Scope, input: Action<'UNAPPLY'>) {
    const application = await this.row(scope, 'applications', input.id);
    ensure(!application.reversed_at, 'ALREADY_REVERSED', 'La aplicación ya fue deshecha.');
    await this.undoApplication(scope, application.id, application.document_id, application.settlement_id, input.reason);
    return { id: input.id };
  }

  private async undoApplication(scope: Scope, applicationId: string, documentId: string, settlementId: string, reason: string) {
    await this.store.run('UPDATE procurement_applications SET reversed_at=? WHERE org_id=? AND id=?', scope.now, scope.org, applicationId);
    await this.event(scope, documentId, 'UNAPPLY_SETTLEMENT', reason);
    await this.event(scope, settlementId, 'UNAPPLY_SETTLEMENT', reason);
  }

  private async voidDocument(scope: Scope, input: Action<'VOID_DOCUMENT'>) {
    const document = await this.row(scope, 'documents', input.id);
    ensure(!document.voided_at, 'ALREADY_VOIDED', 'El documento ya está anulado.');
    ensure(await this.applied(scope, 'document_id', input.id) === 0n,
      'DOCUMENT_HAS_APPLICATIONS', 'Deshacé las aplicaciones vigentes antes de anular.');
    await this.store.run('UPDATE procurement_documents SET voided_at=? WHERE org_id=? AND id=?', scope.now, scope.org, input.id);
    await this.event(scope, input.id, 'VOID_DOCUMENT', input.reason);
    return { id: input.id };
  }

  private async reverseSettlement(scope: Scope, input: Action<'REVERSE_SETTLEMENT'>) {
    const settlement = await this.row(scope, 'settlements', input.id);
    ensure(!settlement.reversed_at, 'ALREADY_REVERSED', 'La operación ya está revertida.');
    ensure(input.eventDate >= settlement.event_date, 'VALIDATION_ERROR', 'La fecha del reverso debe ser igual o posterior a la operación.', 400);
    const applications = await this.store.all(`SELECT id,document_id FROM procurement_applications
      WHERE org_id=? AND settlement_id=? AND reversed_at IS NULL ORDER BY id`, scope.org, input.id);
    for (const application of applications) await this.undoApplication(scope, application.id, application.document_id, input.id, input.reason);
    const movement = await this.store.one(`SELECT * FROM procurement_movements WHERE org_id=? AND settlement_id=? AND kind='EXIT'`, scope.org, input.id);
    if (movement) await this.reverseOneMovement(scope, movement.id, input.eventDate, input.reason);
    await this.store.run('UPDATE procurement_settlements SET reversed_at=? WHERE org_id=? AND id=?', scope.now, scope.org, input.id);
    await this.event(scope, input.id, 'REVERSE_SETTLEMENT', input.reason);
    return { id: input.id };
  }

  private async validateAccountDate(scope: Scope, accountId: string, date: string, opening = false) {
    await this.row(scope, 'accounts', accountId);
    const current = await this.store.one(`SELECT m.event_date FROM procurement_movements m WHERE m.org_id=? AND m.account_id=?
      AND m.kind='OPENING' AND NOT EXISTS (SELECT 1 FROM procurement_movements r WHERE r.org_id=m.org_id AND r.reversal_of=m.id)`,
    scope.org, accountId);
    if (opening) {
      ensure(!current, 'OPENING_EXISTS', 'La cuenta ya tiene un saldo inicial vigente.');
      const first = await this.store.one(`SELECT event_date FROM procurement_movements WHERE org_id=? AND account_id=?
        AND kind NOT IN ('OPENING','REVERSAL') ORDER BY event_date,id LIMIT 1`, scope.org, accountId);
      ensure(!first || date <= first.event_date, 'OPENING_AFTER_MOVEMENT', 'El saldo inicial debe cubrir el primer movimiento registrado.');
    } else {
      ensure(!current || date >= current.event_date, 'MOVEMENT_BEFORE_OPENING', 'La fecha del movimiento no puede preceder al saldo inicial.');
    }
  }

  private async insertMovement(scope: Scope, movement: Movement) {
    const id = randomUUID();
    await this.store.run(`INSERT INTO procurement_movements(org_id,id,account_id,kind,amount_pyg,event_date,reference,
      settlement_id,transfer_id,reversal_of,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    scope.org, id, movement.accountId, movement.kind, movement.amountPyg, movement.eventDate, movement.reference,
    movement.settlementId ?? null, movement.transferId ?? null, movement.reversalOf ?? null, scope.actor, scope.now);
    return id;
  }

  private async move(scope: Scope, input: Action<'MOVEMENT'>) {
    const { accountId, kind, amountPyg, eventDate, reference, destinationAccountId } = input;
    ensure(kind === 'OPENING' || amountPyg > 0, 'VALIDATION_ERROR', 'El importe debe ser mayor que cero.', 400);
    ensure(kind === 'TRANSFER' ? Boolean(destinationAccountId && accountId !== destinationAccountId) : !destinationAccountId,
      'VALIDATION_ERROR', 'Seleccioná dos cuentas distintas para una transferencia.', 400);
    await this.validateAccountDate(scope, accountId, eventDate, kind === 'OPENING');
    if (kind === 'TRANSFER' && destinationAccountId) {
      await this.validateAccountDate(scope, destinationAccountId, eventDate);
      const transferId = randomUUID();
      const fields = { kind, eventDate, reference, transferId } as const;
      const id = await this.insertMovement(scope, { ...fields, accountId, amountPyg: -amountPyg });
      const destinationId = await this.insertMovement(scope, { ...fields, accountId: destinationAccountId, amountPyg });
      await this.event(scope, id, 'TRANSFER_OUT');
      await this.event(scope, destinationId, 'TRANSFER_IN');
      return { id, destinationId, transferId };
    }
    const id = await this.insertMovement(scope, { accountId, kind, amountPyg: kind === 'EXIT' ? -amountPyg : amountPyg, eventDate, reference });
    await this.event(scope, id, kind);
    return { id };
  }

  private async reverseOneMovement(scope: Scope, id: string, eventDate: string, reason: string) {
    const original = await this.row(scope, 'movements', id);
    const prior = await this.store.one('SELECT id FROM procurement_movements WHERE org_id=? AND reversal_of=?', scope.org, id);
    ensure(original.kind !== 'REVERSAL' && !prior, 'ALREADY_REVERSED', 'El movimiento ya fue revertido o es un reverso.');
    ensure(eventDate >= original.event_date, 'VALIDATION_ERROR', 'La fecha del reverso debe ser igual o posterior al movimiento.', 400);
    if (original.kind !== 'OPENING') await this.validateAccountDate(scope, original.account_id, eventDate);
    const reversedId = await this.insertMovement(scope, {
      accountId: original.account_id, kind: 'REVERSAL', amountPyg: -Number(original.amount_pyg), eventDate,
      reference: original.reference, settlementId: original.settlement_id ?? undefined, reversalOf: id,
    });
    await this.event(scope, id, 'REVERSE_MOVEMENT', reason);
    await this.event(scope, reversedId, 'REVERSAL', reason);
    return reversedId;
  }

  private async reverseMovement(scope: Scope, input: Action<'REVERSE_MOVEMENT'>) {
    const original = await this.row(scope, 'movements', input.id);
    ensure(!original.settlement_id, 'REVERSE_LINKED_PAYMENT', 'Revertí el pago vinculado para corregir esta salida.');
    const reversalId = await this.reverseOneMovement(scope, input.id, input.eventDate, input.reason);
    if (original.transfer_id) {
      const counterpart = await this.store.one(`SELECT id FROM procurement_movements
        WHERE org_id=? AND transfer_id=? AND id<>?`, scope.org, original.transfer_id, input.id);
      ensure(counterpart, 'TRANSFER_INCOMPLETE', 'Falta el movimiento asociado a la transferencia.');
      await this.reverseOneMovement(scope, counterpart.id, input.eventDate, input.reason);
    }
    return { id: input.id, reversalId };
  }
}
