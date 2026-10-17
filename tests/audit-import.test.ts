import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Store } from '../server/db.ts';
import { setup, type Actor } from '../server/auth.ts';
import { Logistics } from '../server/domain.ts';
import { Inventory } from '../server/inventory.ts';

test('auditoría de importación: agrupa líneas, reintenta idempotente y rechaza filas contradictorias sin escritura parcial', async t => {
  const store = new Store(':memory:');
  t.after(async () => await store.close());
  const password = 'Audit-Import-QA-2026!';
  const { userId, orgId } = await setup(store, { organizationName: 'Auditoría importación', timezone: 'UTC', username: 'audit-import-admin', password });
  const actor: Actor = { id: userId, orgId, name: 'Admin import QA', role: 'ADMIN', driverId: null };
  const inventory = new Inventory(store), commandId = () => randomUUID();
  const clientId = (await new Logistics(store).createClient(actor, { commandId: commandId(), name: 'Cliente import QA' })).id;
  const productId = (await inventory.createProduct(actor, { commandId: commandId(), clientId, sku: 'AUDIT-CSV-1', barcode: null, name: 'Producto CSV', tracking: 'QUANTITY', unit: 'unidad', weightGrams: 100, volumeCm3: 100 })).id;
  const csv = [
    'clientId,externalId,orderDate,destination,recipientName,quantity,productId',
    `${clientId},EXT-CSV-1,2026-10-15,Destino QA,Receptor QA,2,${productId}`,
    `${clientId},EXT-CSV-1,2026-10-15,Destino QA,Receptor QA,3,${productId}`,
  ].join('\n');
  const command = { commandId: commandId(), csv };
  const first = await inventory.importCsv(actor, command);
  assert.equal(first.imported, 1);
  assert.deepEqual(await inventory.importCsv(actor, command), first);
  assert.equal((await store.one('SELECT COUNT(*) AS n FROM inventory_orders'))?.n, 1);
  assert.equal((await store.one('SELECT quantity FROM inventory_order_lines WHERE order_id=?', first.orders[0].id))?.quantity, 5);
  const duplicateCommand = commandId();
  await assert.rejects(() => inventory.importCsv(actor, { commandId: duplicateCommand, csv }), (error: any) => {
    assert.equal(error.code, 'VALIDATION_ERROR');
    assert.equal(error.details?.rowErrors?.[0]?.code, 'DUPLICATE_ORDER');
    return true;
  });

  const conflicting = [
    'clientId,externalId,orderDate,destination,recipientName,quantity,productId',
    `${clientId},EXT-CSV-2,2026-10-15,Destino A,Receptor QA,1,${productId}`,
    `${clientId},EXT-CSV-2,2026-10-15,Destino B,Receptor QA,1,${productId}`,
  ].join('\n');
  const preview = await inventory.previewImport(actor, { commandId: commandId(), csv: conflicting });
  assert.equal(preview.valid, false);
  assert(preview.rowErrors.some(error => error.code === 'ORDER_HEADER_MISMATCH' && error.row === 3));
  const conflictCommand = commandId();
  await assert.rejects(() => inventory.importCsv(actor, { commandId: conflictCommand, csv: conflicting }), (error: any) => {
    assert.equal(error.code, 'VALIDATION_ERROR');
    assert(error.details?.rowErrors?.some((row: any) => row.code === 'ORDER_HEADER_MISMATCH' && row.row === 3));
    return true;
  });
  assert.equal((await store.one('SELECT COUNT(*) AS n FROM inventory_orders'))?.n, 1);
  const rejected = (await inventory.importHistory(actor)).items.filter(run => run.status === 'REJECTED');
  assert.equal(rejected.length, 2);
  assert(rejected.some(run => run.rowErrors.some((row: any) => row.code === 'DUPLICATE_ORDER')));
  assert(rejected.some(run => run.rowErrors.some((row: any) => row.code === 'ORDER_HEADER_MISMATCH')));
});
