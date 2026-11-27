import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { once } from 'node:events';
import { test, expect } from '@playwright/test';
import * as XLSX from 'xlsx';
import { createApp } from '../../server/app.ts';
import { passwordHash } from '../../server/auth.ts';
import type { Database } from '../../server/database.ts';
import { Store } from '../../server/db.ts';
import { PostgresStore } from '../../server/postgres.ts';

test('NX-PROV-01 en Chromium: compra, pago, saldo, comprobante e importación', async ({ page }, info) => {
  test.setTimeout(100_000);
  const databaseUrl = process.env.NX_PROCUREMENT_E2E_POSTGRES === '1' ? new URL(process.env.DATABASE_URL ?? '') : undefined;
  if (databaseUrl && (databaseUrl.hostname !== '127.0.0.1' || databaseUrl.pathname !== '/nexora_test' || databaseUrl.username !== 'nexora_runtime')) {
    throw new Error('La prueba usa exclusivamente PostgreSQL aislado.');
  }
  const store: Database = databaseUrl ? new PostgresStore(databaseUrl.toString()) : new Store(':memory:');
  const orgId = randomUUID(), userId = randomUUID(), username = 'qa-compras-' + userId.slice(0, 8);
  const password = 'Compras-Sinteticas-QA-2026!';
  const supplier = 'Proveedor ficticio QA', account = 'Banco ficticio QA';
  const evidence = process.env.NX_PROCUREMENT_E2E_EVIDENCE;
  if (evidence) await mkdir(evidence, {recursive: true});
  const shot = async (name: string) => {
    const path = evidence ? evidence + '/' + name + '.png' : info.outputPath(name + '.png');
    await page.screenshot({path, fullPage:true});
    await info.attach(name, {path, contentType:'image/png'});
  };
  await store.run('INSERT INTO organizations(id,name,timezone) VALUES(?,?,?)', orgId, 'NEXORA · QA aislado', 'America/Asuncion');
  await store.run('INSERT INTO users(id,org_id,username,name,password_hash,role) VALUES(?,?,?,?,?,?)',
    userId, orgId, username, 'Administración QA', passwordHash(password), 'ADMIN');
  const server = createApp(store).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + (server.address() as {port:number}).port;
  const dialog = page.getByRole('dialog');
  const button = (name: string) => page.getByRole('button', {name, exact:true});
  const tab = (name: string) => page.getByRole('navigation', {name:'Proveedores y Gastos'}).getByRole('button', {name, exact:true});
  try {
    await page.goto(origin + '/?modulo=proveedores-gastos');
    await page.getByLabel('Usuario', {exact:true}).fill(username);
    await page.getByLabel('Contraseña', {exact:true}).fill(password);
    await button('Ingresar').click();
    await expect(page.getByRole('heading', {name:'Proveedores y Gastos'})).toBeVisible();
    await expect(page.getByText('Sin compras ni gastos.')).toBeVisible();
    await tab('Proveedores').click();
    await expect(page.getByText('Sin proveedores o beneficiarios.')).toBeVisible();
    await shot('01-vacio-escritorio');

    await button('Nuevo proveedor').click();
    await dialog.getByLabel('Nombre o razón social').fill(supplier);
    await dialog.getByRole('button', {name:'Guardar', exact:true}).click();
    await expect(page.getByRole('row').filter({hasText:supplier})).toBeVisible();
    await button('Configuración').click();
    await button('Nueva cuenta').click();
    await dialog.getByLabel('Nombre', {exact:true}).fill(account);
    await dialog.getByLabel('Tipo', {exact:true}).selectOption('BANK');
    await dialog.getByRole('button', {name:'Guardar', exact:true}).click();
    await expect(page.getByRole('row').filter({hasText:account})).toBeVisible();

    await tab('Compras y gastos').click();
    await button('Registrar y pagar').click();
    const help = dialog.getByRole('button',{name:'Ayuda: Importes e IVA',exact:true});
    await help.hover();
    await expect(dialog.getByRole('tooltip')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog.getByRole('tooltip')).not.toBeVisible();
    await expect(dialog).toBeVisible();
    await help.focus();
    await expect(dialog.getByRole('tooltip')).toBeVisible();
    await help.press('Escape');
    await expect(dialog.getByRole('tooltip')).not.toBeVisible();
    await dialog.getByLabel('Proveedor o beneficiario').selectOption({label:supplier});
    await dialog.getByLabel('Naturaleza').selectOption('PURCHASE');
    await dialog.getByLabel('Fecha del documento').fill('2026-11-26');
    await dialog.getByLabel('Condición', {exact:true}).selectOption('CREDIT');
    await dialog.getByLabel('Vencimiento').fill('2026-12-03');
    await dialog.getByLabel('Descripción', {exact:true}).fill('Insumos sintéticos QA');
    await dialog.getByLabel('Total con IVA (Gs.)', {exact:true}).fill('1000000');
    await dialog.getByLabel('Importe del pago (Gs.)').fill('400000');
    await dialog.getByLabel('Fecha del pago').fill('2026-11-27');
    await dialog.getByLabel('Cuenta de origen').selectOption({label:account});
    await dialog.getByLabel('Medio de pago').fill('Transferencia manual QA');
    await dialog.getByRole('button', {name:'Confirmar y pagar',exact:true}).click();
    const row = page.locator('.procurement-list').getByRole('row').filter({hasText:'Insumos sintéticos QA'});
    await expect(row).toContainText(/600[.\u00a0 ]?000/);
    await expect(row).toContainText(/400[.\u00a0 ]?000/);
    await shot('02-compra-y-pago-escritorio');

    await button('Adjuntar').click();
    await dialog.locator('input[type=file]').setInputFiles({
      name:'comprobante-sintetico.pdf', mimeType:'application/pdf',
      buffer:Buffer.from('%PDF-1.4\n% Comprobante sintético QA\n%%EOF\n'),
    });
    await dialog.getByRole('button', {name:'Adjuntar',exact:true}).click();
    await expect(page.getByRole('link', {name:'comprobante-sintetico.pdf'})).toBeVisible();
    const attachment = await page.getByRole('link', {name:'comprobante-sintetico.pdf'}).getAttribute('href');
    const downloaded = await page.request.get(origin + attachment);
    expect(downloaded.headers()['content-type']).toContain('application/pdf');
    expect(downloaded.headers()['content-disposition']).toContain('attachment');
    expect(await downloaded.text()).toContain('Comprobante sintético QA');

    await tab('Reportes y presupuesto').click();
    await expect(page.getByText(/1[.\u00a0 ]?000[.\u00a0 ]?000/).first()).toBeVisible();
    const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', {name:'Exportar CSV'}).click()]);
    expect(csv.suggestedFilename()).toMatch(/\.csv$/);
    await tab('Cuentas por pagar').click();
    await expect(row).toContainText(/600[.\u00a0 ]?000/);

    await tab('Pagos y anticipos').click();
    await button('Registrar anticipo').click();
    await dialog.getByLabel('Proveedor o beneficiario').selectOption({label:supplier});
    await dialog.getByLabel('Importe del pago (Gs.)').fill('300000');
    await dialog.getByLabel('Fecha del pago').fill('2026-11-27');
    await dialog.getByLabel('Cuenta de origen').selectOption({label:account});
    await dialog.getByLabel('Medio de pago').fill('Transferencia manual QA');
    await dialog.getByRole('button', {name:'Guardar',exact:true}).click();
    const apply = async (caption: string, amount: string) => {
      await button(caption).click();
      const select = dialog.getByLabel('Documento',{exact:true});
      await expect(select.locator('option').filter({hasText:'Insumos sintéticos QA'})).toHaveCount(1);
      const value = await select.locator('option').filter({hasText:'Insumos sintéticos QA'}).getAttribute('value');
      await select.selectOption(value!);
      await dialog.getByLabel('Importe aplicado (Gs.)').fill(amount);
      await dialog.getByRole('button', {name:'Aplicar',exact:true}).click();
      await expect(dialog).not.toBeVisible();
    };
    await apply('Aplicar anticipo','300000');
    await tab('Cuentas por pagar').click();
    await expect(row).toContainText(/300[.\u00a0 ]?000/);
    await tab('Pagos y anticipos').click();
    await button('Registrar nota de crédito').click();
    await dialog.getByLabel('Proveedor o beneficiario').selectOption({label:supplier});
    await dialog.getByLabel('Concepto',{exact:true}).fill('Crédito sintético QA');
    await dialog.getByLabel('Fecha de la nota de crédito').fill('2026-11-27');
    await dialog.getByLabel('Total con IVA (Gs.)',{exact:true}).fill('100000');
    await dialog.getByRole('button', {name:'Guardar',exact:true}).click();
    await apply('Aplicar nota de crédito','100000');
    await tab('Cuentas por pagar').click();
    await expect(row).toContainText(/200[.\u00a0 ]?000/);

    await button('Importar Excel').click();
    const headers = ['Fecha','Mes','N° comprobante','Tipo de comprobante','Proveedor','RUC proveedor','Concepto / descripción','Categoría','Centro de costo',
      'Medio de pago','Tasa IVA','Monto total (Gs.)','IVA incluido (Gs.)','Monto neto (Gs.)','Estado','Fecha de vencimiento','Días de atraso','Responsable','Observaciones'];
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      [], [], [], headers,
      ['2026-11-26',null,null,'Factura','Proveedor importado QA','80012345-1','Fila sintética','Depósito QA','Compras QA','Transferencia QA',0,150000,0,150000,'Pagado',null,null,null,'Caso sintético'],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Registro');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      [],[],['Año de control',2026,null,'Mes de análisis (1-12)',11],[],
      ['Categoría de gasto','Presupuesto mensual (Gs.)',null,'Centro de costo','Medio de pago'],
      ['Depósito QA',200_000,null,'Compras QA','Transferencia QA'],
      ['Servicios QA'],
    ]), 'Parámetros');
    XLSX.utils.book_append_sheet(workbook, {
      A46:{t:'s',v:'TOTAL GASTOS'},N46:{t:'n',v:150_000,f:'SUM(N6:N45)'},'!ref':'A1:N46',
    }, 'Resumen Mensual');
    XLSX.utils.book_append_sheet(workbook,{
      B3:{t:'n',v:46204,z:'yyyy-mm-dd'},A6:{t:'s',v:'Total gastos del período'},
      B6:{t:'n',v:150_000},B7:{t:'n',v:0},B8:{t:'n',v:150_000},B9:{t:'n',v:0},
      B10:{t:'n',v:1},B11:{t:'n',v:150_000},B12:{t:'n',v:46327,z:'mmmm yyyy'},B13:{t:'n',v:150_000},
      A68:{t:'s',v:'TOTAL'},J68:{t:'n',v:1_200_000},K68:{t:'n',v:1_050_000},L68:{t:'n',v:0.125},'!ref':'A1:L68',
    },'Resumen Jul-Dic 2026');
    await page.getByLabel('Archivo Excel').setInputFiles({
      name:'nx-proveedores-fixture-sintetico.xlsx', mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer:XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}),
    });
    await button('Importar versión').click();
    await expect(page.getByText('Resumen del archivo')).toBeVisible();
    await expect(page.getByText('Pagado según archivo',{exact:true})).toBeVisible();
    await expect(page.getByRole('heading',{name:'Conciliación del archivo'})).toBeVisible();
    await expect(page.getByRole('row').filter({hasText:'Resumen Mensual · N46'})).toContainText('Gs. 0');
    await tab('Pagos y anticipos').click();
    await button('Registrar pago').click();
    await expect(dialog.getByLabel('Proveedor o beneficiario').getByRole('option',{name:'Proveedor importado QA'})).toHaveCount(1);
    await dialog.getByRole('button',{name:'Cerrar',exact:true}).click();
    await button('Importar Excel').click();
    await button('Revisar y cargar maestros').click();
    await dialog.getByRole('button',{name:'Cargar configuración',exact:true}).click();
    await expect(page.getByText('Configuración cargada desde Excel.')).toBeVisible();
    await expect(page.getByText('Configuración cargada',{exact:true})).toBeVisible();
    await shot('05-conciliacion-excel');
    const history=page.getByRole('navigation',{name:'Vistas del histórico'});
    await history.getByRole('button',{name:'Por proveedor'}).click();
    await button('Ver filas de Proveedor importado QA').click();
    await expect(page.getByRole('heading',{name:'Registro · Proveedor importado QA'})).toBeVisible();
    await expect(history.getByRole('button',{name:'Por proveedor'})).toHaveAttribute('aria-pressed','true');
    await history.getByRole('button',{name:'Presupuesto vs. real'}).click();
    const budgetRow=page.getByRole('row').filter({hasText:'Depósito QA'}).filter({hasText:'2.200.000'});
    await expect(budgetRow).toContainText('Gs. 200.000');
    await expect(budgetRow).toContainText('Gs. 50.000');
    await expect(budgetRow).toContainText(/75,0\s?%/);
    await expect(budgetRow).toContainText('Gs. 2.050.000');
    await expect(budgetRow).toContainText(/6,8\s?%/);
    await expect(page.getByRole('row').filter({hasText:'Servicios QA'}).filter({hasText:'Sin definir'})).toHaveCount(1);
    await budgetRow.getByRole('button',{name:'Ver real acumulado de Depósito QA'}).click();
    await expect(page.getByRole('heading',{name:'Registro · Depósito QA · acumulado'})).toBeVisible();
    await button('Quitar filtro').click();
    await button('Revisar fila 5').click();
    await dialog.getByLabel('Resolución',{exact:true}).selectOption('DOCUMENT_PAYMENT');
    await expect(dialog.getByLabel('Proveedor o beneficiario').locator('option:checked')).toHaveText('Proveedor importado QA');
    await expect(dialog.getByLabel('Categoría').locator('option:checked')).toHaveText('Depósito QA');
    await expect(dialog.getByLabel('Centro de costo').locator('option:checked')).toHaveText('Compras QA');
    await expect(dialog.getByLabel('Medio de pago')).toHaveValue('Transferencia QA');
    await expect(dialog.getByLabel('Fecha del documento')).toHaveValue('');
    await dialog.getByLabel('Usar fecha original como').selectOption('document');
    await expect(dialog.getByLabel('Fecha del documento')).toHaveValue('2026-11-26');
    await expect(dialog.getByLabel('Fecha del pago')).toHaveValue('');
    await dialog.getByRole('button',{name:'Cerrar',exact:true}).click();

    await tab('Resumen').click();
    const kpis=page.getByRole('region',{name:'Indicadores de gastos'});
    await expect(kpis.getByRole('button',{name:/Gastos con IVA/})).toContainText('Gs. 1.150.000');
    await expect(kpis.getByRole('button',{name:/IVA incluido/})).toContainText('Gs. 0');
    await expect(kpis.getByRole('button',{name:/Neto sin IVA/})).toContainText('Gs. 1.150.000');
    await expect(page.getByRole('heading',{name:'Resumen de gastos'})).toBeVisible();
    const sourceRow=page.getByRole('row').filter({hasText:'Fila sintética'});
    await expect(sourceRow).toBeVisible();
    await shot('06-panel-de-gastos');
    await tab('Compras y gastos').click();
    await expect(sourceRow).toContainText('Importación');
    await expect(row).toContainText('Carga manual');
    await expect(button('Datos del Excel')).toHaveCount(0);
    await expect(button('Operaciones del OS')).toHaveCount(0);
    const unifiedExport=await page.request.get(origin+'/api/procurement/register.csv');
    expect(await unifiedExport.text()).toContain('Insumos sintéticos QA');
    expect(await unifiedExport.text()).toContain('Fila sintética');
    const workbookFilters=page.getByRole('form',{name:'Filtrar registros'});
    await workbookFilters.getByRole('button',{name:'Filtros'}).click();
    await workbookFilters.getByLabel('Proveedor',{exact:true}).selectOption({label:'Proveedor importado QA'});
    await workbookFilters.getByLabel('Estado',{exact:true}).selectOption({label:'Pagado'});
    await workbookFilters.getByLabel('Buscar').fill('sin coincidencia');
    await workbookFilters.getByRole('button',{name:'Consultar'}).click();
    await expect(page.getByText('Sin resultados para estos filtros.',{exact:true})).toBeVisible();
    await workbookFilters.getByLabel('Buscar').fill('fila sintetica');
    await workbookFilters.getByRole('button',{name:'Consultar'}).click();
    await expect(sourceRow).toBeVisible();
    await sourceRow.getByRole('button',{name:'Ver proveedor Proveedor importado QA'}).click();
    const accountDetail=page.getByRole('complementary',{name:'Cuenta corriente'});
    await expect(accountDetail.getByRole('heading',{name:'Proveedor importado QA'})).toBeVisible();
    await accountDetail.getByRole('button',{name:'Registrar pago',exact:true}).click();
    await expect(dialog.getByLabel('Proveedor o beneficiario').locator('option:checked')).toHaveText('Proveedor importado QA');
    await dialog.getByLabel('Importe del pago (Gs.)').fill('12345');
    await dialog.getByLabel('Cuenta de origen').selectOption({label:account});
    await dialog.getByLabel('Medio de pago').fill('Transferencia QA');
    await dialog.getByLabel('Referencia del pago').fill('Pago para proveedor de Excel QA');
    await dialog.getByRole('button',{name:'Guardar',exact:true}).click();
    await expect(accountDetail.getByText('Pago para proveedor de Excel QA',{exact:true})).toBeVisible();
    await tab('Compras y gastos').click();
    await expect(row).toContainText(/200[.\u00a0 ]?000/);
    await expect(sourceRow).toBeVisible();
    await tab('Reportes y presupuesto').click();
    await expect(kpis.getByRole('button',{name:/Gastos con IVA/})).toContainText('Gs. 1.150.000');
    await page.getByLabel('Reporte',{exact:true}).selectOption('monthly');
    const november=page.getByRole('row').filter({hasText:'2026-11'});
    await expect(november).toContainText('Gs. 1.150.000');
    await november.getByRole('button',{name:'Ver gastos'}).click();
    await expect(row).toBeVisible();
    await expect(sourceRow).toBeVisible();
    await page.getByLabel('Reporte',{exact:true}).selectOption('semester');
    await page.getByLabel('Año',{exact:true}).fill('2026');
    await button('Consultar').click();
    const semester=page.getByRole('region',{name:'Indicadores del semestre'});
    await expect(semester.getByRole('button',{name:/^Gastos con IVA/})).toContainText('Gs. 1.150.000');
    const comparison=page.locator('.procurement-semester-comparison');
    await expect(comparison.getByRole('cell',{name:'Coincide',exact:true})).toHaveCount(11);
    await expect(comparison.getByRole('row').filter({hasText:'Ejecución del presupuesto'})).toContainText('12,5');

    await button('Importar Excel').click();
    const firstBatchOption=await page.getByLabel('Destino de la carga').locator('option').filter({hasText:'Actualizar nx-proveedores-fixture-sintetico'}).getAttribute('value');
    const supplement=XLSX.utils.book_new();
    const supplementSheet=XLSX.utils.aoa_to_sheet([
      [],[],[],headers,
      ['2026-11-30',null,'QA-31','Factura','Proveedor importado QA','80012345-1','Movimiento adicional QA','Depósito QA','Compras QA',null,0,30_000,0,30_000,'Pagado'],
    ]);
    XLSX.utils.book_append_sheet(supplement,supplementSheet,'Registro');
    await page.getByLabel('Archivo Excel').setInputFiles({
      name:'movimientos-adicionales-qa.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer:XLSX.write(supplement,{type:'buffer',bookType:'xlsx'}),
    });
    await expect(page.getByLabel('Destino de la carga')).toHaveValue('');
    await button('Importar versión').click();
    await expect(page.getByText('Nueva versión importada y en uso.')).toBeVisible();
    await tab('Compras y gastos').click();
    const extra=page.getByRole('row').filter({hasText:'Movimiento adicional QA'});
    await expect(extra).toBeVisible();
    await expect(sourceRow).toBeVisible();
    await expect(row).toBeVisible();

    await button('Importar Excel').click();
    workbook.Sheets.Registro.G5={t:'s',v:'Movimiento corregido QA'};
    await page.getByLabel('Archivo Excel').setInputFiles({
      name:'correccion-qa.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer:XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}),
    });
    await page.getByLabel('Destino de la carga').selectOption(firstBatchOption!);
    await button('Importar versión').click();
    await expect(page.getByText('Nueva versión importada y en uso.')).toBeVisible();
    await tab('Compras y gastos').click();
    await expect(page.getByRole('row').filter({hasText:'Movimiento corregido QA'})).toBeVisible();
    await expect(extra).toBeVisible();
    await expect(row).toBeVisible();
    await expect(sourceRow).toHaveCount(0);

    await page.goto(origin+'/?modulo=proveedores-gastos&vista=presupuesto');
    const activeBudget=page.getByRole('row').filter({hasText:'Depósito QA'});
    await expect(activeBudget).toContainText('Gs. 200.000');
    await expect(activeBudget).toContainText('Gs. 180.000');
    await expect(activeBudget).toContainText('Gs. 20.000');
    await tab('Compras y gastos').click();
    await button('Ver movimiento Movimiento corregido QA').click();
    await dialog.getByLabel('Resolución',{exact:true}).selectOption('SKIP');
    await dialog.getByLabel('Motivo de resolución').fill('Fila deliberadamente sintética.');
    await dialog.getByRole('button',{name:'Confirmar omisión',exact:true}).click();
    await expect(page.getByText('Fila omitida.')).toBeVisible();
    await expect(page.getByRole('row').filter({hasText:'Movimiento corregido QA'})).toHaveCount(0);
    await expect(extra).toBeVisible();

    const paymentsWorkbook=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(paymentsWorkbook,XLSX.utils.aoa_to_sheet([
      [],[],[],headers,
      ['2026-11-30',null,'PAGO-IMPORT-QA','Recibo',supplier,null,'Pago importado QA',null,null,'Transferencia QA',0,75_000,0,75_000,'Pagado'],
    ]),'Registro');
    await button('Importar Excel').click();
    await page.getByLabel('Archivo Excel').setInputFiles({
      name:'pagos-importados-qa.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer:XLSX.write(paymentsWorkbook,{type:'buffer',bookType:'xlsx'}),
    });
    await button('Importar versión').click();
    await expect(page.getByText('Nueva versión importada y en uso.')).toBeVisible();
    await tab('Pagos y anticipos').click();
    await expect(page.getByRole('row').filter({hasText:'PAGO-IMPORT-QA'})).toHaveCount(0);
    await tab('Compras y gastos').click();
    await button('Ver movimiento Pago importado QA').click();
    await dialog.getByLabel('Resolución',{exact:true}).selectOption('PAYMENT');
    await dialog.getByLabel('Usar fecha original como').selectOption('payment');
    await dialog.getByLabel('Cuenta de origen').selectOption({label:account});
    await dialog.getByLabel('Referencia del pago').fill('PAGO-IMPORT-QA');
    const invoice=dialog.getByLabel('Documento',{exact:true});
    const invoiceOption=invoice.getByRole('option',{name:/Insumos sintéticos QA/});
    await expect(invoiceOption).toContainText('200.000');
    await invoice.selectOption((await invoiceOption.getAttribute('value'))!);
    await expect(dialog.getByLabel('Importe aplicado (Gs.)')).toHaveValue('75000');
    await dialog.getByLabel('Motivo de resolución').fill('Pago sintético verificado.');
    await dialog.getByRole('button',{name:'Confirmar operación',exact:true}).click();
    await expect(page.getByText('Operación registrada.')).toBeVisible();
    await expect(page.getByRole('row').filter({hasText:'Pago importado QA'})).toHaveCount(0);
    await tab('Pagos y anticipos').click();
    await expect(page.getByRole('row').filter({hasText:'PAGO-IMPORT-QA'})).toContainText('Gs. 75.000');
    await tab('Proveedores').click();
    await button('Abrir '+supplier).click();
    const supplierBalance=page.getByRole('complementary',{name:'Cuenta corriente'});
    await expect(supplierBalance.locator('dl').filter({hasText:'Saldo pendiente'})).toContainText('Gs. 125.000');

    await page.setViewportSize({width:390,height:844});
    const mobileNav = page.getByRole('navigation',{name:'Navegación móvil',exact:true});
    await mobileNav.getByRole('button',{name:'Inicio',exact:true}).click();
    await mobileNav.getByRole('button',{name:'Proveedores y Gastos',exact:true}).click();
    await tab('Cuentas por pagar').click();
    await expect(row).toContainText(/125[.\u00a0 ]?000/);
    const viewportFits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(viewportFits).toBeTruthy();
    await shot('03-cuentas-por-pagar-movil');

    await page.route('**/api/procurement/payables?*', async route => {
      if (!route.request().url().endsWith('offset=0')) return route.continue();
      await new Promise(resolve => setTimeout(resolve, 350));
      await route.fulfill({status:503, json:{error:{message:'Error simulado de consulta QA.'}}});
    });
    await button('Actualizar').click();
    await expect(page.getByText(/Cargando/).first()).toBeVisible();
    await expect(page.getByRole('alert').filter({hasText:'Error simulado de consulta QA.'})).toBeVisible();
    await shot('04-error-movil');
    await page.unroute('**/api/procurement/payables?*');
    await button('Reintentar').click();
    await expect(row).toContainText(/125[.\u00a0 ]?000/);
    await page.reload();
    await tab('Cuentas por pagar').click();
    await expect(row).toContainText(/125[.\u00a0 ]?000/);

    await page.setViewportSize({width:1366,height:900});
    await tab('Compras y gastos').click();
    for (const [reference,amount] of [['FACT-REPROCESO-1','150000'],['FACT-REPROCESO-2','100000']]) {
      await button('Registrar operación').click();
      await dialog.getByLabel('Proveedor o beneficiario').selectOption({label:supplier});
      await dialog.getByLabel('Naturaleza').selectOption('PURCHASE');
      await dialog.getByLabel('Fecha del documento').fill('2026-11-26');
      await dialog.getByLabel('Condición',{exact:true}).selectOption('CREDIT');
      await dialog.getByLabel('Vencimiento').fill('2026-12-03');
      await dialog.getByLabel('N.º de comprobante').fill(reference);
      await dialog.getByLabel('Descripción',{exact:true}).fill(reference);
      await dialog.getByLabel('Total con IVA (Gs.)',{exact:true}).fill(amount);
      await dialog.getByRole('button',{name:'Confirmar documento',exact:true}).click();
      await expect(dialog).not.toBeVisible();
    }
    const transfers=XLSX.utils.book_new(), transferRef='TRANSFERENCIA-REPROCESO-QA';
    XLSX.utils.book_append_sheet(transfers,XLSX.utils.aoa_to_sheet([
      ['Proveedor','N.º de factura','Referencia del pago','Fecha de pago','Importe aplicado (Gs.)','Cuenta de origen','Medio de pago','Total de la transferencia (Gs.)'],
      [supplier,'FACT-REPROCESO-1',transferRef,'2026-11-27',60_000,account,'Transferencia',100_000],
      [supplier,'NÚMERO INCORRECTO',transferRef,'2026-11-27',40_000,account,'Transferencia',100_000],
      [supplier,'OTRA FACTURA FALTANTE','OTRA-TRANSFERENCIA-QA','2026-11-27',20_000,account,'Transferencia',20_000],
    ]),'Pagos');
    await button('Importar Excel').click();
    await page.getByLabel('Archivo Excel').setInputFiles({
      name:'transferencia-reproceso-qa.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer:XLSX.write(transfers,{type:'buffer',bookType:'xlsx'}),
    });
    await button('Importar versión').click();
    const result=page.locator('[aria-label="Resultado de pagos"]');
    await expect(result).toContainText('Filas de pago por revisar');
    await expect(result.locator('div').filter({hasText:'Filas de pago por revisar'}).locator('dd')).toHaveText('3');
    await button('Revisar fila 3').click();
    await expect(dialog.getByText('NÚMERO INCORRECTO',{exact:true})).toBeVisible();
    await dialog.getByRole('button',{name:'Cambiar factura de fila 3'}).click();
    await dialog.getByLabel('Buscar factura').fill('FACT-REPROCESO-2');
    const correctedInvoice=dialog.getByLabel('Factura para fila 3');
    await correctedInvoice.selectOption((await correctedInvoice.getByRole('option',{name:/FACT-REPROCESO-2/}).getAttribute('value'))!);
    await dialog.getByRole('button',{name:'Reprocesar transferencia'}).click();
    await expect(page.getByText('Transferencia aplicada.',{exact:true})).toBeVisible();
    await expect(result.locator('div').filter({hasText:'Filas de pago por revisar'}).locator('dd')).toHaveText('1');
    await tab('Pagos y anticipos').click();
    const transferRow=page.getByRole('row').filter({hasText:transferRef});
    await expect(transferRow).toContainText('Gs. 100.000');
    await transferRow.getByRole('button',{name:'Abrir pago de '+supplier}).click();
    const transferDetail=page.getByRole('complementary',{name:'Pago, anticipo o crédito'});
    await expect(transferDetail.getByRole('row').filter({hasText:'FACT-REPROCESO-1'})).toContainText('Gs. 60.000');
    await expect(transferDetail.getByRole('row').filter({hasText:'FACT-REPROCESO-2'})).toContainText('Gs. 40.000');
    await expect(transferDetail.getByRole('row').filter({hasText:'Vigente'})).toHaveCount(2);
    await tab('Proveedores').click();
    await button('Abrir '+supplier).click();
    await expect(supplierBalance.locator('dl').filter({hasText:'Saldo pendiente'})).toContainText('Gs. 275.000');

    await tab('Pagos y anticipos').click();
    await transferRow.getByRole('button',{name:'Abrir pago de '+supplier}).click();
    await transferDetail.getByRole('button',{name:'Revertir pago',exact:true}).click();
    await dialog.getByLabel('Motivo').fill('Reverso de transferencia sintética');
    await dialog.getByLabel('Fecha del reverso').fill('2026-11-28');
    await dialog.getByRole('button',{name:'Confirmar',exact:true}).click();
    await expect(transferRow).toContainText('Revertido');
    await expect(transferDetail.getByRole('row').filter({hasText:'Deshecha'})).toHaveCount(2);
    const accountMovements=await page.request.get(origin+'/api/procurement/movements?limit=100');
    expect(accountMovements.ok()).toBeTruthy();
    const matched=(await accountMovements.json()).items.filter((item:{reference:string})=>item.reference===transferRef);
    expect(matched.map((item:{amountPyg:number})=>item.amountPyg).sort((a:number,b:number)=>a-b)).toEqual([-100_000,100_000]);
    await tab('Proveedores').click();
    await button('Abrir '+supplier).click();
    await expect(supplierBalance.locator('dl').filter({hasText:'Saldo pendiente'})).toContainText('Gs. 375.000');
  } finally {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
    await store.close();
  }
});
