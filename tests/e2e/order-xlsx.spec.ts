import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import * as XLSX from 'xlsx';

test('importa Excel de reparto completo después de validar, sin crear pedidos antes',async({page})=>{
 const post=async(path:string,data:Record<string,unknown>)=>{const response=await page.request.post(path,{headers:{'X-Requested-With':'logistics-os'},data:{commandId:randomUUID(),...data}});expect(response.ok(),`${path}: ${await response.text()}`).toBeTruthy();return response.json();};
 const session=await(await page.request.get('/api/session')).json();
 if(session.setupRequired)await post('/api/setup',{organizationName:'QA aislada',timezone:'America/Asuncion',username:'qa-browser',password:'QA-Browser-Isolated-2026!'});
 else await post('/api/login',{username:'qa-browser',password:'QA-Browser-Isolated-2026!'});
 let buffer:Buffer;
 if(process.env.ORDER_XLSX_E2E_PATH)buffer=readFileSync(process.env.ORDER_XLSX_E2E_PATH);
 else{
  const book=XLSX.utils.book_new(),rows:unknown[][]=[['PEDIDO DE REPARTO'],['20 paradas'],[],['Parada','Pedido','Fecha','Dirección','Destinatario','SKU','Descripción','Cantidad']];
  for(let i=0;i<20;i++)rows.push([i+1,'QA-PED-'+i,'28/10/2026','Calle QA, Lambaré','Receptor QA','SKU-QA-'+i%10,'Artículo QA',i<4?2:1]);
  rows.push(['','','','','','','TOTAL UNIDADES',24],['','','','','','','TOTAL PARADAS',20]);
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'Pedido de Reparto');XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['SKU','Descripción'],...Array.from({length:10},(_,i)=>['SKU-QA-'+i,'Artículo QA'])]),'Catálogo');
  buffer=XLSX.write(book,{type:'buffer',bookType:'xlsx'});
 }
 const book=XLSX.read(buffer,{type:'buffer'}),catalog=XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[book.SheetNames[1]],{header:1,defval:''}).slice(1).filter(row=>row[0]&&row[1]);
 const name='Excel QA '+randomUUID().slice(0,8),client=(await post('/api/clients',{name})).id;
 await page.goto('/');await page.getByRole('button',{name:'Clientes',exact:true}).click();
 await page.getByRole('row').filter({hasText:name}).getByRole('button',{name:'Abrir ficha'}).click();
 await page.getByRole('button',{name:'Importar catálogo',exact:true}).click();
 const catalogCsv=XLSX.utils.sheet_to_csv(book.Sheets[book.SheetNames[1]]);
 await page.getByLabel('Archivo CSV o Excel (.xlsx)').setInputFiles({name:'catalogo.csv',mimeType:'text/csv',buffer:Buffer.from(catalogCsv)});
 await page.getByRole('button',{name:'Validar archivo',exact:true}).click();
 await expect(page.getByText('No se guardó ningún producto.')).toBeVisible();
 await expect(page.getByText('Sin indicar').first()).toBeVisible();await expect(page.getByRole('cell',{name:'Revisar'}).first()).toBeVisible();
 await page.getByLabel('Seguimiento para filas nuevas sin tipo').selectOption('QUANTITY');
 await page.getByRole('button',{name:'Validar archivo',exact:true}).click();await expect(page.getByRole('heading',{name:'Vista previa validada'})).toBeVisible();
 await page.getByRole('button',{name:'Confirmar importación',exact:true}).click();await expect(page.getByText('Catálogo actualizado desde el archivo.')).toBeVisible();
 const saved=await(await page.request.get('/api/inventory/products?clientId='+client)).json();expect(saved.items).toHaveLength(catalog.length);
 await page.getByRole('button',{name:'Pedidos',exact:true}).click();await page.getByRole('button',{name:'Importar pedido',exact:true}).first().click();
 await page.getByRole('combobox',{name:'Cliente',exact:true}).selectOption(client);
 await page.getByLabel('Archivo Excel (.xlsx)').setInputFiles({name:'reparto.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer});
 await page.getByRole('button',{name:'Validar pedidos'}).click();await expect(page.getByText('20 pedido(s) de 20 aceptados.')).toBeVisible();
 const before=await(await page.request.get('/api/orders?clientId='+client)).json();expect(before.items.filter((o:{clientId:string})=>o.clientId===client)).toHaveLength(0);
 await page.getByRole('button',{name:'Importar validados'}).click();await expect(page.getByText('20 pedidos importados.')).toBeVisible();
 const after=await(await page.request.get('/api/orders?clientId='+client)).json();expect(after.items.filter((o:{clientId:string})=>o.clientId===client)).toHaveLength(20);
});
