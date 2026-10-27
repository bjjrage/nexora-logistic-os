import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {parseOrdersXlsx} from '../server/order-xlsx.ts';

function file(rows:unknown[][],second?:unknown[][]){const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'Pedidos');if(second)XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(second),'Catálogo');return {filename:'pedidos.xlsx',contentBase64:XLSX.write(book,{type:'buffer',bookType:'xlsx'}).toString('base64')};}
const head=['Parada','Pedido','Fecha','Dirección','Destinatario','SKU','Descripción','Cantidad'];
test('Lee encabezado bajo títulos, fechas, comas, hoja de catálogo y totales sin perder filas',()=>{
 const input=file([['PEDIDO DE REPARTO'],['20 paradas'],[],head,[1,'PED-01','28/10/2026','Calle A, Lambaré','Persona QA','SKU-1','Artículo',2],[2,'PED-02','2026-10-28','Calle B','Otra','SKU-2','Artículo',1],['','','','','','','TOTAL UNIDADES',3],['','','','','','','TOTAL PARADAS',2]],[['SKU','Descripción'],['SKU-1','Artículo']]);
 const result=parseOrdersXlsx(input);assert.deepEqual(result.rowNumbers,[5,6]);assert.equal(result.csv.split('\n').length,3);assert.match(result.csv,/"2026-10-28"/);assert.match(result.csv,/"Calle A, Lambaré"/);
});
test('Rechaza fórmulas, identificadores numéricos inseguros y hojas ambiguas',()=>{
 const book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([head,[1,'PED','28/10/2026','A','B','SKU','C',1]]);sheet.H2={t:'n',v:1,f:'1+0'};XLSX.utils.book_append_sheet(book,sheet,'Pedidos');
 assert.throws(()=>parseOrdersXlsx({filename:'a.xlsx',contentBase64:XLSX.write(book,{type:'buffer',bookType:'xlsx'}).toString('base64')}),/fórmulas/);
 const unsafe=file([head,[1,1234567890123456,'28/10/2026','A','B','SKU','C',1]]);assert.throws(()=>parseOrdersXlsx(unsafe),/como texto/);
 assert.throws(()=>parseOrdersXlsx(file([head,[1,'P','28/10/2026','A','B','SKU','C',1]],[head,[1,'P','28/10/2026','A','B','SKU','C',1]])),/más de una hoja/);
});
