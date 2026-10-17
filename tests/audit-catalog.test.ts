import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { test } from 'node:test';
import * as XLSX from 'xlsx';
import { createApp } from '../server/app.ts';
import { Store } from '../server/db.ts';

type Json = Record<string, any>;
type Reply = { status: number; body: Json; raw: string; cookie?: string; headers: Headers };
const password = 'Audit-Catalog-QA-2026!';

async function fixture(t: any) {
  const directory = mkdtempSync(join(tmpdir(), 'nexora-catalog-audit-'));
  const store = new Store(join(directory, 'catalog.sqlite'));
  const server: Server = createApp(store).listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const setup = await request(base, '/api/setup', {
    method: 'POST', body: { organizationName: 'Auditoría catálogo', timezone: 'UTC', username: 'audit-catalog-admin', password },
  });
  assert.equal(setup.status, 201);
  const adminCookie = setup.cookie!;
  const post = (cookie: string | undefined, path: string, body: Json) => request(base, path, { method: 'POST', cookie, body });
  const addClient = async (name: string) => {
    const result = await post(adminCookie, '/api/clients', { commandId: randomUUID(), name });
    assert.equal(result.status, 200);
    return result.body.id as string;
  };
  const login = async (username: string) => await request(base, '/api/login', { method: 'POST', body: { username, password } });
  return { base, store, adminCookie, post, login, addClient };
}

async function request(base: string, path: string, options: { method?: string; cookie?: string; body?: Json } = {}): Promise<Reply> {
  const headers: Record<string, string> = { 'X-Requested-With': 'logistics-os' };
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? 'GET', headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const raw = await response.text();
  let body: Json = {};
  try { body = raw ? JSON.parse(raw) as Json : {}; } catch { body = { raw }; }
  const setCookie = response.headers.get('set-cookie');
  return { status: response.status, body, raw, headers: response.headers, ...(setCookie ? { cookie: setCookie.split(';')[0] } : {}) };
}

async function createProduct(f: Awaited<ReturnType<typeof fixture>>, clientId: string, sku: string, options: {
  barcode?: string; name?: string; tracking?: 'QUANTITY' | 'SERIAL';
} = {}) {
  return await f.post(f.adminCookie, '/api/inventory/products', {
    commandId: randomUUID(), clientId, sku, barcode: options.barcode ?? null, name: options.name ?? `Producto ${sku}`,
    tracking: options.tracking ?? 'QUANTITY', unit: 'unidad', weightGrams: 1200, volumeCm3: 8000,
  });
}

function worksheetBuffer(rows: unknown[][], formats: Record<string, string> = {}, formulas: Record<string, { formula: string; value: number | string }> = {}) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  for (const [address, format] of Object.entries(formats)) {
    const cell = worksheet[address];
    assert(cell, `Missing XLSX test cell ${address}`);
    cell.z = format;
  }
  for (const [address, formula] of Object.entries(formulas)) {
    worksheet[address] = { t: typeof formula.value === 'number' ? 'n' : 's', f: formula.formula, v: formula.value };
  }
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Catálogo');
  return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipWithEntry(name: string, uncompressed: Buffer): Buffer {
  const filename = Buffer.from(name, 'utf8');
  const compressed = deflateRawSync(uncompressed);
  const checksum = crc32(uncompressed);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(checksum, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(uncompressed.length, 22);
  local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(checksum, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(uncompressed.length, 24);
  central.writeUInt16LE(filename.length, 28);
  const localRecord = Buffer.concat([local, filename, compressed]);
  const centralRecord = Buffer.concat([central, filename]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralRecord.length, 12); eocd.writeUInt32LE(localRecord.length, 16);
  return Buffer.concat([localRecord, centralRecord, eocd]);
}

test('auditoría de catálogo: preview, SKU con ceros, upsert por cliente, idempotencia y cero mutaciones de stock', async t => {
  const f = await fixture(t);
  const clientA = await f.addClient('Cliente catálogo A');
  const clientB = await f.addClient('Cliente catálogo B');
  const productA = await createProduct(f, clientA, '00123', { barcode: '000000085', name: 'Nombre anterior' });
  const productB = await createProduct(f, clientB, '00123', { barcode: '000000086', name: 'Privado B', tracking: 'SERIAL' });
  assert.equal(productA.status, 201);
  assert.equal(productB.status, 201);
  const location = await f.post(f.adminCookie, '/api/inventory/locations', {
    commandId: randomUUID(), code: 'AUDIT-CAT-DEPOT', name: 'Depósito prueba catálogo', kind: 'DEPOT',
  });
  assert.equal(location.status, 201);
  const receipt = await f.post(f.adminCookie, '/api/inventory/receipts', {
    commandId: randomUUID(), clientId: clientA, productId: productA.body.id, locationId: location.body.id, quantity: 4,
    reference: 'AUDIT-CATALOG-RECEIPT', reason: 'Fixture aislado',
  });
  assert.equal(receipt.status, 200);
  const order = await f.post(f.adminCookie, '/api/orders', {
    commandId: randomUUID(), clientId: clientA, externalId: 'AUDIT-CATALOG-ORDER', orderDate: '2026-10-15',
    destination: 'Destino de prueba', recipientName: 'Receptor de prueba', recipientPhone: '', originText: 'Depósito',
    proofPolicy: 'RECEIVER_PHOTO', lines: [{ productId: productA.body.id, quantity: 1 }],
  });
  assert.equal(order.status, 201, JSON.stringify(order.body));

  const snapshot = async () => ({
    balances: await f.store.all('SELECT product_id,location_id,status,custody_id,order_id,quantity FROM inventory_balances WHERE org_id=? ORDER BY product_id,location_id,status,custody_id,order_id', (await f.store.one('SELECT org_id FROM users WHERE username=?', 'audit-catalog-admin'))!.org_id),
    units: await f.store.all('SELECT id,client_id,product_id,serial,barcode,status,location_id,custody_id,order_id FROM inventory_units ORDER BY id'),
    movements: await f.store.all('SELECT id,client_id,product_id,quantity,action,reference,command_id FROM inventory_movements ORDER BY id'),
    orders: await f.store.all('SELECT id,client_id,external_id,status,shipment_id FROM inventory_orders ORDER BY id'),
    lines: await f.store.all('SELECT id,client_id,order_id,product_id,quantity,reserved_quantity,loaded_quantity FROM inventory_order_lines ORDER BY id'),
  });
  const before = await snapshot();
  const csv = [
    'sku;name;barcode;tracking;unit',
    '00123;Nombre actualizado;000000087;;caja',
    '000456;Producto nuevo;000000099;QUANTITY;unidad',
  ].join('\r\n');
  const payload = { clientId: clientA, csv };
  const template = await request(f.base, '/api/inventory/catalog/template.csv', { cookie: f.adminCookie });
  assert.equal(template.status, 200);
  assert.match(template.headers.get('content-type') ?? '', /text\/csv/i);
  assert.match(template.raw, /^SKU,Nombre,CodigoBarras,Seguimiento,Unidad,PesoKg,VolumenM3/);

  const preview = await f.post(f.adminCookie, '/api/inventory/catalog/preview', payload);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.valid, true);
  assert.equal(preview.body.createCount, 1);
  assert.equal(preview.body.updateCount, 1);
  assert.equal(preview.body.rows[0].sku, '00123');
  assert.equal(preview.body.rows[0].barcode, '000000087');
  assert.equal(preview.body.rows[1].sku, '000456');
  assert.equal(preview.body.rows[1].barcode, '000000099');
  assert.deepEqual(await snapshot(), before, 'Preview must not persist catalog or stock changes.');

  const commandId = randomUUID();
  const first = await f.post(f.adminCookie, '/api/inventory/catalog/import', { ...payload, commandId });
  assert.equal(first.status, 201);
  assert.equal(first.body.imported, true);
  assert.equal(first.body.createCount, 1);
  assert.equal(first.body.updateCount, 1);
  const retry = await f.post(f.adminCookie, '/api/inventory/catalog/import', { ...payload, commandId });
  assert.equal(retry.status, 201);
  assert.deepEqual(retry.body, first.body, 'Retry of same actor, command and bytes must return the original response.');

  const productAAfter = await f.store.one('SELECT sku,barcode,name,tracking,unit,weight_grams,volume_cm3 FROM inventory_products WHERE id=?', productA.body.id);
  assert.deepEqual({ ...productAAfter }, { sku: '00123', barcode: '000000087', name: 'Nombre actualizado', tracking: 'QUANTITY', unit: 'caja', weight_grams: 1200, volume_cm3: 8000 });
  const productBAfter = await f.store.one('SELECT sku,barcode,name,tracking FROM inventory_products WHERE id=?', productB.body.id);
  assert.deepEqual({ ...productBAfter }, { sku: '00123', barcode: '000000086', name: 'Privado B', tracking: 'SERIAL' }, 'Import scoped to client A must not change client B.');
  assert.deepEqual(await snapshot(), before, 'Catalog import must not change stock, units, ledger or orders.');
  const newProduct = await f.store.one('SELECT sku,barcode,tracking FROM inventory_products WHERE org_id=(SELECT org_id FROM users WHERE username=?) AND client_id=? AND sku=?', 'audit-catalog-admin', clientA, '000456');
  assert.deepEqual({ ...newProduct }, { sku: '000456', barcode: '000000099', tracking: 'QUANTITY' });

  const conflict = await f.post(f.adminCookie, '/api/inventory/catalog/import', {
    ...payload, commandId, csv: csv.replace('Nombre actualizado', 'Payload distinto'),
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, 'DUPLICATE_COMMAND');
  const otherActor = await f.post(f.adminCookie, '/api/users', { commandId: randomUUID(), name: 'Operaciones catálogo', username: 'audit-catalog-ops', password, role: 'OPERATIONS' });
  assert.equal(otherActor.status, 200);
  const opsLogin = await f.login('audit-catalog-ops');
  assert.equal(opsLogin.status, 200);
  const replayByOtherActor = await f.post(opsLogin.cookie, '/api/inventory/catalog/import', { ...payload, commandId });
  assert.equal(replayByOtherActor.status, 409);
  assert.equal(replayByOtherActor.body.error.code, 'DUPLICATE_COMMAND');
});

test('auditoría de catálogo: import XLSX conserva ceros del formato visible y bloquea fórmulas', async t => {
  const f = await fixture(t);
  const clientId = await f.addClient('Cliente XLSX');
  const contents = worksheetBuffer(
    [['SKU', 'Nombre', 'barcode', 'Seguimiento'], [123, 'Equipo XLSX', 987, 'QUANTITY']],
    { A2: '00000', C2: '000000' },
  );
  const payload = { clientId, filename: 'catalogo.xlsx', contentBase64: contents.toString('base64') };
  const preview = await f.post(f.adminCookie, '/api/inventory/catalog/preview', payload);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.valid, true, JSON.stringify(preview.body));
  assert.equal(preview.body.rows[0].sku, '00123', JSON.stringify(preview.body));
  assert.equal(preview.body.rows[0].barcode, '000987', JSON.stringify(preview.body));
  const imported = await f.post(f.adminCookie, '/api/inventory/catalog/import', { ...payload, commandId: randomUUID() });
  assert.equal(imported.status, 201);
  const product = await f.store.one('SELECT sku,barcode,name FROM inventory_products WHERE client_id=?', clientId);
  assert.deepEqual({ ...product }, { sku: '00123', barcode: '000987', name: 'Equipo XLSX' });

  const formulaWorkbook = worksheetBuffer(
    [['sku', 'name', 'barcode', 'tracking'], ['FORMULA-1', 'Fórmula bloqueada', 'FORMULA-BAR', 'QUANTITY']],
    {},
    { A2: { formula: '1+1', value: 2 } },
  );
  const formulaPayload = { clientId, filename: 'formula.xlsx', contentBase64: formulaWorkbook.toString('base64') };
  const formulaPreview = await f.post(f.adminCookie, '/api/inventory/catalog/preview', formulaPayload);
  assert.equal(formulaPreview.status, 200);
  assert.equal(formulaPreview.body.valid, false);
  assert(formulaPreview.body.rowErrors.some((error: Json) => /f[oó]rmul/i.test(error.message)), JSON.stringify(formulaPreview.body));
  const before = await f.store.one('SELECT COUNT(*) AS count FROM inventory_products WHERE client_id=?', clientId);
  const rejected = await f.post(f.adminCookie, '/api/inventory/catalog/import', { ...formulaPayload, commandId: randomUUID() });
  assert.equal(rejected.status, 400);
  const after = await f.store.one('SELECT COUNT(*) AS count FROM inventory_products WHERE client_id=?', clientId);
  assert.equal(after?.count, before?.count, 'Rejected formula workbook must not persist products.');
});

test('auditoría de catálogo: duplicados, barcode conflictivo y error de escritura hacen rollback total', async t => {
  const f = await fixture(t);
  const clientId = await f.addClient('Cliente rollback');
  const existing = await createProduct(f, clientId, 'EXISTING-1', { barcode: 'BAR-EXISTING' });
  assert.equal(existing.status, 201);

  const duplicateSku = 'sku,name,tracking\r\nDUP-1,Primero,QUANTITY\r\nDUP-1,Segundo,QUANTITY';
  const duplicatePreview = await f.post(f.adminCookie, '/api/inventory/catalog/preview', { clientId, csv: duplicateSku });
  assert.equal(duplicatePreview.body.valid, false);
  assert(duplicatePreview.body.rowErrors.some((error: Json) => /sku.{0,30}repetido/i.test(error.message)), JSON.stringify(duplicatePreview.body));
  const duplicateImport = await f.post(f.adminCookie, '/api/inventory/catalog/import', { clientId, csv: duplicateSku, commandId: randomUUID() });
  assert.equal(duplicateImport.status, 400);
  assert.equal((await f.store.one('SELECT COUNT(*) AS count FROM inventory_products WHERE client_id=?', clientId))?.count, 1);

  const barcodeConflict = 'sku,name,barcode,tracking\r\nNEW-SHOULD-ROLLBACK,Producto nuevo,BAR-NEW,QUANTITY\r\nNEW-CONFLICT,Producto conflictivo,BAR-EXISTING,QUANTITY';
  const conflictPreview = await f.post(f.adminCookie, '/api/inventory/catalog/preview', { clientId, csv: barcodeConflict });
  assert.equal(conflictPreview.body.valid, false);
  const conflictImport = await f.post(f.adminCookie, '/api/inventory/catalog/import', { clientId, csv: barcodeConflict, commandId: randomUUID() });
  assert.equal(conflictImport.status, 400);
  assert.equal((await f.store.one('SELECT COUNT(*) AS count FROM inventory_products WHERE client_id=?', clientId))?.count, 1);

  await f.store.run(`CREATE TRIGGER audit_catalog_force_abort BEFORE INSERT ON inventory_products
    WHEN NEW.sku='AUDIT-DB-FAIL' BEGIN SELECT RAISE(ABORT,'audit forced failure'); END`);
  const dbFailureCsv = 'sku,name,tracking\r\nNEW-BEFORE-FAIL,Primero,QUANTITY\r\nAUDIT-DB-FAIL,Falla forzada,QUANTITY';
  const dbFailure = await f.post(f.adminCookie, '/api/inventory/catalog/import', { clientId, csv: dbFailureCsv, commandId: randomUUID() });
  assert.equal(dbFailure.status, 500);
  assert.equal((await f.store.one('SELECT COUNT(*) AS count FROM inventory_products WHERE client_id=?', clientId))?.count, 1, 'A later SQL error must roll back products inserted earlier in the same import.');
  await f.store.run('DROP TRIGGER audit_catalog_force_abort');
});

test('auditoría de catálogo: scope de organización, permisos y mismo commandId concurrente', async t => {
  const f = await fixture(t);
  const clientId = await f.addClient('Cliente interno');
  const foreignOrg = randomUUID(), foreignClient = randomUUID(), foreignProduct = randomUUID(), timestamp = new Date().toISOString();
  await f.store.run('INSERT INTO organizations VALUES(?,?,?)', foreignOrg, 'Otra organización aislada', 'UTC');
  await f.store.run('INSERT INTO clients VALUES(?,?,?)', foreignClient, foreignOrg, 'Cliente ajeno');
  await f.store.run('INSERT INTO inventory_products VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', foreignProduct, foreignOrg, foreignClient, 'FOREIGN-001', 'FOREIGN-BAR', 'Privado de otra org', 'QUANTITY', 'unidad', 100, 200, 1, timestamp, timestamp);
  const foreignPayload = { clientId: foreignClient, csv: 'sku,name,tracking\r\nFOREIGN-001,Intento de cambio,QUANTITY' };
  const foreignPreview = await f.post(f.adminCookie, '/api/inventory/catalog/preview', foreignPayload);
  assert.equal(foreignPreview.body.valid, false);
  const foreignImport = await f.post(f.adminCookie, '/api/inventory/catalog/import', { ...foreignPayload, commandId: randomUUID() });
  assert.equal(foreignImport.status, 400);
  assert.equal((await f.store.one('SELECT name FROM inventory_products WHERE id=?', foreignProduct))?.name, 'Privado de otra org');

  const depotUser = await f.post(f.adminCookie, '/api/users', { commandId: randomUUID(), name: 'Depósito catálogo', username: 'audit-catalog-depot', password, role: 'DEPOT' });
  assert.equal(depotUser.status, 200);
  const depot = await f.login('audit-catalog-depot');
  assert.equal(depot.status, 200);
  const forbiddenPreview = await f.post(depot.cookie, '/api/inventory/catalog/preview', { clientId, csv: 'sku,name,tracking\r\nDEPOT-1,No,QUANTITY' });
  assert.equal(forbiddenPreview.status, 403);
  const forbiddenTemplate = await request(f.base, '/api/inventory/catalog/template.csv', { cookie: depot.cookie });
  assert.equal(forbiddenTemplate.status, 403);
  const customer = await f.post(f.adminCookie, '/api/customer-access', { commandId: randomUUID(), clientId, name: 'Customer import', username: 'audit-catalog-customer', password });
  assert.equal(customer.status, 200);
  const customerLogin = await f.login('audit-catalog-customer');
  assert.equal(customerLogin.status, 200);
  assert.equal((await f.post(customerLogin.cookie, '/api/inventory/catalog/import', { clientId, csv: 'sku,name,tracking\r\nCUSTOMER-1,No,QUANTITY', commandId: randomUUID() })).status, 403);
  assert.equal((await f.post(undefined, '/api/inventory/catalog/preview', { clientId, csv: 'sku,name,tracking\r\nUNAUTH-1,No,QUANTITY' })).status, 401);

  const commandId = randomUUID();
  const concurrentPayload = { clientId, commandId, csv: 'sku,name,tracking\r\nCONCURRENT-001,Una sola fila,QUANTITY' };
  const concurrent = await Promise.all([
    f.post(f.adminCookie, '/api/inventory/catalog/import', concurrentPayload),
    f.post(f.adminCookie, '/api/inventory/catalog/import', concurrentPayload),
  ]);
  assert.deepEqual(concurrent.map(reply => reply.status), [201, 201]);
  assert.deepEqual(concurrent[0].body, concurrent[1].body);
  assert.equal((await f.store.one('SELECT COUNT(*) AS count FROM inventory_products WHERE org_id=(SELECT org_id FROM users WHERE username=?) AND client_id=? AND sku=?', 'audit-catalog-admin', clientId, 'CONCURRENT-001'))?.count, 1);
  assert.equal((await f.store.one("SELECT COUNT(*) AS count FROM inventory_commands WHERE command_id=? AND operation='catalog.import'", commandId))?.count, 1);
});

test('auditoría de catálogo: ZIP con expansión desproporcionada se rechaza antes de escribir', async t => {
  const f = await fixture(t);
  const clientId = await f.addClient('Cliente ZIP');
  const compressedBomb = zipWithEntry('xl/worksheets/sheet1.xml', Buffer.alloc(2 * 1024 * 1024, 0x41));
  assert(compressedBomb.length < 5 * 1024 * 1024);
  const payload = { clientId, filename: 'expansion.xlsx', contentBase64: compressedBomb.toString('base64') };
  const preview = await f.post(f.adminCookie, '/api/inventory/catalog/preview', payload);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.valid, false);
  assert(preview.body.rowErrors.some((error: Json) => /tama.{0,8}permitido/i.test(error.message)), JSON.stringify(preview.body));
  const rejected = await f.post(f.adminCookie, '/api/inventory/catalog/import', { ...payload, commandId: randomUUID() });
  assert.equal(rejected.status, 400);
  assert.equal((await f.store.one('SELECT COUNT(*) AS count FROM inventory_products WHERE client_id=?', clientId))?.count, 0);
});

test('auditoría de catálogo: la exportación CSV protege fórmulas sin alterar el dato importado', async t => {
  const f = await fixture(t);
  const clientId = await f.addClient('Cliente fórmula CSV');
  const imported = await f.post(f.adminCookie, '/api/inventory/catalog/import', {
    clientId, commandId: randomUUID(), csv: 'sku,name,tracking\r\nSKU-FORMULA,=1+1,QUANTITY',
  });
  assert.equal(imported.status, 201);
  const product = await f.store.one('SELECT id,name FROM inventory_products WHERE client_id=? AND sku=?', clientId, 'SKU-FORMULA');
  assert.equal(product?.name, '=1+1', 'Stored catalog values remain unchanged.');
  const location = await f.post(f.adminCookie, '/api/inventory/locations', {
    commandId: randomUUID(), code: 'AUDIT-CSV-EXPORT', name: 'Depósito exportación', kind: 'DEPOT',
  });
  assert.equal(location.status, 201);
  const receipt = await f.post(f.adminCookie, '/api/inventory/receipts', {
    commandId: randomUUID(), clientId, productId: product?.id, locationId: location.body.id, quantity: 1,
  });
  assert.equal(receipt.status, 200);
  const formulaExport = await request(f.base, `/api/inventory/export.csv?clientId=${encodeURIComponent(clientId)}`, { cookie: f.adminCookie });
  assert.equal(formulaExport.status, 200);
  assert.match(formulaExport.raw, /"'=1\+1"/, 'Spreadsheet-oriented exports prefix formula-looking text with an apostrophe.');

  await f.store.run('UPDATE inventory_products SET name=? WHERE id=?', '\tplain text', product?.id);
  const controlExport = await request(f.base, `/api/inventory/export.csv?clientId=${encodeURIComponent(clientId)}`, { cookie: f.adminCookie });
  assert.equal(controlExport.status, 200);
  assert.match(controlExport.raw, /"'\tplain text"/, 'Initial control characters are also neutralized.');
  assert.equal((await f.store.one('SELECT name FROM inventory_products WHERE id=?', product?.id))?.name, '\tplain text');
});
