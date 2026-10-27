import { createHash, randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import type { Database, Row } from './database.ts';
import type { InventoryActor } from './inventory.ts';
import { DomainError, ensure } from './errors.ts';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 10_000;
const MAX_COLUMNS = 32;
const PRODUCT_FIELDS = ['sku', 'name', 'barcode', 'tracking', 'unit', 'weightGrams', 'volumeCm3'] as const;
type ProductField = typeof PRODUCT_FIELDS[number];
type Tracking = 'QUANTITY' | 'SERIAL';
type CatalogAction = 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'ERROR';
type CatalogRow = {
  row: number; sku: string; name: string; barcode: string | null; tracking: Tracking | null;
  unit: string; weightGrams: number | null; volumeCm3: number | null; action: CatalogAction;
};
type RowError = { row: number; field?: string; message: string };
type Cell = { raw: unknown; formatted?: string; numberFormat?: string; formula?: boolean };
type SourceRow = { row: number; cells: Cell[] };
type FileContent = { rows: SourceRow[]; errors: RowError[] };
type ParsedProduct = CatalogRow & {
  hasBarcode: boolean; hasTracking: boolean; hasUnit: boolean; hasWeight: boolean; hasVolume: boolean;
};
type ProductPlan = { parsed: ParsedProduct; existing?: Row; next: Omit<CatalogRow, 'row' | 'action'> };

const catalogBody = z.object({
  clientId: z.uuid(),
  csv: z.string().min(1).max(MAX_FILE_BYTES).optional(),
  filename: z.string().trim().min(1).max(255).optional(),
  contentBase64: z.string().min(1).max(Math.ceil(MAX_FILE_BYTES / 3) * 4).optional(),
  defaultTracking: z.enum(['QUANTITY', 'SERIAL']).optional(),
  commandId: z.uuid().optional()
}).superRefine((value, ctx) => {
  const hasCsv = value.csv !== undefined;
  const hasXlsx = value.filename !== undefined || value.contentBase64 !== undefined;
  if (hasCsv === hasXlsx) ctx.addIssue({ code: 'custom', path: ['csv'], message: 'Envía un CSV o un archivo .xlsx.' });
  if (hasXlsx && (!value.filename || !value.contentBase64)) ctx.addIssue({ code: 'custom', path: ['contentBase64'], message: 'Para Excel, incluye el nombre del archivo y su contenido.' });
});

const normalizeText = (value: unknown) => String(value ?? '').trim();
const normalizeHeader = (value: unknown) => normalizeText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const aliasMap = new Map<string, ProductField>([
  ['sku', 'sku'], ['codigo', 'sku'], ['codigoproducto', 'sku'], ['productcode', 'sku'], ['itemcode', 'sku'],
  ['codigodesku', 'sku'], ['codigosku', 'sku'],
  ['nombre', 'name'], ['name', 'name'], ['productname', 'name'], ['nombredelproducto', 'name'], ['descripcion', 'name'], ['descripciondelproducto', 'name'], ['description', 'name'],
  ['codigobarras', 'barcode'], ['codigodebarras', 'barcode'], ['barcode', 'barcode'], ['ean', 'barcode'], ['upc', 'barcode'],
  ['seguimiento', 'tracking'], ['tracking', 'tracking'], ['trazabilidad', 'tracking'], ['control', 'tracking'],
  ['unidad', 'unit'], ['unit', 'unit'], ['uom', 'unit'],
  ['weightgrams', 'weightGrams'], ['pesogramos', 'weightGrams'], ['gramos', 'weightGrams'],
  ['pesokg', 'weightGrams'], ['weightkg', 'weightGrams'],
  ['volumecm3', 'volumeCm3'], ['volumencm3', 'volumeCm3'], ['cm3', 'volumeCm3'],
  ['volumenm3', 'volumeCm3'], ['volumem3', 'volumeCm3'], ['m3', 'volumeCm3']
]);
const weightKgAliases = new Set(['pesokg', 'weightkg']);
const volumeM3Aliases = new Set(['volumenm3', 'volumem3', 'm3']);

function resultShape(rowCount: number, rows: CatalogRow[] = [], rowErrors: RowError[] = [], ignoredColumns: string[] = []) {
  const createCount = rows.filter(row => row.action === 'CREATE').length;
  const updateCount = rows.filter(row => row.action === 'UPDATE').length;
  const unchangedCount = rows.filter(row => row.action === 'UNCHANGED').length;
  return { valid: rowErrors.length === 0, rowCount, createCount, updateCount, unchangedCount, rows, rowErrors: rowErrors.slice(0, 500), ignoredColumns };
}

function friendlyInputIssue(issue: { path: PropertyKey[] }): string {
  const field = String(issue.path[0] ?? '');
  if (field === 'clientId') return 'Selecciona un cliente válido.';
  if (field === 'csv') return 'Envía un CSV válido o un archivo .xlsx.';
  if (field === 'filename' || field === 'contentBase64') return 'Revisa el nombre y el contenido del archivo Excel.';
  if (field === 'defaultTracking') return 'El seguimiento predeterminado debe ser Cantidad o Serie.';
  if (field === 'commandId') return 'El identificador del lote no es válido.';
  return 'Revisa los datos enviados e inténtalo de nuevo.';
}

function chooseDelimiter(firstLine: string): string {
  const choices = [',', ';', '\t'];
  let best = ',', bestCount = -1, quoted = false;
  const counts = new Map(choices.map(delimiter => [delimiter, 0]));
  for (let index = 0; index < firstLine.length; index++) {
    const char = firstLine[index];
    if (char === '"' && firstLine[index + 1] === '"' && quoted) { index++; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (!quoted && counts.has(char)) counts.set(char, counts.get(char)! + 1);
  }
  for (const [delimiter, count] of counts) if (count > bestCount) { best = delimiter; bestCount = count; }
  return best;
}

function firstCsvRecord(source: string): string {
  let quoted = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '"' && source[index + 1] === '"' && quoted) { index++; continue; }
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === '\n' || char === '\r')) return source.slice(0, index);
  }
  return source;
}

function parseCsv(source: string): FileContent {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const delimiter = chooseDelimiter(firstCsvRecord(text));
  const records: SourceRow[] = [];
  let cells: Cell[] = [], field = '', quoted = false, line = 1, startLine = 1;
  const pushField = () => { cells.push({ raw: field }); field = ''; };
  const pushRecord = () => {
    pushField();
    if (cells.some(cell => normalizeText(cell.raw))) records.push({ row: startLine, cells });
    cells = [];
    startLine = line + 1;
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') quoted = false;
      else { field += char; if (char === '\n') line++; }
    } else if (char === '"' && field.length === 0) quoted = true;
    else if (char === delimiter) pushField();
    else if (char === '\n') { pushRecord(); line++; if (records.length > MAX_ROWS + 1) return { rows: [], errors: [{ row: MAX_ROWS + 2, field: 'csv', message: `El archivo supera el máximo de ${MAX_ROWS} productos.` }] }; }
    else if (char === '\r') {
      if (text[index + 1] === '\n') continue;
      pushRecord(); line++; if (records.length > MAX_ROWS + 1) return { rows: [], errors: [{ row: MAX_ROWS + 2, field: 'csv', message: `El archivo supera el máximo de ${MAX_ROWS} productos.` }] };
    } else field += char;
    if (cells.length > MAX_COLUMNS) return { rows: [], errors: [{ row: startLine, field: 'header', message: `El CSV supera el máximo de ${MAX_COLUMNS} columnas.` }] };
  }
  if (quoted) return { rows: [], errors: [{ row: startLine, field: 'csv', message: 'Hay una comilla sin cerrar en el CSV.' }] };
  if (field.length || cells.length) pushRecord();
  if (records.length > MAX_ROWS + 1) return { rows: [], errors: [{ row: MAX_ROWS + 2, field: 'csv', message: `El archivo supera el máximo de ${MAX_ROWS} productos.` }] };
  if (records.length < 2) return { rows: [], errors: [{ row: 1, field: 'csv', message: 'El CSV debe incluir encabezados y al menos un producto.' }] };
  if (records.length - 1 > MAX_ROWS) return { rows: [], errors: [{ row: MAX_ROWS + 2, field: 'csv', message: `El archivo supera el máximo de ${MAX_ROWS} productos.` }] };
  return { rows: records, errors: [] };
}

export function preflightZip(buffer: Buffer): string | null {
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) return 'El archivo no es un Excel .xlsx válido.';
  const start = Math.max(0, buffer.length - 65_557);
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= start; offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) return 'El archivo Excel está incompleto.';
  const entries = buffer.readUInt16LE(eocd + 10), directorySize = buffer.readUInt32LE(eocd + 12), directoryOffset = buffer.readUInt32LE(eocd + 16);
  if (entries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) return 'Este archivo Excel usa un formato no compatible.';
  if (entries > 128 || directoryOffset + directorySize > eocd) return 'El archivo Excel tiene una estructura inválida.';
  let offset = directoryOffset, expandedBytes = 0;
  for (let index = 0; index < entries; index++) {
    if (offset + 46 > eocd || buffer.readUInt32LE(offset) !== 0x02014b50) return 'El archivo Excel tiene una estructura inválida.';
    const flags = buffer.readUInt16LE(offset + 8), method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20), expanded = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28), extraLength = buffer.readUInt16LE(offset + 30), commentLength = buffer.readUInt16LE(offset + 32);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > eocd || expanded === 0xffffffff || compressed === 0xffffffff) return 'Este archivo Excel usa un formato no compatible.';
    if ((flags & 1) !== 0 || ![0, 8].includes(method)) return 'El archivo Excel está protegido o usa una compresión no compatible.';
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (name.includes('../') || name.startsWith('/') || /(^|\/)vbaProject\.bin$/i.test(name) || name.startsWith('xl/externalLinks/')) return 'No se admiten macros ni vínculos externos en el archivo Excel.';
    expandedBytes += expanded;
    if (expandedBytes > 32 * 1024 * 1024 || expanded > 0 && compressed === 0 || expanded > Math.max(1_000_000, compressed * 150)) return 'El archivo Excel supera el tamaño permitido al abrirse.';
    offset = next;
  }
  return null;
}

function parseXlsx(filename: string, contentBase64: string): FileContent {
  if (!/\.xlsx$/i.test(filename) || /[\\/]/.test(filename)) return { rows: [], errors: [{ row: 1, field: 'filename', message: 'Selecciona un archivo con extensión .xlsx.' }] };
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(contentBase64)) return { rows: [], errors: [{ row: 1, field: 'contentBase64', message: 'No se pudo leer el contenido del archivo Excel.' }] };
  const buffer = Buffer.from(contentBase64, 'base64');
  if (buffer.length === 0 || buffer.length > MAX_FILE_BYTES) return { rows: [], errors: [{ row: 1, field: 'contentBase64', message: `El archivo Excel debe pesar hasta ${MAX_FILE_BYTES} bytes.` }] };
  const zipError = preflightZip(buffer);
  if (zipError) return { rows: [], errors: [{ row: 1, field: 'file', message: zipError }] };
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellFormula: true, cellNF: true, cellText: true, cellDates: false, WTF: true });
    const name = workbook.SheetNames.find((_, index) => !workbook.Workbook?.Sheets?.[index]?.Hidden) ?? workbook.SheetNames[0];
    const worksheet = name ? workbook.Sheets[name] : undefined;
    if (!worksheet?.['!ref']) return { rows: [], errors: [{ row: 1, field: 'xlsx', message: 'El archivo Excel no tiene productos en su primera hoja.' }] };
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    if (range.e.r - range.s.r > MAX_ROWS || range.e.c - range.s.c + 1 > MAX_COLUMNS) return { rows: [], errors: [{ row: 1, field: 'xlsx', message: `El Excel supera el máximo de ${MAX_ROWS} productos o ${MAX_COLUMNS} columnas.` }] };
    const rows: SourceRow[] = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const cells: Cell[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const address = XLSX.utils.encode_cell({ r, c });
        const cell = worksheet[address];
        const value = cell?.v;
        cells.push({ raw: value, formatted: cell?.w, numberFormat: cell?.z, formula: Boolean(cell?.f || cell?.F) });
      }
      if (cells.some(cell => cell.formula || normalizeText(cell.raw))) rows.push({ row: r + 1, cells });
    }
    if (rows.length < 2) return { rows: [], errors: [{ row: 1, field: 'xlsx', message: 'El Excel debe incluir encabezados y al menos un producto.' }] };
    return { rows, errors: [] };
  } catch {
    return { rows: [], errors: [{ row: 1, field: 'file', message: 'No se pudo leer el archivo Excel. Verifica que esté guardado como .xlsx.' }] };
  }
}

function parsePayload(payload: z.infer<typeof catalogBody>): FileContent {
  if (payload.csv !== undefined) {
    if (Buffer.byteLength(payload.csv, 'utf8') > MAX_FILE_BYTES) return { rows: [], errors: [{ row: 1, field: 'csv', message: `El CSV debe pesar hasta ${MAX_FILE_BYTES} bytes.` }] };
    return parseCsv(payload.csv);
  }
  return parseXlsx(payload.filename!, payload.contentBase64!);
}

function headersFrom(row: SourceRow): { indexes: Map<ProductField, { index: number; source: string }>; errors: RowError[]; ignoredColumns: string[] } {
  const indexes = new Map<ProductField, { index: number; source: string }>(), errors: RowError[] = [], ignoredColumns: string[] = [];
  row.cells.forEach((cell, index) => {
    const original = normalizeText(cell.raw);
    const key = normalizeHeader(original), field = aliasMap.get(key);
    if (!field) {
      if (original) ignoredColumns.push(original);
      return;
    }
    if (indexes.has(field)) errors.push({ row: 1, field, message: `Hay más de una columna para ${field}.` });
    else indexes.set(field, { index, source: key });
    if (cell.formula) errors.push({ row: 1, field, message: 'No uses fórmulas en los encabezados.' });
  });
  for (const required of ['sku', 'name'] as const) if (!indexes.has(required)) errors.push({ row: 1, field: required, message: `Falta la columna obligatoria ${required === 'sku' ? 'SKU' : 'Nombre'}.` });
  return { indexes, errors, ignoredColumns };
}

function cellValue(cell: Cell | undefined, field: ProductField): string {
  if (!cell || cell.raw === null || cell.raw === undefined) return '';
  if (typeof cell.raw === 'string') return cell.raw.trim();
  if (typeof cell.raw === 'number') {
    if (!Number.isFinite(cell.raw)) return '';
    if (field === 'sku' || field === 'barcode') {
      const format = (cell.numberFormat ?? '').split(';')[0].replace(/"[^"]*"/g, '').trim();
      if (/^0{2,}$/.test(format)) return (cell.formatted ?? String(Math.trunc(cell.raw))).trim();
      if (!Number.isSafeInteger(cell.raw)) return '';
      return String(cell.raw);
    }
    return String(cell.raw);
  }
  if (typeof cell.raw === 'boolean') return cell.raw ? 'true' : 'false';
  if (typeof cell.raw === 'object') return '';
  return normalizeText(cell.raw);
}

function parseDecimal(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, '');
  if (!normalized) return null;
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(normalized)) return Number.NaN;
  return Number(normalized.replace(',', '.'));
}

function parseTracking(value: string): Tracking | null {
  const normalized = normalizeHeader(value);
  if (!normalized) return null;
  if (['quantity', 'cantidad', 'granel', 'bulk', 'unit', 'unidades'].includes(normalized)) return 'QUANTITY';
  if (['serial', 'serie', 'serializado', 'serializada', 'unitario', 'unitaria', 'traceable'].includes(normalized)) return 'SERIAL';
  return null;
}

function parseProductRow(row: SourceRow, indexes: Map<ProductField, { index: number; source: string }>, defaultTracking?: Tracking): { product?: ParsedProduct; errors: RowError[] } {
  const errors: RowError[] = [];
  const value = (field: ProductField) => cellValue(row.cells[indexes.get(field)?.index ?? -1], field);
  for(const field of ['sku','barcode'] as const){
    const cell=row.cells[indexes.get(field)?.index??-1];
    if(typeof cell?.raw==='number'&&!Number.isSafeInteger(cell.raw))errors.push({row:row.row,field,message:'El identificador numérico perdió precisión. Guardá el SKU o código de barras como texto en Excel y volvé a importar.'});
  }
  for (let index = 0; index < row.cells.length; index++) if (row.cells[index]?.formula) errors.push({ row: row.row, field: indexes && [...indexes.entries()].find(([, entry]) => entry.index === index)?.[0], message: 'No uses fórmulas; pega valores en las celdas.' });
  const sku = value('sku').trim(), name = value('name').trim();
  if (!sku) errors.push({ row: row.row, field: 'sku', message: 'Completa el SKU.' });
  if (sku.length > 100) errors.push({ row: row.row, field: 'sku', message: 'El SKU admite hasta 100 caracteres.' });
  if (!name) errors.push({ row: row.row, field: 'name', message: 'Completa el nombre del producto.' });
  if (name.length > 500) errors.push({ row: row.row, field: 'name', message: 'El nombre admite hasta 500 caracteres.' });
  const barcodeText = value('barcode').trim();
  if (barcodeText.length > 160) errors.push({ row: row.row, field: 'barcode', message: 'El código de barras admite hasta 160 caracteres.' });
  const trackingText = value('tracking'), rowTracking = parseTracking(trackingText), tracking = rowTracking ?? defaultTracking ?? null;
  if (trackingText && !rowTracking) errors.push({ row: row.row, field: 'tracking', message: 'El seguimiento debe ser Cantidad o Serie.' });
  const unitText = value('unit').trim();
  if (unitText.length > 40) errors.push({ row: row.row, field: 'unit', message: 'La unidad admite hasta 40 caracteres.' });
  const weightText = value('weightGrams'), weightNumber = parseDecimal(weightText);
  const weightSource = indexes.get('weightGrams')?.source ?? '';
  const weightGrams = weightNumber === null ? null : weightKgAliases.has(weightSource) ? weightNumber * 1000 : weightNumber;
  if (weightNumber !== null && (!Number.isFinite(weightGrams) || weightGrams! <= 0 || !Number.isInteger(weightGrams))) errors.push({ row: row.row, field: 'weightGrams', message: 'El peso debe ser positivo y expresarse en gramos enteros o kilos con hasta 3 decimales.' });
  const volumeText = value('volumeCm3'), volumeNumber = parseDecimal(volumeText);
  const volumeSource = indexes.get('volumeCm3')?.source ?? '';
  const volumeCm3 = volumeNumber === null ? null : volumeM3Aliases.has(volumeSource) ? volumeNumber * 1_000_000 : volumeNumber;
  if (volumeNumber !== null && (!Number.isFinite(volumeCm3) || volumeCm3! <= 0 || !Number.isInteger(volumeCm3))) errors.push({ row: row.row, field: 'volumeCm3', message: 'El volumen debe ser positivo y expresarse en cm³ enteros o m³ con hasta 6 decimales.' });
  if (errors.length) return { errors };
  const has = (field: ProductField) => indexes.has(field);
  return { errors, product: {
    row: row.row, sku, name, barcode: barcodeText || null, tracking, unit: unitText || 'unidad',
    weightGrams, volumeCm3, action: 'ERROR', hasBarcode: has('barcode'), hasTracking: has('tracking') && Boolean(trackingText),
    hasUnit: has('unit') && Boolean(unitText), hasWeight: has('weightGrams'), hasVolume: has('volumeCm3')
  } };
}

function bodyDigest(clientId: string, payload: z.infer<typeof catalogBody>): string {
  const hash = createHash('sha256').update(clientId).update('\0');
  if (payload.csv !== undefined) hash.update('CSV\0').update(payload.csv);
  else hash.update('XLSX\0').update(payload.filename ?? '').update('\0').update(Buffer.from(payload.contentBase64!, 'base64'));
  hash.update('\0').update(payload.defaultTracking ?? '');
  return hash.digest('hex');
}

export class CatalogImport {
  readonly store: Database;
  constructor(store: Database) { this.store = store; }

  private allow(actor: InventoryActor) { ensure(['ADMIN', 'OPERATIONS'].includes(actor.role), 'FORBIDDEN', 'Solo Administración y Operaciones pueden importar el catálogo.', 403); }
  private async plan(actor: InventoryActor, clientId: string, file: FileContent, defaultTracking?: Tracking) {
    const rowErrors = [...file.errors];
    const ignoredColumns = file.rows[0] ? headersFrom(file.rows[0]).ignoredColumns : [];
    const client = await this.store.one('SELECT id FROM clients WHERE id=? AND org_id=?', clientId, actor.orgId);
    if (!client) return resultShape(Math.max(0, file.rows.length - 1), [], [...rowErrors, { row: 1, field: 'clientId', message: 'No se encontró el cliente en esta organización.' }], ignoredColumns);
    if (rowErrors.length || file.rows.length < 2) return resultShape(Math.max(0, file.rows.length - 1), [], rowErrors, ignoredColumns);
    const header = headersFrom(file.rows[0]);
    rowErrors.push(...header.errors);
    if (rowErrors.length) return resultShape(file.rows.length - 1, [], rowErrors, header.ignoredColumns);
    const parsedRows: ParsedProduct[] = [];
    for (const row of file.rows.slice(1)) {
      const parsed = parseProductRow(row, header.indexes, defaultTracking);
      rowErrors.push(...parsed.errors);
      if (parsed.product) parsedRows.push(parsed.product);
    }
    const skuFirst = new Map<string, number>(), barcodeFirst = new Map<string, number>();
    for (const row of parsedRows) {
      if (skuFirst.has(row.sku)) rowErrors.push({ row: row.row, field: 'sku', message: `El SKU está repetido; también aparece en la fila ${skuFirst.get(row.sku)}.` });
      else skuFirst.set(row.sku, row.row);
      if (row.barcode) {
        if (barcodeFirst.has(row.barcode)) rowErrors.push({ row: row.row, field: 'barcode', message: `El código de barras está repetido; también aparece en la fila ${barcodeFirst.get(row.barcode)}.` });
        else barcodeFirst.set(row.barcode, row.row);
      }
    }
    const existing = await this.store.all('SELECT * FROM inventory_products WHERE org_id=? AND client_id=?', actor.orgId, clientId);
    const bySku = new Map(existing.map(product => [product.sku, product]));
    const byBarcode = new Map(existing.filter(product => product.barcode).map(product => [product.barcode, product]));
    const unitBarcodes = new Set((await this.store.all('SELECT barcode FROM inventory_units WHERE org_id=? AND barcode IS NOT NULL', actor.orgId)).map(unit => unit.barcode));
    const plans: ProductPlan[] = [];
    for (const row of parsedRows) {
      const product = bySku.get(row.sku);
      if (!product && !row.tracking) rowErrors.push({ row: row.row, field: 'tracking', message: 'Los productos nuevos requieren seguimiento Cantidad o Serie.' });
      if (product && row.hasTracking && row.tracking !== product.tracking) rowErrors.push({ row: row.row, field: 'tracking', message: 'No se puede cambiar el seguimiento de un SKU existente.' });
      const next = {
        sku: row.sku, name: row.name,
        barcode: row.hasBarcode ? row.barcode : product?.barcode ?? null,
        tracking: (product?.tracking ?? row.tracking) as Tracking | null,
        unit: row.hasUnit ? row.unit : product?.unit ?? 'unidad',
        weightGrams: row.hasWeight ? row.weightGrams : product?.weight_grams ?? null,
        volumeCm3: row.hasVolume ? row.volumeCm3 : product?.volume_cm3 ?? null
      };
      if (next.barcode) {
        if (unitBarcodes.has(next.barcode)) rowErrors.push({ row: row.row, field: 'barcode', message: 'El código de barras ya pertenece a una unidad serializada.' });
        const barcodeOwner = byBarcode.get(next.barcode);
        if (barcodeOwner && barcodeOwner.id !== product?.id) {
          const ownerInBatch = parsedRows.find(other => other.sku === barcodeOwner.sku);
          const ownerPlanWillReleaseBarcode = ownerInBatch && ownerPlanBarcode(ownerInBatch, barcodeOwner) !== next.barcode;
          if (!ownerPlanWillReleaseBarcode) rowErrors.push({ row: row.row, field: 'barcode', message: 'El código de barras ya pertenece a otro SKU de este cliente.' });
        }
      }
      plans.push({ parsed: row, existing: product, next });
    }
    const allFinalBarcodes = new Map<string, string>();
    const changedBySku = new Map(plans.map(plan => [plan.parsed.sku, plan.next.barcode]));
    for (const product of existing) {
      const barcode = changedBySku.has(product.sku) ? changedBySku.get(product.sku) : product.barcode;
      if (!barcode) continue;
      const previous = allFinalBarcodes.get(barcode);
      if (previous && previous !== product.sku) rowErrors.push({ row: plans.find(plan => plan.parsed.sku === product.sku)?.parsed.row ?? 1, field: 'barcode', message: 'El resultado asignaría el mismo código de barras a varios SKU.' });
      else allFinalBarcodes.set(barcode, product.sku);
    }
    for (const plan of plans.filter(item => !item.existing)) if (plan.next.barcode) {
      const previous = allFinalBarcodes.get(plan.next.barcode);
      if (previous && previous !== plan.parsed.sku) rowErrors.push({ row: plan.parsed.row, field: 'barcode', message: 'El código de barras ya pertenece a otro SKU de este cliente.' });
      else allFinalBarcodes.set(plan.next.barcode, plan.parsed.sku);
    }
    // The scanner matches both identifiers case-insensitively, so their final namespace must be unambiguous.
    const updatesById=new Map(plans.filter(plan=>plan.existing).map(plan=>[plan.existing!.id,plan.next]));
    const rowBySku=new Map(plans.map(plan=>[plan.next.sku,plan.parsed.row]));
    const finalProducts=[...existing.map(product=>updatesById.get(product.id)??product),...plans.filter(plan=>!plan.existing).map(plan=>plan.next)];
    const scanOwners=new Map<string,string>();
    for(const product of finalProducts)for(const value of [product.sku,product.barcode]){
      if(!value)continue;
      const key=String(value).toLowerCase(),owner=scanOwners.get(key);
      if(owner&&owner!==product.sku)rowErrors.push({row:rowBySku.get(product.sku)??1,field:'barcode',message:'El SKU o código de barras identifica varios productos, incluso ignorando mayúsculas.'});
      else scanOwners.set(key,product.sku);
    }
    const rows: CatalogRow[] = plans.map(plan => {
      const action: CatalogAction = !plan.existing ? 'CREATE' : sameProduct(plan.existing, plan.next) ? 'UNCHANGED' : 'UPDATE';
      return { row: plan.parsed.row, ...plan.next, action };
    });
    if (rowErrors.length) for (const row of rows) row.action = 'ERROR';
    return resultShape(file.rows.length - 1, rows, rowErrors, header.ignoredColumns);
  }

  async preview(actor: InventoryActor, input: Row) {
    this.allow(actor);
    const parsed = catalogBody.safeParse(input);
    if (!parsed.success) return resultShape(0, [], parsed.error.issues.map(issue => ({ row: 1, field: issue.path.join('.') || undefined, message: friendlyInputIssue(issue) })));
    const file = parsePayload(parsed.data);
    return await this.plan(actor, parsed.data.clientId, file, parsed.data.defaultTracking);
  }

  async import(actor: InventoryActor, input: Row) {
    this.allow(actor);
    const parsed = catalogBody.safeExtend({ commandId: z.uuid() }).safeParse(input);
    if (!parsed.success) throw new DomainError('VALIDATION_ERROR', 'Revisa los datos enviados antes de importar.', 400, { rowErrors: parsed.error.issues.map(issue => ({ row: 1, field: issue.path.join('.') || undefined, message: friendlyInputIssue(issue) })) });
    const { commandId, clientId } = parsed.data;
    const digest = bodyDigest(clientId, parsed.data);
    const file = parsePayload(parsed.data);
    try {
      return await this.store.transaction(async () => {
      const previous = await this.store.one('SELECT * FROM inventory_commands WHERE org_id=? AND command_id=?', actor.orgId, commandId);
      if (previous) {
        ensure(previous.actor_id === actor.id && previous.operation === 'catalog.import' && previous.body_hash === digest, 'DUPLICATE_COMMAND', 'El identificador del lote ya se usó con otros datos o por otro usuario.');
        return JSON.parse(previous.response);
      }
      const report = await this.plan(actor, clientId, file, parsed.data.defaultTracking);
      if (!report.valid) throw new DomainError('VALIDATION_ERROR', 'El lote contiene errores y no se aplicaron cambios.', 400, { rowErrors: report.rowErrors, rows: report.rows, rowCount: report.rowCount, ignoredColumns: report.ignoredColumns });
      const plans = report.rows;
      const now = new Date().toISOString();
      const existingRows = await this.store.all('SELECT * FROM inventory_products WHERE org_id=? AND client_id=?', actor.orgId, clientId);
      const existingBySku = new Map(existingRows.map(product => [product.sku, product]));
      const changed = plans.filter(row => row.action === 'UPDATE');
      for (let start = 0; start < changed.length; start += 200) {
        const ids = changed.slice(start, start + 200).map(row => existingBySku.get(row.sku)!.id);
        if (ids.length) await this.store.run(`UPDATE inventory_products SET barcode=NULL WHERE org_id=? AND client_id=? AND id IN (${ids.map(() => '?').join(',')})`, actor.orgId, clientId, ...ids);
      }
      const writes = plans.filter(row => row.action === 'CREATE' || row.action === 'UPDATE');
      for (let start = 0; start < writes.length; start += 200) {
        const chunk = writes.slice(start, start + 200);
        const tuples: string[] = [], params: Array<string | number | null> = [];
        for (const row of chunk) {
          tuples.push('(?,?,?,?,?,?,?,?,?,?,1,?,?)');
          params.push(randomUUID(), actor.orgId, clientId, row.sku, row.barcode, row.name, row.tracking!, row.unit, row.weightGrams, row.volumeCm3, now, now);
        }
        await this.store.run(`INSERT INTO inventory_products(id,org_id,client_id,sku,barcode,name,tracking,unit,weight_grams,volume_cm3,active,created_at,updated_at)
          VALUES ${tuples.join(',')}
          ON CONFLICT(org_id,client_id,sku) DO UPDATE SET barcode=excluded.barcode,name=excluded.name,unit=excluded.unit,weight_grams=excluded.weight_grams,volume_cm3=excluded.volume_cm3,updated_at=excluded.updated_at`, ...params);
      }
      const response = { ...report, imported: true };
      await this.store.run('INSERT INTO inventory_commands(org_id,actor_id,command_id,operation,body_hash,response,created_at) VALUES(?,?,?,?,?,?,?)', actor.orgId, actor.id, commandId, 'catalog.import', digest, JSON.stringify(response), now);
      await this.store.run('INSERT INTO audit(id,org_id,actor_id,action,entity_id,command_id,details,created_at) VALUES(?,?,?,?,?,?,?,?)', randomUUID(), actor.orgId, actor.id, 'inventory.catalog.import', clientId, commandId, JSON.stringify({ createCount: report.createCount, updateCount: report.updateCount, unchangedCount: report.unchangedCount, rowCount: report.rowCount }), now);
      return response;
      });
    } catch (error) {
      // A concurrent retry may have won the unique organization/command key.
      const previous = await this.store.one('SELECT * FROM inventory_commands WHERE org_id=? AND command_id=?', actor.orgId, commandId);
      if (previous) {
        ensure(previous.actor_id === actor.id && previous.operation === 'catalog.import' && previous.body_hash === digest, 'DUPLICATE_COMMAND', 'El identificador del lote ya se usó con otros datos o por otro usuario.');
        return JSON.parse(previous.response);
      }
      throw error;
    }
  }

  templateCsv(actor: InventoryActor) {
    this.allow(actor);
    return 'SKU,Nombre,CodigoBarras,Seguimiento,Unidad,PesoKg,VolumenM3\r\n';
  }
}

function sameProduct(product: Row, next: Omit<CatalogRow, 'row' | 'action'>) {
  return product.name === next.name && (product.barcode ?? null) === next.barcode && product.tracking === next.tracking && product.unit === next.unit && (product.weight_grams ?? null) === next.weightGrams && (product.volume_cm3 ?? null) === next.volumeCm3;
}

function ownerPlanBarcode(row: ParsedProduct, existing: Row) {
  return row.hasBarcode ? row.barcode : existing.barcode ?? null;
}

export { MAX_FILE_BYTES, MAX_ROWS };
