import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { passwordHash, type Actor } from '../server/auth.ts';
import type { Database } from '../server/database.ts';
import { Store } from '../server/db.ts';
import { PostgresStore } from '../server/postgres.ts';
import { ProcurementImport } from '../server/procurement-import.ts';
import { Procurement } from '../server/procurement.ts';
import { ProcurementRegister } from '../server/procurement-register.ts';
import { ProcurementReads } from '../server/procurement-reads.ts';
import { parseProcurementWorkbook } from '../server/procurement-workbook.ts';

const labels = ['Fecha', 'Mes', 'N° comprobante', 'Tipo de comprobante', 'Proveedor', 'RUC proveedor', 'Concepto / descripción',
  'Categoría', 'Centro de costo', 'Medio de pago', 'Tasa IVA', 'Monto total (Gs.)', 'IVA incluido (Gs.)', 'Monto neto (Gs.)',
  'Estado', 'Fecha de vencimiento', 'Días de atraso', 'Responsable', 'Observaciones'];

function fixtureWorkbook(change = false) {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Datos sintéticos de QA'], [], [], labels,
    ['2026-11-19', '', 'QA-0001', 'Factura', 'Proveedor sintético', 'QA-RUC', 'Compra QA', 'Insumos', 'Taller', '', 0.1, 110_000,
      10_000, 100_000, 'Pagado', '2026-11-28', null, 'Responsable QA', 'Posible piloto'],
    ['2026-11-20', '', 'QA-0002', 'Factura', 'Proveedor sintético', 'QA-RUC', 'Cancelación furgón QA', 'Movilidad', '', '', 5,
      change ? 210_000 : 105_000, change ? 10_000 : 5_000, change ? 200_000 : 100_000, 'Pendiente', null],
    ['03/04/2026', '', '', '', '', '', 'Gasto sin datos', '', '', '', 0, null, null, null, 'Pagado'],
    ['2026-11-19', '', '', '', 'Proveedor sintético', 'QA-RUC', 'Coincidencia QA', '', '', '', 0, 110_000, 0, 110_000, 'Pagado'],
  ]);
  sheet.M1 = { t: 'n', v: 12_000_000 };
  sheet.M5 = { t: 'n', v: 10_000, f: 'L5/11' };
  sheet.L7 = { t: 'n', f: '1+999' } as XLSX.CellObject;
  sheet.A9 = { t: 'n', v: 47_110, f: 'TODAY()', z: 'dd/mm/yyyy' };
  sheet.L9 = { t: 'n', v: 0, f: 'SUM(M9:N9)' };
  sheet.O9 = { t: 's', v: 'Pagado', f: '"Pagado"' };
  sheet['!ref'] = 'A1:S9';
  XLSX.utils.book_append_sheet(book, sheet, 'Registro');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Categoría', 'Presupuesto'], ['Movilidad', 0], ['Insumos']]), 'Parámetros');
  for (const name of ['Resumen', 'Gráficos', 'Vencimientos', 'Otros']) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Total', 999_999_999]]), name);
  }
  return Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
}

test('El parser conserva procedencia y distingue fecha ambigua, fórmulas guardadas y filas preformuladas', () => {
  const result = parseProcurementWorkbook(fixtureWorkbook());
  assert.equal(result.sheet, 'Registro');
  assert.deepEqual(result.rows.map(row => row.rowNumber), [5, 6, 7, 8]);
  assert.equal(result.summary.ignoredFormulaRows, 1);
  assert.deepEqual([result.summary.totalPyg, result.summary.historicallyPaidCount, result.summary.unresolvedTotalCount], [325_000, 3, 1]);
  assert.equal(result.summary.opening?.amountPyg, 12_000_000);
  assert.equal(result.summary.opening?.state, 'PENDING');
  assert.equal(result.summary.parameters?.cells.find(cell => cell.address === 'B2')?.value, 0);
  assert.equal(result.summary.parameters?.cells.find(cell => cell.address === 'B3'), undefined);
  assert.deepEqual(result.summary.parameters?.budgets.map(budget => budget.amountPyg), [0, null]);
  assert.equal(result.summary.ignoredSheets.length, 4);
  const [first, second, third, fourth] = result.rows;
  assert.equal(first.normalized.taxRate, 10);
  assert.equal(first.original.taxPyg?.formula, 'L5/11');
  assert.equal(first.normalized.taxPyg, 10_000);
  assert(first.issues.some(issue => issue.code === 'POSSIBLE_EXAMPLE'));
  assert(first.issues.some(issue => issue.code === 'POSSIBLE_DUPLICATE'));
  assert(fourth.issues.some(issue => issue.code === 'POSSIBLE_DUPLICATE'));
  assert.equal(second.normalized.historicalStatus, 'Pendiente');
  assert(second.issues.some(issue => issue.code === 'OPERATION_UNCONFIRMED'));
  assert.equal(third.normalized.date, null);
  assert.equal(third.normalized.totalPyg, null);
  assert(third.issues.some(issue => issue.code === 'UNRESOLVED_TOTAL'));
});

test('El parser rechaza archivos que no sean .xlsx y libros sin los encabezados requeridos', () => {
  assert.throws(() => parseProcurementWorkbook(Buffer.from('Fecha;Proveedor;Monto')), /Excel/);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Fecha', 'Proveedor']]), 'Registro');
  const bytes = Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
  assert.throws(() => parseProcurementWorkbook(bytes), /19 columnas/);
});

async function verifyImport(store: Database) {
  const orgId = randomUUID(), userId = randomUUID();
  await store.run('INSERT INTO organizations(id,name,timezone) VALUES(?,?,?)', orgId, 'Organización sintética', 'America/Asuncion');
  await store.run("INSERT INTO users(id,org_id,username,name,password_hash,role,driver_id) VALUES(?,?,?,?,?,'ADMIN',NULL)",
    userId, orgId, `importacion-qa-${userId}`, 'Admin QA', passwordHash(randomUUID()));
  const admin: Actor = { orgId, id: userId, role: 'ADMIN', name: 'Admin QA', driverId: null };
  const crossTenant = { ...admin, orgId: randomUUID() }, operator = { ...admin, role: 'OPERATIONS' as const };
  const procurement = new Procurement(store);
  const importer = new ProcurementImport(store, procurement);
  const party = await procurement.execute(admin, { commandId: randomUUID(), action: 'PARTY', name: 'Proveedor sintético QA', kind: 'SUPPLIER', active: true });
  const documentCount = async () => (await store.one('SELECT COUNT(*) AS n FROM procurement_documents WHERE org_id=?', orgId))?.n;
  const movementCount = async () => (await store.one('SELECT COUNT(*) AS n FROM procurement_movements WHERE org_id=?', orgId))?.n;
  const bytes = fixtureWorkbook();
  const upload = (content: Buffer, filename: string) => ({ filename, contentBase64: content.toString('base64') });
  const [first, repeated] = await Promise.all([importer.upload(admin, upload(bytes, 'Control-QA-1.xlsx')),
    importer.upload(admin, upload(bytes, 'Control-QA-1.xlsx'))]);
  assert.equal(first.id, repeated.id);
  assert.equal((await importer.list(admin)).items.length, 1);
  assert.deepEqual((await importer.original(admin, first.id)).bytes, bytes);
  assert.equal(first.rows.length, 4);
  await assert.rejects(() => importer.original(crossTenant, first.id), /Lote no encontrado/);
  await assert.rejects(() => importer.original(operator, first.id), /Tu rol/);
  await assert.rejects(() => importer.upload(operator, upload(bytes, 'Control-QA-1.xlsx')), /Tu rol/);
  assert.equal(await documentCount(), 0);
  assert.equal(await movementCount(), 0);
  assert.equal(first.summary.opening.state, 'PENDING');

  const paid = first.rows[0], payable = first.rows[1];
  const promote = (totalPyg: number, acknowledgePrior?: boolean) => ({ commandId: randomUUID(), action: 'PROMOTE', reason: 'Interpretación sintética confirmada',
    operation: { action: 'DOCUMENT', partyId: party.id, nature: 'PURCHASE', documentDate: '2026-11-20', dueDate: '2026-11-24',
      condition: 'CREDIT', lines: [{ description: 'Compra QA verificada', totalPyg, vatRate: 5, vatPyg: Math.trunc(totalPyg / 21), netPyg: totalPyg - Math.trunc(totalPyg / 21) }] }, acknowledgePrior,
  });
  await assert.rejects(() => importer.resolve(admin, first.id, paid.id, promote(110_000, true)), /Confirmá fecha de pago/);
  await assert.rejects(() => importer.resolve(admin, first.id, payable.id, promote(999)), /coincidir con el total/);
  assert.equal(await documentCount(), 0);
  const command = promote(105_000);
  const [promoted, concurrentRetry] = await Promise.all([importer.resolve(admin, first.id, payable.id, command), importer.resolve(admin, first.id, payable.id, command)]);
  assert.equal(promoted.state, 'PROMOTED');
  assert.deepEqual(concurrentRetry, promoted);
  assert.equal(await documentCount(), 1);
  const document = await store.one('SELECT import_row_id,total_pyg FROM procurement_documents WHERE org_id=? AND id=?', orgId, promoted.outcome.operationId);
  assert.equal(document?.import_row_id, payable.id);
  assert.equal(document?.total_pyg, 105_000);

  const changed = await importer.upload(admin, upload(fixtureWorkbook(true), 'Control-QA-2.xlsx'));
  assert.notEqual(changed.id, first.id);
  const changedRow = changed.rows[1];
  assert.equal(changedRow.prior[0].type, 'CHANGED');
  assert.equal(changedRow.prior[0].state, 'PROMOTED');
  assert.equal(changedRow.prior[0].operationId, promoted.outcome.operationId);
  await assert.rejects(() => importer.resolve(admin, changed.id, changedRow.id, promote(210_000, true)), /versión previa/);
  assert.equal(changed.rows[0].prior[0].type, 'UNCHANGED');
  const register = new ProcurementRegister(store);
  const entries = await register.list(admin,{from:'2026-11-20',to:'2026-11-20'});
  assert.equal(entries.count,1);
  assert.deepEqual(entries.items.map(item=>[item.id,item.origin,item.totalPyg]),[[promoted.outcome.operationId,'IMPORTED',105_000]]);
  await assert.rejects(register.list(crossTenant,{}),{code:'FORBIDDEN'});

  const ambiguous = changed.rows[2];
  const skipped = await importer.resolve(admin, changed.id, ambiguous.id, { commandId: randomUUID(), action: 'SKIP', reason: 'Fecha de origen ambigua' });
  assert.equal(skipped.state, 'SKIPPED');
  const skippedPreview = await importer.detail(admin, changed.id, { state: 'SKIPPED', limit: 1 });
  assert.deepEqual(skippedPreview.rows.map(row => row.id), [ambiguous.id]);
  assert.equal(skippedPreview.hasMore, false);
  const pendingPreview = await importer.detail(admin, changed.id, { state: 'PENDING' });
  assert.ok(pendingPreview.rows.every(row => row.state === 'PENDING'));
  assert.equal(await documentCount(), 1);
  assert.equal(await movementCount(), 0);
  const row = await importer.rowDetail(admin, changed.id, ambiguous.id);
  assert.equal(row.resolutionReason, 'Fecha de origen ambigua');
  assert.equal(row.original.date.value, '03/04/2026');
}

function fixtureSetupWorkbook() {
  const book = XLSX.read(fixtureWorkbook(), {type:'buffer'});
  const sheet = book.Sheets.Registro;
  sheet.A5.v = '2026-07-19';
  sheet.F5.v = '80012345-1';
  sheet.F6.v = '80012345-1';
  sheet.F8.v = '80012345-1';
  const parameters = XLSX.utils.aoa_to_sheet([
    [],[],['Año de control',2026,null,'Mes de análisis (1-12)',11],[],
    ['Categoría de gasto','Presupuesto mensual (Gs.)',null,'Centro de costo','Medio de pago'],
    ['Movilidad',0,null,'Taller','Transferencia bancaria'],
    ['Insumos',50_000,null,'Administración','Efectivo'],
    ['Servicios'],
  ]);
  book.Sheets['Parámetros'] = parameters;
  const appendControl = (name:string, data:Record<string,XLSX.CellObject>, ref:string) =>
    XLSX.utils.book_append_sheet(book,{...data,'!ref':ref},name);
  appendControl('Resumen Mensual',{A46:{t:'s',v:'TOTAL GASTOS'},N46:{t:'n',v:325_000,f:'SUM(N6:N45)'}},'A1:N46');
  appendControl('Resumen Jul-Dic 2026',{B3:{t:'n',v:46204,z:'yyyy-mm-dd'},A6:{t:'s',v:'Total gastos del período'},B6:{t:'n',v:325_000,f:'SUM(B17:G17)'}},'A1:G17');
  appendControl('Presupuesto vs Real',{A46:{t:'s',v:'TOTAL'},C46:{t:'n',v:210_000,f:'SUM(C6:C45)'}},'A1:C46');
  return Buffer.from(XLSX.write(book,{type:'buffer',bookType:'xlsx'}));
}

async function verifySourceSetup(store:Database) {
  const orgId=randomUUID(), id=randomUUID();
  const actor:Actor={orgId,id,role:'ADMIN',name:'QA config',driverId:null};
  await store.run('INSERT INTO organizations(id,name,timezone) VALUES(?,?,?)',orgId,'QA planilla','America/Asuncion');
  await store.run("INSERT INTO users(id,org_id,username,name,password_hash,role) VALUES(?,?,?,?,?,'ADMIN')",id,orgId,'qa-planilla-'+id,actor.name,'unused');
  const procurement=new Procurement(store), importer=new ProcurementImport(store,procurement);
  const execute=(action:string,fields:object)=>procurement.execute(actor,{action,commandId:randomUUID(),...fields});
  const existing=await execute('CATEGORY',{name:'Insumos'});
  await execute('BUDGET',{categoryId:existing.id,month:'2026-11',amountPyg:90_000});
  const bytes=fixtureSetupWorkbook();
  const batch=await importer.upload(actor,{filename:'Planilla sintética.xlsx',contentBase64:bytes.toString('base64')});
  assert.equal((await importer.active(actor)).batch?.id,batch.id);
  const workspace=await importer.workspace(actor,batch.id);
  assert.deepEqual(workspace.controls.map(row=>row.differencePyg),[0,0,5_000]);
  assert.deepEqual(workspace.totals,{
    count:4,totalPyg:325_000,vatPyg:15_000,netPyg:310_000,incompleteBreakdown:1,
    paidPyg:220_000,pendingPyg:105_000,paidCount:3,pendingCount:1,
  });
  const explicitlyPending=await importer.detail(actor,batch.id,{scope:'pending'});
  assert.deepEqual(explicitlyPending.rows.map(row=>row.rowNumber),[6]);
  assert.deepEqual(workspace.states,{PENDING:4,PROMOTED:0,SKIPPED:0});
  assert.deepEqual(workspace.setup.budgets.map(item=>[item.category,item.month,item.amountPyg]),[['Movilidad','2026-11',0]]);
  assert.equal(workspace.budgets.find(item=>item.category==='Servicios')?.budgetPyg,null);
  assert.equal(workspace.budgets.find(item=>item.category==='Insumos')?.budgetPyg,50_000);
  assert.equal(workspace.setup.parties.length,0);
  const suppliers=await store.all('SELECT name,ruc,active FROM procurement_parties WHERE org_id=?',orgId);
  assert.deepEqual(suppliers.map(row=>[row.name,row.ruc,Number(row.active)]),[['Proveedor sintético','80012345-1',1]]);
  assert.deepEqual(workspace.budgets.map(item=>item.category),['Movilidad','Insumos','Servicios',null]);
  assert.deepEqual(workspace.budgetPeriod,{from:'2026-01-01',before:'2026-12-01'});
  assert.deepEqual(workspace.budgets[1],{
    category:'Insumos',key:'V:Insumos',budgetPyg:50_000,realPyg:0,differencePyg:50_000,executionRatio:0,
    budgetAccumulatedPyg:550_000,realAccumulatedPyg:110_000,differenceAccumulatedPyg:440_000,executionAccumulatedRatio:0.2,
  });
  assert.equal(workspace.budgets[0].differencePyg,-105_000);
  assert.equal(workspace.budgets[0].executionRatio,null);
  assert.equal(workspace.budgets[3].differencePyg,-110_000);
  assert.equal(workspace.groups.month.find(item=>item.label==='2026-11')?.totalPyg,215_000);
  const period=await importer.detail(actor,batch.id,{from:'2026-11-01',before:'2026-12-01'});
  assert.deepEqual(period.rows.map(row=>row.rowNumber),[6,8]);
  const ytd=await importer.detail(actor,batch.id,{group:'category',key:'V:Insumos',from:'2026-01-01',before:'2026-12-01'});
  assert.deepEqual(ytd.rows.map(row=>row.rowNumber),[5]);
  const category=await importer.detail(actor,batch.id,{group:'category',key:'V:Movilidad',month:'2026-11'});
  assert.equal(category.rows[0].normalized.totalPyg,105_000);
  const filtered=await importer.detail(actor,batch.id,{q:'cancelacion',supplier:'V:Proveedor sintético',category:'V:Movilidad',
    historicalStatus:'V:Pendiente',dateFrom:'2026-11-20',to:'2026-11-20',limit:1});
  assert.deepEqual(filtered.rows.map(row=>row.rowNumber),[6]);
  assert.equal(filtered.hasMore,false);
  assert.deepEqual((await importer.detail(actor,batch.id,{supplier:'N'})).rows.map(row=>row.rowNumber),[7]);
  await assert.rejects(importer.workspace({...actor,role:'OPERATIONS'},batch.id),{code:'FORBIDDEN'});
  await assert.rejects(importer.workspace({...actor,orgId:randomUUID()},batch.id),{code:'NOT_FOUND'});
  await execute('CATEGORY',{name:'Servicios'});
  await assert.rejects(importer.applySetup(actor,batch.id,{commandId:randomUUID(),digest:workspace.setup.digest}),{code:'IMPORT_SETUP_CHANGED'});
  const refreshed=await importer.workspace(actor,batch.id);
  const request={commandId:randomUUID(),digest:refreshed.setup.digest};
  const [first,retry]=await Promise.all([importer.applySetup(actor,batch.id,request),importer.applySetup(actor,batch.id,request)]);
  assert.deepEqual(first,retry);
  assert.deepEqual([first.categories,first.centers,first.parties,first.budgets,first.paymentMethods],[1,2,0,1,2]);
  assert.deepEqual((await importer.options(actor)).paymentMethods,['Efectivo','Transferencia bancaria']);
  assert.equal((await importer.workspace(actor,batch.id)).configured,true);
  assert.equal((await importer.workspace(actor,batch.id)).setup.parties.length,0);
  const budgets=await store.all('SELECT amount_pyg FROM procurement_budgets WHERE org_id=? ORDER BY amount_pyg',orgId);
  assert.deepEqual(budgets.map(row=>Number(row.amount_pyg)),[0,90_000]);
  for (const table of ['documents','settlements','movements']) {
    const row=await store.one(`SELECT COUNT(*) AS count FROM procurement_${table} WHERE org_id=?`,orgId);
    assert.equal(Number(row?.count),0);
  }
  const revise=XLSX.read(bytes,{type:'buffer'});
  const parameters=revise.Sheets['Parámetros'];
  parameters.A1={t:'s',v:'Presupuesto anual de control'};
  parameters.B7={t:'n',v:825_000};
  parameters.A10={t:'s',v:'Viajes'};
  parameters.B10={t:'s',v:'725.000'};
  parameters['!ref']='A1:E10';
  const updated=Buffer.from(XLSX.write(revise,{type:'buffer',bookType:'xlsx'}));
  const upload=(file:Buffer)=>importer.upload(actor,{filename:'Planilla sintética.xlsx',contentBase64:file.toString('base64')});
  const next=await upload(updated);
  assert.equal(next.status,'IMPORTED');
  assert.equal((await importer.active(actor)).batch?.id,next.id);
  const latest=await importer.workspace(actor,next.id);
  assert.equal(latest.budgets.find(row=>row.category==='Insumos')?.budgetPyg,825_000);
  assert.equal(latest.budgets.find(row=>row.category==='Viajes')?.budgetPyg,725_000);
  assert.equal(latest.source.definedBudgets,3);
  const duplicate=await upload(bytes);
  assert.equal(duplicate.status,'UNCHANGED');
  assert.equal(duplicate.activeId,next.id);
  delete parameters.B6;delete parameters.B7;delete parameters.B10;
  revise.Sheets.Registro.E6.v='Proveedor de versión en revisión';
  revise.Sheets.Registro.F6.v='80056789-0';
  const blank=await upload(Buffer.from(XLSX.write(revise,{type:'buffer',bookType:'xlsx'})));
  assert.equal(blank.status,'REVIEW_REQUIRED');
  assert.equal(blank.activeId,next.id);
  assert.equal((await importer.workspace(actor,blank.id)).source.definedBudgets,0);
  const pendingSupplier=()=>store.one('SELECT id FROM procurement_parties WHERE org_id=? AND ruc=?',orgId,'80056789-0');
  assert.equal(await pendingSupplier(),undefined);
  await assert.rejects(importer.activate({...actor,orgId:randomUUID()},blank.id,{commandId:randomUUID()}),{code:'NOT_FOUND'});
  const activation={commandId:randomUUID()};
  assert.deepEqual(await importer.activate(actor,blank.id,activation),await importer.activate(actor,blank.id,activation));
  assert.equal((await importer.active(actor)).batch?.id,blank.id);
  assert.ok(await pendingSupplier());
  assert.deepEqual((await store.all('SELECT amount_pyg FROM procurement_budgets WHERE org_id=? ORDER BY amount_pyg',orgId)).map(r=>Number(r.amount_pyg)),[0,90_000]);
  if(store.kind==='sqlite') {
    const legacy={...batch.summary};delete legacy.controls;
    await store.run('UPDATE procurement_import_batches SET summary_json=? WHERE org_id=? AND id=?',JSON.stringify(legacy),orgId,batch.id);
    assert.deepEqual((await importer.workspace(actor,batch.id)).controls,workspace.controls);
  }
}


async function verifyBatchPayments(store:Database) {
  const orgId=randomUUID(),id=randomUUID();
  const actor:Actor={orgId,id,role:'ADMIN',name:'QA pagos',driverId:null};
  await store.run('INSERT INTO organizations(id,name,timezone) VALUES(?,?,?)',orgId,'QA pagos en lote','America/Asuncion');
  await store.run("INSERT INTO users(id,org_id,username,name,password_hash,role) VALUES(?,?,?,?,?,'ADMIN')",id,orgId,'qa-pagos-'+id,actor.name,'unused');
  const procurement=new Procurement(store),importer=new ProcurementImport(store,procurement),reads=new ProcurementReads(store);
  const execute=(action:string,fields:object)=>procurement.execute(actor,{action,commandId:randomUUID(),...fields});
  const party=await execute('PARTY',{name:'Proveedor QA de pagos',ruc:'80012225-0',kind:'SUPPLIER',active:true});
  const account=await execute('ACCOUNT',{name:'Banco QA de pagos',kind:'BANK'});
  const invoice=async(reference:string)=>execute('DOCUMENT',{
    partyId:party.id,nature:'EXPENSE',condition:'CREDIT',documentDate:'2026-11-17',dueDate:'2026-12-01',reference,
    lines:[{description:'Compra QA',totalPyg:100_000,vatRate:0,vatPyg:0,netPyg:100_000}],
  });
  const first=await invoice('A'),second=await invoice('B');
  const rows=[
    ['A','Pago-1',25_000],['A','Pago-2',15_000],['B','Pago-3',60_000],['B','Pago-4',60_000],
    ['X','Pago-5',15_000],['A','Pago-6',15_000],['X','Pago-6',15_000],['A','Pago-7',20_000,'Cuenta desconocida'],
  ] as const;
  function file(suffix:string) {
    const book=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([
      ['RUC','N.º de factura','Referencia del pago','Fecha de pago','Importe (Gs.)','Cuenta de origen','Medio de pago','Concepto / descripción'],
      ...rows.map(([doc,ref,amount,bank])=>['80012225-0',doc,ref,'2026-11-19',amount,bank??'Banco QA de pagos','Transferencia',suffix]),
    ]),'Pagos');
    return {filename:'Pagos QA.xlsx',mode:'append',contentBase64:XLSX.write(book,{type:'buffer',bookType:'xlsx'}).toString('base64')};
  }
  const original=file('Prueba inicial');
  const result=await importer.upload(actor,original);
  assert.deepEqual(result.payments,{total:8,registered:2,pending:6});
  const review=result.rows.filter(row=>row.state==='PENDING').map(row=>row.issues.find((issue:{code:string})=>issue.code.endsWith('_REVIEW'))?.message);
  assert.match(review[0],/juntos el saldo/);
  assert.match(review[2],/no coincide con una factura/);
  assert.match(review[3],/Transferencia por revisar.*no coincide con una factura/);
  assert.match(review[5],/cuenta de origen/);
  assert.equal((await reads.detail(actor,'documents',first.id)).balancePyg,60_000);
  assert.equal((await reads.detail(actor,'documents',second.id)).balancePyg,100_000);
  assert.equal((await reads.detail(actor,'parties',party.id)).balancePyg,160_000);
  assert.equal((await new ProcurementRegister(store).list(actor,{view:'expenses'})).totals.totalPyg,200_000);
  assert.equal((await importer.upload(actor,original)).status,'UNCHANGED');
  const edited=await importer.upload(actor,file('Cambió una columna del archivo'));
  assert.equal(edited.payments.registered,0);
  assert.match(edited.rows[0].issues.find((issue:{code:string})=>issue.code==='PAYMENT_REVIEW').message,/referencia del pago ya está registrada/);
  const posted=await reads.list(actor,'settlements',{partyId:party.id});
  assert.equal(posted.items.reduce((sum,row)=>sum+row.appliedPyg,0),40_000);
  assert.equal(posted.items.length,2);
  assert.equal((await reads.list(actor,'movements',{accountId:account.id})).items.length,2);

  const groupBook=XLSX.utils.book_new();
  const grouped=[
    ['A','Grupo-1',25_000,60_000],['B','Grupo-1',35_000,60_000],
    ['A','Grupo-2',10_000,null],['A','Grupo-2',10_000,null],
    ['A','Grupo-3',12_000,12_000],['B','Grupo-3',12_000,12_000],
    ['A','Grupo-4',15_000,null],['B','Grupo-4',20_000,null],
  ] as const;
  XLSX.utils.book_append_sheet(groupBook,XLSX.utils.aoa_to_sheet([
    ['RUC','N.º de factura','Referencia del pago','Fecha de pago','Importe aplicado (Gs.)','Cuenta de origen','Medio de pago','Total de la transferencia (Gs.)'],
    ...grouped.map(([doc,ref,applied,total],index)=>['80012225-0',doc,ref,index===7?'2026-11-20':'2026-11-19',
      applied,'Banco QA de pagos','Transferencia',total]),
  ]),'Pagos');
  const groupImport={filename:'Transferencias QA.xlsx',mode:'append',contentBase64:XLSX.write(groupBook,{type:'buffer',bookType:'xlsx'}).toString('base64')};
  const groupResult=await importer.upload(actor,groupImport);
  assert.deepEqual(groupResult.payments,{total:8,registered:1,pending:6});
  const [firstRow,secondRow]=groupResult.rows;
  assert.equal(firstRow.state,'PROMOTED');
  assert.equal(secondRow.state,'PROMOTED');
  assert.equal(firstRow.outcome.operationId,secondRow.outcome.operationId);
  const reasons=groupResult.rows.slice(2).map(row=>row.issues.find((issue:{code:string})=>issue.code==='PAYMENT_GROUP_REVIEW')?.message);
  assert.match(reasons[0],/misma factura figura más de una vez/);
  assert.match(reasons[2],/total de la transferencia difiere/);
  assert.match(reasons[4],/distinto proveedor, cuenta, fecha o medio/);
  const transfer=await reads.detail(actor,'settlements',firstRow.outcome.operationId);
  assert.equal(transfer.amountPyg,60_000);
  assert.deepEqual(transfer.applications.map(row=>[row.documentId,row.amountPyg]).sort(),[[first.id,25_000],[second.id,35_000]].sort());
  const outflows=(await reads.list(actor,'movements',{accountId:account.id})).items.filter(row=>row.settlementId===transfer.id);
  assert.deepEqual(outflows.map(row=>row.amountPyg),[-60_000]);
  assert.equal((await reads.detail(actor,'parties',party.id)).balancePyg,100_000);
  assert.equal((await importer.upload(actor,groupImport)).status,'UNCHANGED');
  assert.equal((await reads.list(actor,'settlements',{partyId:party.id})).items.length,3);

  const target=result.rows[5],typo=result.rows[6];
  const reviewTransfer=await importer.transferReview(actor,result.id,target.id);
  assert.equal(reviewTransfer.reference,'Pago-6');
  assert.equal(reviewTransfer.partyId,party.id);
  assert.deepEqual(reviewTransfer.rows.map(row=>row.invoiceReference),['A','X']);
  await assert.rejects(importer.reprocessTransfer(actor,result.id,target.id,{commandId:randomUUID(),
    corrections:[{rowId:result.rows[4].id,documentId:second.id}]}),{code:'VALIDATION_ERROR'});
  const unchanged=await importer.reprocessTransfer(actor,result.id,target.id,{commandId:randomUUID(),corrections:[]});
  assert.equal(unchanged.status,'PENDING');
  assert.equal((await reads.list(actor,'settlements',{partyId:party.id})).items.length,3);

  const correction={commandId:randomUUID(),corrections:[{rowId:typo.id,documentId:second.id}]};
  const otherCommand={...correction,commandId:randomUUID()};
  const [applied,concurrent]=await Promise.all([
    importer.reprocessTransfer(actor,result.id,target.id,correction),
    importer.reprocessTransfer(actor,result.id,typo.id,otherCommand),
  ]);
  assert.deepEqual([applied.status,concurrent.status].sort(),['ALREADY_POSTED','POSTED']);
  assert.equal(applied.id,concurrent.id);
  const corrected=await importer.rowDetail(actor,result.id,typo.id);
  assert.equal(corrected.original.invoiceReference.value,'X');
  assert.equal(corrected.normalized.payment.invoiceReference,'B');
  assert.equal(corrected.outcome.operationId,applied.id);
  assert.deepEqual((await importer.original(actor,result.id)).bytes,Buffer.from(original.contentBase64,'base64'));
  const postedCorrection=await reads.detail(actor,'settlements',applied.id);
  assert.deepEqual(postedCorrection.applications.map(row=>[row.documentId,row.amountPyg]).sort(),
    [[first.id,15_000],[second.id,15_000]].sort());
  assert.equal((await reads.detail(actor,'parties',party.id)).balancePyg,70_000);
  assert.equal((await importer.rowDetail(actor,result.id,result.rows[4].id)).state,'PENDING');
  assert.deepEqual(await importer.reprocessTransfer(actor,result.id,target.id,correction),applied);
  assert.deepEqual(await importer.reprocessTransfer(actor,result.id,typo.id,{...correction,commandId:randomUUID()}),
    {id:applied.id,status:'ALREADY_POSTED'});
  const movements=(await reads.list(actor,'movements',{accountId:account.id})).items.filter(row=>row.settlementId===applied.id);
  assert.deepEqual(movements.map(row=>row.amountPyg),[-30_000]);
}

test('Lote privado, dos cargas simultáneas, resolución idempotente y control de versiones', async t => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  await verifyImport(store);
  await verifySourceSetup(store);
  await verifyBatchPayments(store);
});

const postgresUrl = process.env.DATABASE_LOCAL_TEST === 'true' && process.env.NODE_ENV === 'test' ? process.env.DATABASE_URL : undefined;
if (postgresUrl) {
  test('PostgreSQL local: importación concurrente, promociones y versiones', async t => {
    const url = new URL(postgresUrl);
    assert(['127.0.0.1', 'localhost'].includes(url.hostname) && /^\/nexora_test[a-z0-9_]*$/.test(url.pathname));
    const store = new PostgresStore(postgresUrl);
    t.after(() => store.close());
    await verifyImport(store);
    await verifySourceSetup(store);
    await verifyBatchPayments(store);
  });
}
