import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import * as XLSX from 'xlsx';
import { Store } from '../server/db.ts';
import { setup, type Actor } from '../server/auth.ts';
import { Logistics } from '../server/domain.ts';
import { Inventory, type InventoryActor } from '../server/inventory.ts';
import { CatalogImport } from '../server/catalog-import.ts';
import { installInventoryRoutes } from '../server/inventory-routes.ts';

async function fixture(t: any) {
  const store = new Store(':memory:');
  t.after(async () => await store.close());
  const suffix = randomUUID().slice(0, 8);
  const { userId, orgId } = await setup(store, { organizationName: 'Catálogo QA', timezone: 'UTC', username: `catalog-${suffix}`, password: 'Password-QA-Catalog-2026!' });
  const actor: InventoryActor = { id: userId, orgId, name: 'Admin catálogo QA', role: 'ADMIN', driverId: null };
  const logistics = new Logistics(store), inventory = new Inventory(store), catalog = new CatalogImport(store);
  const clientId = (await logistics.createClient(actor as Actor, { commandId: randomUUID(), name: 'Cliente catálogo A' })).id;
  const secondClientId = (await logistics.createClient(actor as Actor, { commandId: randomUUID(), name: 'Cliente catálogo B' })).id;
  const commandId = () => randomUUID();
  const csv = (body: string) => `sku,name,barcode,tracking,unit,weightGrams,volumeCm3\r\n${body}`;
  return { store, actor, logistics, inventory, catalog, clientId, secondClientId, commandId, csv };
}

const errorCode = (code: string) => (error: any) => error?.code === code;

test('CSV con BOM, delimitador alternativo, comillas y saltos de línea conserva códigos y convierte unidades', async t => {
  const f = await fixture(t);
  const csv = '\uFEFFSKU;nombre;codigoBarras;seguimiento;unidad;pesoKg;volumenM3\r\n00073;"Repuesto; premium\nsegunda línea";"0000012345";SERIAL;unidad;1,25;0,002\r\n';
  const preview = await f.catalog.preview(f.actor, { clientId: f.clientId, csv });
  assert.equal(preview.valid, true);
  assert.deepEqual([preview.rowCount, preview.createCount, preview.updateCount, preview.unchangedCount], [1, 1, 0, 0]);
  assert.deepEqual(preview.rows[0], { row: 2, sku: '00073', name: 'Repuesto; premium\nsegunda línea', barcode: '0000012345', tracking: 'SERIAL', unit: 'unidad', weightGrams: 1250, volumeCm3: 2000, action: 'CREATE' });
  const result = await f.catalog.import(f.actor, { clientId: f.clientId, csv, commandId: f.commandId() });
  assert.equal(result.imported, true);
  const saved = await f.store.one('SELECT * FROM inventory_products WHERE org_id=? AND client_id=? AND sku=?', f.actor.orgId, f.clientId, '00073');
  assert.equal(saved?.barcode, '0000012345');
  assert.equal(saved?.weight_grams, 1250);
  assert.equal(saved?.volume_cm3, 2000);
  assert.equal(saved?.name, 'Repuesto; premium\nsegunda línea');
});

test('defaultTracking explícito completa varias filas sin columna y forma parte de la idempotencia', async t => {
  const f = await fixture(t);
  const csv = 'CodigoSKU,NombreDelProducto\r\nSIN-TRACK-1,Producto uno\r\nSIN-TRACK-2,Producto dos\r\n';
  const preview = await f.catalog.preview(f.actor, { clientId: f.clientId, csv, defaultTracking: 'SERIAL' });
  assert.equal(preview.valid, true);
  assert.equal(preview.createCount, 2);
  assert.deepEqual(preview.rows.map(row => row.tracking), ['SERIAL', 'SERIAL']);
  const commandId = f.commandId();
  await f.catalog.import(f.actor, { clientId: f.clientId, csv, defaultTracking: 'SERIAL', commandId });
  await assert.rejects(() => f.catalog.import(f.actor, { clientId: f.clientId, csv, defaultTracking: 'QUANTITY', commandId }), errorCode('DUPLICATE_COMMAND'));

  const explicit = await f.catalog.preview(f.actor, { clientId: f.clientId, csv: 'SKU,Nombre,Seguimiento\r\nEXPLICIT-1,Explícito,Serie\r\n', defaultTracking: 'QUANTITY' });
  assert.equal(explicit.rows[0].tracking, 'SERIAL');
});

test('ignora columnas empresariales fuera del catálogo y nunca importa existencias por columna stock', async t => {
  const f = await fixture(t);
  const csv = 'SKU,Nombre,Marca,Modelo,Precio,Stock,Seguimiento\r\nERP-1,Producto uno,Marca QA,M-1,125.50,80,Cantidad\r\nERP-2,Producto dos,Marca QA,M-2,275.00,12,Cantidad\r\n';
  const preview = await f.catalog.preview(f.actor, { clientId: f.clientId, csv });
  assert.equal(preview.valid, true);
  assert.deepEqual(preview.ignoredColumns, ['Marca', 'Modelo', 'Precio', 'Stock']);
  assert.equal(preview.createCount, 2);
  await f.catalog.import(f.actor, { clientId: f.clientId, csv, commandId: f.commandId() });
  assert.equal((await f.store.one('SELECT COUNT(*) AS n FROM inventory_products WHERE client_id=?', f.clientId))?.n, 2);
  assert.equal((await f.store.one('SELECT COUNT(*) AS n FROM inventory_balances WHERE client_id=?', f.clientId))?.n, 0);
  assert.equal((await f.store.one('SELECT COUNT(*) AS n FROM inventory_movements WHERE client_id=?', f.clientId))?.n, 0);
});

test('XLSX respeta formatos de ceros iniciales y bloquea fórmulas antes de importar', async t => {
  const f = await fixture(t);
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([['SKU', 'nombre', 'codigoBarras', 'seguimiento', 'unidad', 'pesoKg', 'volumenM3'], [123, 'Motor QA', 1234, 'SERIAL', 'unidad', 1.5, 0.0005]]);
  worksheet.A2 = { t: 'n', v: 123, z: '000000' };
  worksheet.C2 = { t: 'n', v: 1234, z: '0000000000000' };
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Productos');
  const contentBase64 = Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })).toString('base64');
  const input = { clientId: f.clientId, filename: 'catalogo.xlsx', contentBase64 };
  const preview = await f.catalog.preview(f.actor, input);
  assert.equal(preview.valid, true);
  assert.equal(preview.rows[0].sku, '000123');
  assert.equal(preview.rows[0].barcode, '0000000001234');
  assert.equal(preview.rows[0].weightGrams, 1500);
  assert.equal(preview.rows[0].volumeCm3, 500);

  const formulaBook = XLSX.utils.book_new();
  const formulaSheet = XLSX.utils.aoa_to_sheet([['sku', 'name', 'tracking'], ['FORMULA-1', 'No importar', 'QUANTITY']]);
  formulaSheet.A2 = { t: 's', v: 'FORMULA-1', f: '"FORMULA-1"' };
  XLSX.utils.book_append_sheet(formulaBook, formulaSheet, 'Productos');
  const formulaInput = { clientId: f.clientId, filename: 'formula.xlsx', contentBase64: Buffer.from(XLSX.write(formulaBook, { type: 'buffer', bookType: 'xlsx' })).toString('base64') };
  const formulaPreview = await f.catalog.preview(f.actor, formulaInput);
  assert.equal(formulaPreview.valid, false);
  assert.equal(formulaPreview.rowErrors.some(error => error.message.includes('No uses fórmulas')), true);
  await assert.rejects(() => f.catalog.import(f.actor, { ...formulaInput, commandId: f.commandId() }), errorCode('VALIDATION_ERROR'));
  assert.equal((await f.store.one('SELECT COUNT(*) AS n FROM inventory_products WHERE client_id=?', f.clientId))?.n, 0);
});

test('lote con duplicados se rechaza completo; SKU existente se actualiza sin cambiar tracking ni existencias', async t => {
  const f = await fixture(t);
  const firstCsv = f.csv('MOTOR-1,Motor original,BAR-1,QUANTITY,unidad,700,400');
  await f.catalog.import(f.actor, { clientId: f.clientId, csv: firstCsv, commandId: f.commandId() });
  const duplicateBarcode = await f.catalog.preview(f.actor, { clientId: f.clientId, csv: f.csv('OTHER-1,Otro,BAR-1,QUANTITY,unidad,,') });
  assert.equal(duplicateBarcode.valid, false);
  assert(duplicateBarcode.rowErrors.some(error => error.field === 'barcode'));
  const duplicateCsv = f.csv('DUP-1,Uno,,QUANTITY,unidad,,\nDUP-1,Dos,,QUANTITY,unidad,,');
  const invalid = await f.catalog.preview(f.actor, { clientId: f.clientId, csv: duplicateCsv });
  assert.equal(invalid.valid, false);
  assert(invalid.rowErrors.some(error => error.field === 'sku' && error.message.includes('repetido')));
  await assert.rejects(() => f.catalog.import(f.actor, { clientId: f.clientId, csv: duplicateCsv, commandId: f.commandId() }), errorCode('VALIDATION_ERROR'));
  assert.equal((await f.store.one("SELECT COUNT(*) AS n FROM inventory_products WHERE sku='DUP-1'"))?.n, 0);

  const product = await f.store.one('SELECT * FROM inventory_products WHERE client_id=? AND sku=?', f.clientId, 'MOTOR-1');
  assert.ok(product);
  const locationId = (await f.inventory.createLocation(f.actor, { commandId: f.commandId(), code: `DEP-${randomUUID().slice(0, 6)}`, name: 'Depósito QA', kind: 'DEPOT' })).id;
  await f.inventory.receive(f.actor, { commandId: f.commandId(), clientId: f.clientId, productId: product.id, locationId, quantity: 8, reference: '', reason: '' });
  const movementsBefore = (await f.store.one('SELECT COUNT(*) AS n FROM inventory_movements WHERE product_id=?', product.id))?.n;
  const update = await f.catalog.import(f.actor, { clientId: f.clientId, csv: 'sku,name\r\nMOTOR-1,Motor revisado\r\n', commandId: f.commandId() });
  assert.equal(update.updateCount, 1);
  const after = await f.store.one('SELECT * FROM inventory_products WHERE id=?', product.id);
  assert.ok(after);
  assert.equal(after.name, 'Motor revisado');
  assert.equal(after.tracking, 'QUANTITY');
  assert.equal(after.barcode, 'BAR-1');
  assert.equal(after.weight_grams, 700);
  assert.equal((await f.store.one('SELECT SUM(quantity) AS n FROM inventory_balances WHERE product_id=?', product.id))?.n, 8);
  assert.equal((await f.store.one('SELECT COUNT(*) AS n FROM inventory_movements WHERE product_id=?', product.id))?.n, movementsBefore);

  const trackingChange = await f.catalog.preview(f.actor, { clientId: f.clientId, csv: f.csv('MOTOR-1,Motor revisado,BAR-1,SERIAL,unidad,700,400') });
  assert.equal(trackingChange.valid, false);
  assert(trackingChange.rowErrors.some(error => error.field === 'tracking' && error.message.includes('No se puede cambiar')));
});

test('barcode de catálogo no puede colisionar con barcode de unidad serializada', async t => {
  const f = await fixture(t);
  const serialCsv = f.csv('SERIAL-1,Equipo serial,MODEL-1,SERIAL,unidad,,');
  await f.catalog.import(f.actor, { clientId: f.clientId, csv: serialCsv, commandId: f.commandId() });
  const product = await f.store.one('SELECT id FROM inventory_products WHERE client_id=? AND sku=?', f.clientId, 'SERIAL-1');
  assert.ok(product);
  const locationId = (await f.inventory.createLocation(f.actor, { commandId: f.commandId(), code: `SER-${randomUUID().slice(0, 6)}`, name: 'Depósito serial QA', kind: 'DEPOT' })).id;
  await f.inventory.receive(f.actor, { commandId: f.commandId(), clientId: f.clientId, productId: product.id, locationId, quantity: 1, serials: [{ serial: 'SER-UNIT-1', barcode: 'UNIT-BAR-1' }], reference: '', reason: '' });
  const preview = await f.catalog.preview(f.actor, { clientId: f.clientId, csv: f.csv('OTHER-1,Otro,UNIT-BAR-1,QUANTITY,unidad,,') });
  assert.equal(preview.valid, false);
  assert(preview.rowErrors.some(error => error.field === 'barcode' && error.message.includes('unidad serializada')));
});

test('importa un catálogo que cruza varios lotes SQL sin perder filas', async t => {
  const f = await fixture(t);
  const rows = Array.from({ length: 425 }, (_, index) => `BULK-${String(index).padStart(4, '0')},Producto ${index},,QUANTITY,unidad,,`).join('\r\n');
  const result = await f.catalog.import(f.actor, { clientId: f.clientId, csv: f.csv(rows), commandId: f.commandId() });
  assert.equal(result.createCount, 425);
  assert.equal((await f.store.one('SELECT COUNT(*) AS n FROM inventory_products WHERE client_id=?', f.clientId))?.n, 425);
});

test('importación es idempotente, detecta cambio de contenido y rollback incluye auditoría', async t => {
  const f = await fixture(t);
  const commandId = f.commandId(), csv = f.csv('IDEMP-1,Idempotente,,QUANTITY,unidad,,');
  const first = await f.catalog.import(f.actor, { clientId: f.clientId, csv, commandId });
  const retry = await f.catalog.import(f.actor, { clientId: f.clientId, csv, commandId });
  assert.deepEqual(retry, first);
  assert.equal((await f.store.one('SELECT COUNT(*) AS n FROM inventory_commands WHERE org_id=? AND command_id=?', f.actor.orgId, commandId))?.n, 1);
  assert.equal((await f.store.one('SELECT COUNT(*) AS n FROM audit WHERE command_id=?', commandId))?.n, 1);
  await assert.rejects(() => f.catalog.import(f.actor, { clientId: f.clientId, csv: f.csv('IDEMP-1,Cambio,,QUANTITY,unidad,, '), commandId }), errorCode('DUPLICATE_COMMAND'));

  await f.store.run(`CREATE TRIGGER reject_catalog_audit BEFORE INSERT ON audit
    WHEN NEW.action='inventory.catalog.import' BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`);
  const rollbackCommand = f.commandId();
  const rollbackCsv = f.csv('ROLLBACK-1,Rollback,,QUANTITY,unidad,,');
  await assert.rejects(() => f.catalog.import(f.actor, { clientId: f.clientId, csv: rollbackCsv, commandId: rollbackCommand }), /audit unavailable/);
  assert.equal((await f.store.one("SELECT COUNT(*) AS n FROM inventory_products WHERE sku='ROLLBACK-1'"))?.n, 0);
  assert.equal((await f.store.one('SELECT COUNT(*) AS n FROM inventory_commands WHERE command_id=?', rollbackCommand))?.n, 0);
  await f.store.run('DROP TRIGGER reject_catalog_audit');
  assert.equal((await f.catalog.import(f.actor, { clientId: f.clientId, csv: rollbackCsv, commandId: rollbackCommand })).imported, true);
});

test('cliente/organización no pueden cruzar catálogo y preview/template se sirven por API con rol permitido', async t => {
  const f = await fixture(t);
  const customer: InventoryActor = { ...f.actor, role: 'CUSTOMER', clientId: f.clientId };
  await assert.rejects(() => f.catalog.preview(customer, { clientId: f.clientId, csv: f.csv('CUST-1,No,,QUANTITY,unidad,,') }), errorCode('FORBIDDEN'));
  const foreignOrgId = randomUUID(), foreignClientId = randomUUID();
  await f.store.run('INSERT INTO organizations VALUES(?,?,?)', foreignOrgId, 'Otro tenant QA', 'UTC');
  await f.store.run('INSERT INTO clients VALUES(?,?,?)', foreignClientId, foreignOrgId, 'Cliente externo');
  const foreignClientPreview = await f.catalog.preview(f.actor, { clientId: foreignClientId, csv: f.csv('SECRET-1,No exponer,,QUANTITY,unidad,,') });
  assert.equal(foreignClientPreview.valid, false);
  assert(foreignClientPreview.rowErrors.some(error => error.field === 'clientId'));

  const app = express();
  app.use(express.json({ limit: '8mb' }));
  installInventoryRoutes(app, f.store, async () => f.actor);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(async () => await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const template = await fetch(`${base}/api/inventory/catalog/template.csv`);
  assert.equal(template.status, 200);
  assert.match(template.headers.get('content-type') ?? '', /text\/csv/);
  assert.match(await template.text(), /^SKU,Nombre,CodigoBarras,Seguimiento,Unidad,PesoKg,VolumenM3/);
  const previewResponse = await fetch(`${base}/api/inventory/catalog/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientId: f.clientId, csv: f.csv('API-1,API,,QUANTITY,unidad,,') }) });
  assert.equal(previewResponse.status, 200);
  assert.equal((await previewResponse.json() as any).valid, true);
});
