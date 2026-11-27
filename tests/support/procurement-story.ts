import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Actor } from '../../server/auth.ts';
import type { Database } from '../../server/database.ts';
import { Procurement } from '../../server/procurement.ts';

const date = '2026-11-26';
export const command = (fields: Record<string, unknown>) => ({ commandId: randomUUID(), ...fields });
const withCode = (code: string) => (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === code;

export async function exerciseProcurement(store: Database, second: Database = store) {
  const orgId = randomUUID(), otherOrgId = randomUUID();
  const actor: Actor = { orgId, id: randomUUID(), role: 'ADMIN', name: 'QA', driverId: null };
  const other: Actor = { ...actor, orgId: otherOrgId, id: randomUUID() };
  for (const person of [actor, other]) {
    await store.run('INSERT INTO organizations(id,name,timezone) VALUES(?,?,?)', person.orgId, 'Compras sintéticas QA', 'America/Asuncion');
    await store.run('INSERT INTO users(id,org_id,username,name,password_hash,role) VALUES(?,?,?,?,?,?)',
      person.id, person.orgId, 'qa-' + person.id, person.name, 'unused', person.role);
  }
  const primary = new Procurement(store), concurrent = new Procurement(second);
  const run = (fields: Record<string, unknown>) => primary.execute(actor, command(fields));
  const party = await run({ action: 'PARTY', name: 'Proveedor QA', kind: 'SUPPLIER', active: true });
  const account = await run({ action: 'ACCOUNT', name: 'Banco QA', kind: 'BANK' });
  const cash = await run({ action: 'ACCOUNT', name: 'Caja QA', kind: 'CASH' });
  const category = await run({ action: 'CATEGORY', name: 'Insumos QA' });
  const open = await run({ action: 'MOVEMENT', kind: 'OPENING', accountId: account.id, eventDate: date, amountPyg: 0, reference: 'Apertura QA' });
  await assert.rejects(run({ action: 'MOVEMENT', kind: 'OPENING', accountId: account.id, eventDate: date, amountPyg: 0, reference: 'Duplicado QA' }), withCode('OPENING_EXISTS'));
  const document = {
    action: 'DOCUMENT', partyId: party.id, categoryId: category.id, nature: 'PURCHASE',
    documentDate: date, dueDate: '2026-12-03', condition: 'CREDIT',
    lines: [
      { description: 'Insumos QA', totalPyg: 770_000, vatRate: 10, vatPyg: 70_000, netPyg: 700_000 },
      { description: 'Accesorios QA', totalPyg: 230_000, vatRate: 0, vatPyg: 0, netPyg: 230_000 },
    ],
  };
  const payment = { amountPyg: 400_000, accountId: account.id, method: 'Transferencia', eventDate: date };
  const first = command({ ...document, payment });
  const [result, repeated] = await Promise.all([primary.execute(actor, first), concurrent.execute(actor, first)]);
  assert.deepEqual(result, repeated);
  const scalar = async (sql: string, ...ids: string[]) => Number((await store.one(sql, orgId, ...ids))?.n);
  const balance = (id: string) => scalar(`SELECT d.total_pyg-(SELECT COALESCE(SUM(amount_pyg),0) FROM procurement_applications a
    WHERE a.org_id=d.org_id AND a.document_id=d.id AND a.reversed_at IS NULL) AS n FROM procurement_documents d WHERE org_id=? AND id=?`, id);
  const available = (id: string) => scalar(`SELECT s.amount_pyg-(SELECT COALESCE(SUM(amount_pyg),0) FROM procurement_applications a
    WHERE a.org_id=s.org_id AND a.settlement_id=s.id AND a.reversed_at IS NULL) AS n FROM procurement_settlements s WHERE org_id=? AND id=?`, id);
  const movementTotal = (id: string) => scalar('SELECT COALESCE(SUM(amount_pyg),0) AS n FROM procurement_movements WHERE org_id=? AND account_id=?', id);
  assert.equal(await balance(result.id), 600_000);
  assert.equal(await movementTotal(account.id), -400_000);
  assert.equal(await scalar('SELECT count(*) AS n FROM procurement_documents WHERE org_id=?'), 1);
  await assert.rejects(primary.execute(actor, { ...first, lines: [document.lines[0]] }), withCode('DUPLICATE_COMMAND'));
  await assert.rejects(run({ ...document, payment: { ...payment, amountPyg: 1_000_001 } }), withCode('INSUFFICIENT_BALANCE'));
  assert.equal(await scalar('SELECT count(*) AS n FROM procurement_documents WHERE org_id=?'), 1, 'failed payable and payment both rolled back');
  assert.equal(await scalar('SELECT count(*) AS n FROM procurement_settlements WHERE org_id=?'), 1);

  const advance = await run({ action: 'SETTLEMENT', kind: 'ADVANCE', partyId: party.id, ...payment, amountPyg: 300_000 });
  const application = { action: 'APPLY', settlementId: advance.id, applications: [{ documentId: result.id, amountPyg: 300_000 }] };
  const race = await Promise.allSettled([run(application), concurrent.execute(actor, command(application))]);
  assert.equal(race.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(race.filter(x => x.status === 'rejected' && withCode('INSUFFICIENT_AVAILABLE')(x.reason)).length, 1);
  const applied = race.find(x => x.status === 'fulfilled');
  assert.ok(applied);
  assert.equal(await balance(result.id), 300_000);
  assert.equal(await available(advance.id), 0);
  assert.equal(await movementTotal(account.id), -700_000);
  const credit = await run({ action: 'SETTLEMENT', kind: 'CREDIT', eventDate: date, partyId: party.id, amountPyg: 100_000,
    reference: 'NC-QA', applications: [{ documentId: result.id, amountPyg: 100_000 }] });
  assert.equal(await balance(result.id), 200_000);
  assert.equal(await movementTotal(account.id), -700_000);
  const appliedId = applied.value.applicationIds?.[0];
  assert.ok(appliedId);
  await run({ action: 'UNAPPLY', id: appliedId, reason: 'Reimputación QA' });
  assert.equal(await balance(result.id), 500_000);
  assert.equal(await available(advance.id), 300_000);
  assert.equal(await movementTotal(account.id), -700_000);
  assert.equal(await scalar('SELECT count(*) AS n FROM procurement_movements WHERE org_id=? AND settlement_id=?', advance.id), 1);
  await assert.rejects(run({ action: 'VOID_DOCUMENT', id: result.id, reason: 'Corrección' }), withCode('DOCUMENT_HAS_APPLICATIONS'));
  await run({ action: 'REVERSE_SETTLEMENT', id: result.settlementId, eventDate: date, reason: 'Pago duplicado QA' });
  assert.equal(await balance(result.id), 900_000);
  assert.equal(await movementTotal(account.id), -300_000);
  await run({ action: 'REVERSE_SETTLEMENT', id: credit.id, eventDate: date, reason: 'Crédito corregido QA' });
  assert.equal(await balance(result.id), 1_000_000);
  assert.equal(await movementTotal(account.id), -300_000);
  await run({ action: 'VOID_DOCUMENT', id: result.id, reason: 'Documento corregido QA' });
  assert.equal(await scalar('SELECT count(*) AS n FROM procurement_events WHERE org_id=? AND subject_id=? AND action=\'VOID_DOCUMENT\' AND reason=\'Documento corregido QA\' AND actor_id=?', result.id, actor.id), 1);

  const docOne = await run({ ...document, reference: 'R1' });
  const docTwo = await run({ ...document, reference: 'R2' });
  const distributed = await run({ action: 'SETTLEMENT', kind: 'PAYMENT', partyId: party.id, ...payment, amountPyg: 300_000,
    applications: [{ documentId: docOne.id, amountPyg: 100_000 }, { documentId: docTwo.id, amountPyg: 200_000 }] });
  assert.equal(await available(distributed.id), 0);
  const sameDebt = { action: 'APPLY', settlementId: advance.id, applications: [{ documentId: docTwo.id, amountPyg: 300_001 }] };
  await assert.rejects(run(sameDebt), withCode('INSUFFICIENT_AVAILABLE'));
  const competingParty = await run({ action: 'PARTY', name: 'Otra contraparte QA', kind: 'BENEFICIARY', active: true });
  const incompatible = await run({ ...document, partyId: competingParty.id });
  await assert.rejects(run({ action: 'APPLY', settlementId: advance.id, applications: [{ documentId: incompatible.id, amountPyg: 300_000 }] }), withCode('INCOMPATIBLE_DOCUMENT'));
  const large = await run({ action: 'SETTLEMENT', kind: 'CREDIT', partyId: party.id, eventDate: date, amountPyg: 1_600_000 });
  const raceDebt = await Promise.allSettled([docOne, docOne].map((doc, index) => [primary, concurrent][index].execute(actor,
    command({ action: 'APPLY', settlementId: large.id, applications: [{ documentId: doc.id, amountPyg: 800_000 }] }))));
  assert.equal(raceDebt.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(raceDebt.filter(x => x.status === 'rejected' && withCode('INSUFFICIENT_BALANCE')(x.reason)).length, 1);
  assert.equal(await balance(docOne.id), 100_000);
  assert.equal(await balance(docTwo.id), 800_000);
  const transfer = await run({ action: 'MOVEMENT', kind: 'TRANSFER', accountId: account.id,
    destinationAccountId: cash.id, eventDate: date, amountPyg: 50_000, reference: 'Traspaso QA' });
  assert.equal(await movementTotal(account.id), -650_000);
  assert.equal(await movementTotal(cash.id), 50_000);
  await run({ action: 'REVERSE_MOVEMENT', id: transfer.id, eventDate: date, reason: 'Cuenta equivocada QA' });
  assert.equal(await movementTotal(account.id), -600_000);
  assert.equal(await movementTotal(cash.id), 0);
  await run({ action: 'REVERSE_MOVEMENT', id: open.id, eventDate: date, reason: 'Apertura corregida QA' });
  assert.equal(await movementTotal(account.id), -600_000);

  const budget = { action: 'BUDGET', categoryId: category.id, month: '2026-11' };
  await run({ ...budget, amountPyg: 0 });
  assert.equal(Number((await store.one('SELECT amount_pyg FROM procurement_budgets WHERE org_id=? AND category_id=?', orgId, category.id))?.amount_pyg), 0);
  await run({ ...budget, amountPyg: null });
  assert.equal((await store.one('SELECT amount_pyg FROM procurement_budgets WHERE org_id=? AND category_id=?', orgId, category.id))?.amount_pyg, null);
  await assert.rejects(primary.execute(other, command({ ...document })), withCode('NOT_FOUND'));
  await assert.rejects(primary.execute({ ...actor, role: 'OPERATIONS' }, command(document)), withCode('FORBIDDEN'));
  await assert.rejects(run({ ...document, orgId: other.orgId }), error => error instanceof Error && error.name === 'ZodError');
  return { orgId, otherOrgId, partyId: party.id, documentId: result.id };
}
