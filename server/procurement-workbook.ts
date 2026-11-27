import * as XLSX from 'xlsx';
import { hash } from './auth.ts';
import { preflightZip } from './catalog-import.ts';
import { ensure } from './errors.ts';

export const maxWorkbookBytes = 5 * 1024 * 1024;
const headers = {
  date: 'Fecha', month: 'Mes', documentNumber: 'N° comprobante', documentType: 'Tipo de comprobante',
  supplier: 'Proveedor', taxId: 'RUC proveedor', description: 'Concepto / descripción', category: 'Categoría',
  costCenter: 'Centro de costo', paymentMethod: 'Medio de pago', taxRate: 'Tasa IVA', totalPyg: 'Monto total (Gs.)',
  taxPyg: 'IVA incluido (Gs.)', netPyg: 'Monto neto (Gs.)', historicalStatus: 'Estado', dueDate: 'Fecha de vencimiento',
  overdueDays: 'Días de atraso', responsible: 'Responsable', notes: 'Observaciones',
};
const paymentHeaders = { paymentDate:'Fecha de pago', invoiceReference:'N.º de factura',
  paymentAccount:'Cuenta de origen', paymentReference:'Referencia del pago', transferTotal:'Total de la transferencia (Gs.)' };
type Field = keyof typeof headers | keyof typeof paymentHeaders;
const fields = Object.keys(headers) as (keyof typeof headers)[];
const derived = new Set<Field>(['month', 'taxPyg', 'netPyg', 'overdueDays', 'historicalStatus']);
type OriginalCell = { address: string; type: string; value?: unknown; formatted?: string; format?: string | number; formula?: string; arrayFormula?: string };
export type ImportIssue = { code: string; message: string; field?: Field };
export type HistoricalRow = {
  date: string | null; month: string | null; documentNumber: string | null; documentType: string | null;
  supplier: string | null; taxId: string | null; description: string | null; category: string | null;
  costCenter: string | null; paymentMethod: string | null; taxRate: number | null; totalPyg: number | null;
  taxPyg: number | null; netPyg: number | null; historicalStatus: string | null; paidAccordingToFile: boolean;
  dueDate: string | null; overdueDays: number | null; responsible: string | null; notes: string | null;
  payment?: { date:string|null; invoiceReference:string|null; account:string|null; reference:string|null; transferTotal?:number|null; invoiceDocumentId?:string };
};
type WorkbookRow = {
  rowNumber: number; original: Partial<Record<Field, OriginalCell>>; normalized: HistoricalRow;
  issues: ImportIssue[]; fingerprint: string; matchKey: string | null; receiptKey: string | null;
};

const fold = (value: string) => value.trim().normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const headerKey = (value: string) => fold(value).replace(/[º°]/g, '').replace(/[^a-z0-9]/g, '').replace(/^nrocomprobante$/, 'ncomprobante');
const comparable = (value: string | null) => value?.trim().normalize('NFC').toLocaleLowerCase('es') ?? null;
const fingerprint = (values: unknown) => hash(JSON.stringify(values));
export const workbookFamily = (filename: string) => fold(filename.replace(/\.xlsx$/i, '')).replace(/(?:[-_ ]\d+| \(\d+\))$/, '');

function readCell(sheet: XLSX.WorkSheet, address: string): OriginalCell | undefined {
  const cell = sheet[address] as XLSX.CellObject | undefined;
  if (!cell) return;
  return { address, type: cell.t, value: cell.v, formatted: cell.w, format: cell.z, formula: cell.f, arrayFormula: cell.F };
}

function cellText(cell: OriginalCell | undefined, formatted = false): string | null {
  if (!cell || cell.type === 'e' || cell.value === undefined || cell.value === null || typeof cell.value === 'boolean') return null;
  return (formatted && cell.type === 'n' ? cell.formatted ?? String(cell.value) : String(cell.value)).trim() || null;
}

function wholePyg(cell: OriginalCell | undefined, allowNegative = false): number | null {
  const raw = cellText(cell);
  if (raw === null) return null;
  let value = cell?.type === 'n' ? cell.value : raw.replace(/^(?:₲|Gs\.?|PYG)\s*/i, '').trim();
  if (typeof value === 'string') {
    if (/^-?\d{1,3}(?:\.\d{3})+(?:,00)?$/.test(value)) value = value.replace(/\./g, '').replace(/,00$/, '');
    else if (/^-?\d{1,3}(?:,\d{3})+(?:\.00)?$/.test(value)) value = value.replace(/,/g, '').replace(/\.00$/, '');
    else if (/^-?\d+(?:[.,]00)?$/.test(value)) value = value.replace(/[.,]00$/, '');
    else return null;
    value = Number(value);
  }
  return typeof value === 'number' && Number.isSafeInteger(value) && (allowNegative || value >= 0) ? value : null;
}

function dateValue(cell: OriginalCell | undefined, date1904: boolean): string | null {
  const raw = cellText(cell);
  if (!raw) return null;
  let value = raw;
  if (cell?.type === 'n') {
    const serial = Number(cell.value);
    if (!Number.isInteger(serial) || serial <= 0 || !cell.format || !XLSX.SSF.is_date(cell.format)) return null;
    const parts = XLSX.SSF.parse_date_code(serial, { date1904 });
    if (!parts) return null;
    value = `${String(parts.y).padStart(4, '0')}-${String(parts.m).padStart(2, '0')}-${String(parts.d).padStart(2, '0')}`;
  } else if (/^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.test(raw)) {
    const [day, month, year] = raw.split(/[/-]/).map(Number);
    if (day <= 12 && day !== month) return null;
    value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

function vatRate(cell: OriginalCell | undefined): number | null {
  const raw = cellText(cell);
  if (!raw) return null;
  if (/^exent[oa]s?$/i.test(raw)) return 0;
  if (!/^\d+(?:[.,]\d+)?\s*%?$/.test(raw)) return null;
  const value = Number(raw.replace('%', '').trim().replace(',', '.'));
  const rate = raw.endsWith('%') || value >= 1 ? value : value * 100;
  return [0, 5, 10].includes(rate) ? rate : null;
}

function normalizeRow(original: WorkbookRow['original'], rowNumber: number, date1904: boolean, paymentsOnly:boolean): WorkbookRow {
  const issues: ImportIssue[] = [];
  const issue = (code: string, message: string, field?: Field) => issues.push({ code, message, field });
  const originalStatus = cellText(original.historicalStatus);
  const normalized: HistoricalRow = {
    date: dateValue(original.date, date1904), month: cellText(original.month, true),
    documentNumber: cellText(original.documentNumber, true), documentType: cellText(original.documentType),
    supplier: cellText(original.supplier), taxId: cellText(original.taxId, true), description: cellText(original.description),
    category: cellText(original.category), costCenter: cellText(original.costCenter), paymentMethod: cellText(original.paymentMethod),
    taxRate: vatRate(original.taxRate), totalPyg: wholePyg(original.totalPyg), taxPyg: wholePyg(original.taxPyg), netPyg: wholePyg(original.netPyg),
    historicalStatus: originalStatus, paidAccordingToFile: fold(originalStatus ?? '') === 'pagado',
    dueDate: dateValue(original.dueDate, date1904), overdueDays: wholePyg(original.overdueDays, true),
    responsible: cellText(original.responsible), notes: cellText(original.notes),
  };
  const explicitPayment = ['pago','recibo de pago'].includes(fold(normalized.documentType ?? ''));
  if (paymentsOnly || cellText(original.invoiceReference) && cellText(original.paymentReference) ||
      explicitPayment && Object.keys(paymentHeaders).some(field=>cellText(original[field as Field])!==null)) {
    normalized.payment = {
      date:dateValue(original.paymentDate,date1904),
      invoiceReference:cellText(original.invoiceReference,true),
      account:cellText(original.paymentAccount),
      reference:cellText(original.paymentReference,true),
      transferTotal:cellText(original.transferTotal)!==null||original.transferTotal?.formula||original.transferTotal?.arrayFormula
        ? wholePyg(original.transferTotal):undefined,
    };
    normalized.date=normalized.payment.date;
    normalized.documentType='Pago';
    normalized.documentNumber=normalized.payment.reference;
  }
  if (normalized.totalPyg === 0) normalized.totalPyg = null;
  if (normalized.totalPyg === null) issue('UNRESOLVED_TOTAL', 'Importe total sin valor entero positivo verificable.', 'totalPyg');
  if (!normalized.date) issue('UNRESOLVED_DATE', 'Fecha original vacía, inválida o ambigua.', 'date');
  else if(!normalized.payment) issue('DATE_ROLE_UNCONFIRMED', 'Confirmá si la fecha original corresponde al documento o al movimiento.', 'date');
  if (cellText(original.dueDate) && !normalized.dueDate) issue('UNRESOLVED_DUE_DATE', 'Vencimiento inválido o ambiguo.', 'dueDate');
  if (!normalized.supplier && !(normalized.payment&&normalized.taxId)) issue('MISSING_SUPPLIER', 'Proveedor faltante.', 'supplier');
  if (!normalized.taxId) issue('MISSING_TAX_ID', 'RUC faltante.', 'taxId');
  if (!normalized.documentNumber) issue('MISSING_DOCUMENT_NUMBER', 'Número de comprobante faltante.', 'documentNumber');
  if (!normalized.description) issue('MISSING_DESCRIPTION', 'Concepto faltante.', 'description');
  if (normalized.paidAccordingToFile&&!normalized.payment) issue('HISTORICAL_PAID', 'Pagado según archivo. Fecha de pago y cuenta sin confirmar.', 'historicalStatus');
  if ((cellText(original.taxRate) !== null && normalized.taxRate === null) ||
      (Boolean(original.taxRate?.formula || original.taxRate?.arrayFormula) && normalized.taxRate === null)) {
    issue('UNRESOLVED_VAT_RATE', 'Tasa de IVA sin valor verificable.', 'taxRate');
  }
  for (const field of ['taxPyg', 'netPyg'] as const) {
    if (normalized[field] === null && (cellText(original[field]) !== null || original[field]?.formula || original[field]?.arrayFormula)) {
      issue('UNRESOLVED_TAX_BREAKDOWN', 'Desglose de importe sin valor entero verificable.', field);
    }
  }
  if (normalized.totalPyg !== null && normalized.taxPyg !== null && normalized.netPyg !== null &&
      normalized.totalPyg - normalized.taxPyg !== normalized.netPyg) {
    issue('INCONSISTENT_TAX_BREAKDOWN', 'El IVA y el neto del archivo no suman el total.');
  }
  if ([normalized.notes,normalized.supplier].some(value=>/\b(?:piloto|ejemplo)\b/.test(fold(value??'')))) {
    issue('POSSIBLE_EXAMPLE', 'Posible fila de ejemplo o piloto.');
  }
  if (/\b(?:anticipo|cancelacion|saldo|activo|furgon)\b/.test(fold(normalized.description ?? ''))) {
    issue('OPERATION_UNCONFIRMED', 'Confirmá la naturaleza de esta operación.');
  }
  const supplier = normalized.taxId ? comparable(normalized.taxId) : comparable(normalized.supplier);
  const matchKey = !normalized.payment && normalized.date && supplier && normalized.totalPyg !== null
    ? fingerprint([normalized.date, supplier, normalized.totalPyg]) : null;
  const receiptKey = supplier && normalized.documentNumber
    ? fingerprint([supplier, comparable(normalized.documentType), comparable(normalized.documentNumber),
      ...(normalized.payment?[comparable(normalized.payment.invoiceReference)]:[])]) : null;
  const { month: _month, overdueDays: _overdueDays, ...values } = normalized;
  // Preserve ambiguous entered values and unresolved formula identities in the match across versions.
  const unresolved = fields.filter(field => !derived.has(field) && values[field as keyof typeof values] === null && original[field])
    .map(field => [field, original[field]?.value, original[field]?.formula, original[field]?.arrayFormula]);
  return { rowNumber, original, normalized, issues, fingerprint: fingerprint([values, unresolved]), matchKey, receiptKey };
}

function parametersFrom(book: XLSX.WorkBook) {
  const name = book.SheetNames.find(item => fold(item) === 'parametros');
  const sheet = name ? book.Sheets[name] : undefined;
  if (!name || !sheet) return null;
  const addresses = Object.keys(sheet).filter(address => /^[A-Z]+\d+$/.test(address));
  const cells = addresses.map(address => readCell(sheet, address)!)
    .filter(cell => cellText(cell) !== null || cell.formula || cell.arrayFormula);
  const aliases = new Map([
    ['categoria', 'categories'], ['categoriadegasto', 'categories'], ['categoriadelgasto', 'categories'], ['centrodecosto', 'costCenters'], ['mediodepago', 'paymentMethods'],
    ['tipodecomprobante', 'documentTypes'], ['tasaiva', 'taxRates'], ['estado', 'historicalStatuses'],
  ]);
  const lists: Record<string, Array<string | number>> = {};
  const budgets: Array<{ category: string; amountPyg: number | null; address: string }> = [];
  const issues: ImportIssue[] = [];
  const lastRow = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']).e.r : 0;
  for (const cell of cells) {
    const key = aliases.get(headerKey(cellText(cell) ?? ''));
    const header = XLSX.utils.decode_cell(cell.address);
    if (!key || header.r >= 20 || lists[key]) continue;
    lists[key] = [];
    const budgetColumn = key==='categories' ? cells.map(cell=>({
      position:XLSX.utils.decode_cell(cell.address), key:headerKey(cellText(cell) ?? ''),
    })).find(item=>item.position.r===header.r&&item.position.c!==header.c&&/^presupuesto/.test(item.key))?.position.c : undefined;
    for (let r = header.r + 1; r <= Math.min(header.r + 1000,lastRow); r++) {
      const entry = readCell(sheet, XLSX.utils.encode_cell({ r, c: header.c }));
      const label = cellText(entry, true);
      if (!label) continue;
      const value = key === 'taxRates' ? vatRate(entry) : label;
      if (value !== null) lists[key].push(value);
      else issues.push({ code: 'INVALID_PARAMETER_RATE', message: `Tasa histórica sin verificar en ${entry!.address}.` });
      if (budgetColumn!==undefined) {
        const address = XLSX.utils.encode_cell({ r, c: budgetColumn });
        const budget = readCell(sheet, address);
        const amountPyg = wholePyg(budget);
        if (amountPyg === null && (cellText(budget) !== null || budget?.formula || budget?.arrayFormula)) {
          issues.push({ code: 'INVALID_PARAMETER_BUDGET', message: `Presupuesto histórico sin verificar en ${address}.` });
        }
        budgets.push({ category: label, amountPyg, address });
      }
    }
  }
  if (budgets.some(budget => budget.amountPyg !== null)) {
    issues.push({ code: 'PARAMETER_BUDGET_PERIOD_UNCONFIRMED', message: 'Confirmá el mes antes de registrar un presupuesto de la hoja Parámetros.' });
  }
  const year = /^anodecontrol$/.test(headerKey(cellText(readCell(sheet, 'A3')) ?? ''))
    ? wholePyg(readCell(sheet, 'B3')) : null;
  const month = /^mesdeanalisis/.test(headerKey(cellText(readCell(sheet, 'D3')) ?? ''))
    ? wholePyg(readCell(sheet, 'E3')) : null;
  const controlYear = year && year >= 1900 && year <= 9999 ? year : null;
  const budgetMonth = controlYear && month && month <= 12 ? `${controlYear}-${String(month).padStart(2, '0')}` : null;
  return { sheet: name, cells, lists, budgets, issues, controlYear, budgetMonth };
}

type WorkbookParameters = ReturnType<typeof parametersFrom>;

function semesterFrom(book:XLSX.WorkBook,parameters:WorkbookParameters,date1904:boolean) {
  const name=book.SheetNames.find(name=>/^resumen jul[-–]dic/.test(fold(name)));
  if(!name)return null;
  const sheet=book.Sheets[name];
  const start=dateValue(readCell(sheet,'B3'),date1904);
  if(!start?.endsWith('-07-01')||fold(cellText(readCell(sheet,'A6'))??'')!=='total gastos del periodo')return null;
  const numeric=(address:string)=>{
    const cell=readCell(sheet,address);
    return cell?.type==='n'&&typeof cell.value==='number'&&Number.isFinite(cell.value)?cell.value:null;
  };
  const number=(address:string,negative=false)=>wholePyg(readCell(sheet,address),negative);
  const month=dateValue(readCell(sheet,'B12'),date1904)?.slice(0,7)??null;
  const categoryTotal=fold(cellText(readCell(sheet,'A68'))??'')==='total';
  const budgetAmounts=parameters?.budgets.flatMap(row=>row.amountPyg??[])??[];
  const monthlyBudget=budgetAmounts.length?budgetAmounts.reduce((sum,n)=>sum+n,0):null;
  return {sheet:name,year:Number(start.slice(0,4)),monthlyBudget,values:{
    totalPyg:number('B6'),vatPyg:number('B7'),netPyg:number('B8'),pendingPyg:number('B9'),count:number('B10'),
    averagePyg:numeric('B11'),peakMonth:month,peakPyg:number('B13'),
    budgetPyg:categoryTotal?number('J68'):null,remainingPyg:categoryTotal?number('K68',true):null,
    executionRatio:categoryTotal?numeric('L68'):null,
  }};
}

function sourceControls(book: XLSX.WorkBook, parameters: WorkbookParameters, date1904: boolean) {
  const controls: Array<{ sheet: string; address: string; from: string; before: string; amountPyg: number }> = [];
  const record = (sheet: XLSX.WorkSheet, sheetName: string, address: string, from: string, before: string) => {
    const amountPyg = wholePyg(readCell(sheet, address));
    if (amountPyg !== null) controls.push({ sheet: sheetName, address, from, before, amountPyg });
  };
  const nextMonth = (value: string, count: number) => {
    const [year, month] = value.split('-').map(Number);
    const index = year * 12 + month - 1 + count;
    return `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}-01`;
  };
  for (const sheetName of book.SheetNames) {
    const sheet = book.Sheets[sheetName], name = fold(sheetName);
    const totals = (expected: string) => Object.keys(sheet).find(address =>
      /^A\d+$/.test(address) && fold(cellText(readCell(sheet, address)) ?? '') === expected);
    if (name === 'resumen mensual' && parameters?.controlYear) {
      const row = totals('total gastos');
      if (row) record(sheet, sheetName, 'N' + row.slice(1), `${parameters.controlYear}-01-01`, `${parameters.controlYear + 1}-01-01`);
    } else if (/^resumen jul[-–]dic/.test(name) && totals('total gastos del periodo') === 'A6') {
      const first = dateValue(readCell(sheet, 'B3'), date1904);
      if (first?.endsWith('-01')) record(sheet, sheetName, 'B6', first, nextMonth(first, 6));
    } else if (name === 'presupuesto vs real' && parameters?.budgetMonth) {
      const row = totals('total');
      if (row) record(sheet, sheetName, 'C' + row.slice(1), parameters.budgetMonth + '-01', nextMonth(parameters.budgetMonth, 1));
    }
  }
  return controls;
}

export function parseProcurementWorkbook(buffer: Buffer) {
  ensure(buffer.length <= maxWorkbookBytes, 'VALIDATION_ERROR', 'El Excel supera 5 MB.', 400);
  const zipProblem = preflightZip(buffer);
  ensure(!zipProblem, 'VALIDATION_ERROR', zipProblem ?? '', 400);
  let book: XLSX.WorkBook;
  try {
    book = XLSX.read(buffer, { type: 'buffer', cellFormula: true, cellNF: true, cellText: true, cellDates: false });
  } catch {
    ensure(false, 'VALIDATION_ERROR', 'No se pudo leer el archivo .xlsx.', 400);
  }
  const registerName = book.SheetNames.find(item => fold(item) === 'registro');
  const paymentsName = book.SheetNames.find(item => fold(item) === 'pagos');
  ensure(!registerName||!paymentsName,'VALIDATION_ERROR','Importá las hojas Registro y Pagos como archivos separados.',400);
  const sheetName = registerName ?? paymentsName;
  const paymentsOnly=Boolean(paymentsName);
  const sheet = sheetName ? book.Sheets[sheetName] : undefined;
  ensure(sheetName && sheet?.['!ref'], 'VALIDATION_ERROR', 'Falta la hoja Registro o Pagos del Excel.', 400);
  const range = XLSX.utils.decode_range(sheet['!ref']);
  ensure(range.e.r < 10_004 && range.e.c < 64, 'VALIDATION_ERROR', 'La hoja supera 10.004 filas o 64 columnas.', 400);
  let headerRow = -1;
  const columns = new Map<Field, number>();
  const labels = new Map<string,Field>([...Object.entries(headers),...Object.entries(paymentHeaders)]
    .map(([field,label])=>[headerKey(label),field as Field]));
  labels.set(headerKey('N° factura'),'invoiceReference');
  labels.set(headerKey('Número de factura'),'invoiceReference');
  labels.set(headerKey('Factura'),'invoiceReference');
  labels.set(headerKey('Cuenta'),'paymentAccount');
  labels.set(headerKey('Referencia de pago'),'paymentReference');
  labels.set(headerKey('Importe del pago (Gs.)'),'totalPyg');
  labels.set(headerKey('Importe (Gs.)'),'totalPyg');
  labels.set(headerKey('Importe aplicado (Gs.)'),'totalPyg');
  labels.set(headerKey('RUC'),'taxId');
  if(paymentsOnly) {
    labels.set(headerKey('Fecha'),'paymentDate');
    labels.set(headerKey('N° comprobante'),'paymentReference');
  }
  for (let row = range.s.r; row <= Math.min(range.e.r, 19); row++) {
    columns.clear();
    let duplicateHeader = false;
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cell = readCell(sheet, XLSX.utils.encode_cell({ r: row, c: col }));
      const field = labels.get(headerKey(cellText(cell) ?? ''));
      if (!field) continue;
      if (columns.has(field)) duplicateHeader = true;
      columns.set(field, col);
    }
    const recognized = paymentsOnly
      ? columns.has('totalPyg') && ['paymentDate','invoiceReference','paymentAccount','paymentReference','taxId','supplier']
        .some(field=>columns.has(field as Field))
      : fields.every(field=>columns.has(field));
    if (!duplicateHeader && recognized) { headerRow = row; break; }
  }
  ensure(headerRow !== -1, 'VALIDATION_ERROR', paymentsOnly?'Revisá los encabezados de la hoja Pagos.':'Revisá las 19 columnas de la hoja Registro.', 400);
  const rows: WorkbookRow[] = [];
  let ignoredFormulaRows = 0;
  const date1904 = Boolean(book.Workbook?.WBProps?.date1904);
  for (let row = headerRow + 1; row <= range.e.r; row++) {
    const original: WorkbookRow['original'] = {};
    for (const [field, c] of columns) {
      const cell = readCell(sheet, XLSX.utils.encode_cell({ r: row, c }));
      if (cell) original[field] = cell;
    }
    if (![...columns.keys()].some(field => !derived.has(field) && !original[field]?.formula && !original[field]?.arrayFormula && cellText(original[field]) !== null)) {
      if (Object.values(original).some(cell => cell.formula || cell.arrayFormula)) ignoredFormulaRows++;
      continue;
    }
    rows.push(normalizeRow(original, row + 1, date1904,paymentsOnly));
  }

  const matching = new Map<string, number[]>();
  const receipts = new Map<string, number>();
  for (const row of rows) {
    if (row.receiptKey) receipts.set(row.receiptKey, (receipts.get(row.receiptKey) ?? 0) + 1);
    if (!row.matchKey) continue;
    const positions = matching.get(row.matchKey) ?? [];
    positions.push(row.rowNumber);
    matching.set(row.matchKey, positions);
  }
  for (const row of rows) {
    const positions = row.matchKey ? matching.get(row.matchKey) : undefined;
    if (positions && positions.length > 1 && !row.issues.some(issue => issue.code === 'POSSIBLE_DUPLICATE')) {
      row.issues.push({ code: 'POSSIBLE_DUPLICATE', message: `Coinciden fecha, proveedor e importe en ${positions.length} filas. Revisá antes de promover.` });
    }
    if (row.receiptKey && (receipts.get(row.receiptKey) ?? 0) > 1) {
      row.issues.push({ code: 'POSSIBLE_DUPLICATE', message: 'Hay varias filas con el mismo proveedor y comprobante.' });
    }
  }

  const openingCell = !paymentsOnly && headerRow > 0 ? readCell(sheet, 'M1') : undefined;
  const opening = openingCell && (cellText(openingCell) || openingCell.formula || openingCell.arrayFormula)
    ? { cell: openingCell, amountPyg: wholePyg(openingCell, true), state: 'PENDING' as const } : null;
  const total = rows.reduce((sum, row) => sum + BigInt(row.normalized.totalPyg ?? 0), 0n);
  ensure(total <= BigInt(Number.MAX_SAFE_INTEGER), 'VALIDATION_ERROR', 'El total del archivo supera el máximo permitido.', 400);
  const totalPyg = Number(total);
  const historicallyPaidCount = rows.filter(row => row.normalized.paidAccordingToFile).length;
  const issues: ImportIssue[] = [];
  if (opening) issues.push({ code: 'UNCLASSIFIED_OPENING', message: 'Saldo inicial de Registro!M1 pendiente de fecha, naturaleza y cuenta.' });
  const parameters = parametersFrom(book);
  return { sheet: sheetName, rows, summary: { parameterLayoutVersion:2, rowCount: rows.length, paymentRows:rows.filter(row=>row.normalized.payment).length, ignoredFormulaRows, totalPyg, historicallyPaidCount,
    semester:semesterFrom(book,parameters,date1904),
    unresolvedTotalCount: rows.filter(row => row.normalized.totalPyg === null).length,
    issues: [...issues, ...(parameters?.issues ?? [])], opening, parameters, controls: sourceControls(book, parameters, date1904),
    ignoredSheets: book.SheetNames.filter(name => name !== sheetName && fold(name) !== 'parametros'),
  } };
}
