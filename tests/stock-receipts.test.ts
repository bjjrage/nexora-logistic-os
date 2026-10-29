import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import * as XLSX from 'xlsx';
import {Store} from '../server/db.ts';
import {setup,type Actor} from '../server/auth.ts';
import {Logistics} from '../server/domain.ts';
import {Inventory,type InventoryActor} from '../server/inventory.ts';
import {StockReceipts,readReceiptFile} from '../server/stock-receipts.ts';

async function fixture(t:any){
 const store=new Store(':memory:');t.after(()=>store.close());
 const {orgId,userId}=await setup(store,{organizationName:'Stock QA',timezone:'America/Asuncion',username:'stock-'+randomUUID(),password:'Password-Stock-QA-2026!'});
 const actor:InventoryActor={id:userId,orgId,name:'Stock QA',role:'ADMIN',driverId:null};
 const logistics=new Logistics(store),inventory=new Inventory(store),receipts=new StockReceipts(store);
 const clientId=(await logistics.createClient(actor as Actor,{commandId:randomUUID(),name:'Cliente de prueba'})).id;
 const otherClient=(await logistics.createClient(actor as Actor,{commandId:randomUUID(),name:'Otro cliente'})).id;
 const locationId=(await inventory.createLocation(actor,{commandId:randomUUID(),code:'DEP',name:'Depósito'})).id;
 const quarantine=(await inventory.createLocation(actor,{commandId:randomUUID(),code:'CUAR',name:'Cuarentena',kind:'QUARANTINE'})).id;
 const product=async(sku:string,tracking='QUANTITY',owner=clientId)=>(await inventory.createProduct(actor,{commandId:randomUUID(),clientId:owner,sku,name:'Producto '+sku,tracking,barcode:'BC-'+sku})).id;
 const a=await product('0001'),b=await product('0002'),serial=await product('SER','SERIAL');
 const row=(sku='0001',quantity='2',extra:Record<string,unknown>={})=>({row:2,sku,quantity,...extra});
 const input=(rows=[row()],extra:Record<string,unknown>={})=>({commandId:randomUUID(),clientId,locationId,reference:'REM-'+randomUUID(),rows,...extra});
 return {store,actor,inventory,receipts,clientId,otherClient,locationId,quarantine,a,b,serial,product,row,input};
}
const isCode=(code:string)=>(e:any)=>e?.code===code;

test('completar hoja descuenta recepciones previas una sola vez, conserva excedentes y repetir no agrega stock',async t=>{
 const f=await fixture(t),another=(await f.inventory.createLocation(f.actor,{commandId:randomUUID(),code:'OTRO-DEP',name:'Otro depósito'})).id;
 const receive=(productId:string,quantity:number,locationId=f.locationId)=>f.inventory.receive(f.actor,{commandId:randomUUID(),clientId:f.clientId,productId,quantity,locationId});
 await receive(f.a,5);await receive(f.a,1,another);await receive(f.b,30);
 const order=await f.inventory.createOrder(f.actor,{commandId:randomUUID(),clientId:f.clientId,externalId:'RES-COMPLETE',orderDate:'2026-10-29',destination:'Destino',recipientName:'QA',lines:[{productId:f.a,quantity:2}]});
 await f.inventory.reserveOrder(f.actor,order.id,{commandId:randomUUID()});
 const input=f.input([f.row('0001','4'),f.row('0002','10',{row:3}),f.row('BC-0001','6',{row:4})],{mode:'COMPLETE_SHEET'});
 const preview=await f.receipts.preview(f.actor,input);
 assert.equal(preview.valid,true);assert.equal(preview.unitCount,4);assert.equal(preview.productCount,1);
 assert.deepEqual(preview.rows.map(row=>row.incoming),[0,0,4]);assert.equal(preview.rows[0].alreadyReceived,6);assert.equal(preview.rows[0].current,3);assert.equal(preview.rows[0].after,7);
 const confirmed={...input,expectedPlanHash:preview.planHash};const result=await f.receipts.commit(f.actor,confirmed);
 assert.equal(result.unitCount,4);assert.deepEqual(await f.receipts.commit(f.actor,confirmed),result);
 assert.equal((await f.store.one("SELECT SUM(quantity) AS n FROM inventory_balances WHERE product_id=?",f.a))!.n,10);
 assert.equal((await f.store.one("SELECT SUM(quantity) AS n FROM inventory_balances WHERE product_id=?",f.b))!.n,30);
 const repeated={...input,commandId:randomUUID(),reference:'NEW-'+randomUUID()},again=await f.receipts.preview(f.actor,repeated);
 assert.equal(again.unitCount,0);assert.equal(again.valid,true);
 const unchanged=await f.receipts.commit(f.actor,{...repeated,expectedPlanHash:again.planHash});assert.equal(unchanged.status,'UNCHANGED');
 assert.equal((await f.receipts.history(f.actor,f.clientId)).items.length,1);
 assert.equal((await f.store.one("SELECT SUM(quantity) AS n FROM inventory_movements WHERE product_id=? AND action='RECEIVE'",f.a))!.n,10);
 // Leaving AVAILABLE stock does not turn the same initial receipt into a new receipt.
 await f.inventory.adjust(f.actor,{commandId:randomUUID(),clientId:f.clientId,productId:f.b,locationId:f.locationId,quantityDelta:-30,reason:'QA stock ya no disponible'});
 assert.equal((await f.receipts.preview(f.actor,repeated)).unitCount,0);
});

test('completar hoja exige validar de nuevo si otra recepción cambia los faltantes',async t=>{
 const f=await fixture(t);
 const receive=(quantity:number)=>f.inventory.receive(f.actor,{commandId:randomUUID(),clientId:f.clientId,productId:f.a,locationId:f.locationId,quantity});
 await receive(5);const input=f.input([f.row('0001','10')],{mode:'COMPLETE_SHEET'}),preview=await f.receipts.preview(f.actor,input);
 assert.equal(preview.unitCount,5);
 await assert.rejects(f.receipts.commit(f.actor,input),isCode('RECEIPT_CHANGED'));
 await receive(3);
 await assert.rejects(f.receipts.commit(f.actor,{...input,expectedPlanHash:preview.planHash}),isCode('RECEIPT_CHANGED'));
 assert.equal((await f.store.one('SELECT COUNT(*) AS n FROM inventory_receipt_batches'))!.n,0);
 const current=await f.receipts.preview(f.actor,input);assert.equal(current.unitCount,2);
 await f.receipts.commit(f.actor,{...input,expectedPlanHash:current.planHash});
 assert.equal((await f.store.one('SELECT SUM(quantity) AS n FROM inventory_balances'))!.n,10);
});

test('completar hoja no usa recepciones de otro cliente ni infiere números de serie',async t=>{
 const f=await fixture(t),other=await f.product('0001','QUANTITY',f.otherClient);
 await f.inventory.receive(f.actor,{commandId:randomUUID(),clientId:f.otherClient,productId:other,locationId:f.locationId,quantity:50});
 const report=await f.receipts.preview(f.actor,f.input([f.row('0001','10')],{mode:'COMPLETE_SHEET'}));
 assert.equal(report.unitCount,10);assert.equal(report.rows[0].alreadyReceived,0);
 const serial=await f.receipts.preview(f.actor,f.input([f.row('SER','1',{serial:'NEW-SERIES'})],{mode:'COMPLETE_SHEET'}));
 assert.equal(serial.valid,false);assert.ok(serial.rowErrors.some(row=>row.message.includes('productos por cantidad')));
});

test('completar un objetivo mayor puede recibir la misma diferencia de un lote anterior sin duplicar el total objetivo',async t=>{
 const f=await fixture(t);await f.receipts.commit(f.actor,f.input([f.row('0001','5')]));
 const input=f.input([f.row('0001','10')],{mode:'COMPLETE_SHEET'}),preview=await f.receipts.preview(f.actor,input);
 assert.equal(preview.unitCount,5);assert.equal(preview.repeatedContent,false);
 await f.receipts.commit(f.actor,{...input,expectedPlanHash:preview.planHash});
 assert.equal((await f.receipts.preview(f.actor,input)).unitCount,0);
 assert.equal((await f.store.one('SELECT SUM(quantity) AS n FROM inventory_balances'))!.n,10);
});

test('recepciones: Excel elige Stock sugerido, conserva códigos y permite elegir otra hoja; CSV pegado y fórmulas',()=>{
 const book=XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['SKU','Nombre'],['0001','Catálogo']]),'Catalogo');
 const stock=XLSX.utils.aoa_to_sheet([['SKU','Producto','Demanda del lote','Recepción sugerida'],[1,'Producto',2,7]]);
 stock.A2={t:'n',v:1,z:'0000'};XLSX.utils.book_append_sheet(book,stock,'Stock sugerido');
 XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['SKU','Cantidad'],['0002',10]]),'Otro stock');
 const input={filename:'stock.xlsx',contentBase64:XLSX.write(book,{type:'buffer',bookType:'xlsx'}).toString('base64')};
 const parsed=readReceiptFile(input);assert.equal(parsed.sheet,'Stock sugerido');assert.equal(parsed.rows[0].sku,'0001');assert.equal(parsed.rows[0].quantity,'7');assert.equal(parsed.sheets.length,2);
 assert.equal(readReceiptFile({...input,sheet:'Otro stock'}).rows[0].sku,'0002');
 assert.equal(readReceiptFile({csv:'\uFEFFSKU\tCantidad\n0001\t250\n'}).rows[0].quantity,'250');
 assert.equal(readReceiptFile({csv:'Código;Existencias\r\n"0001";20'}).rows[0].sku,'0001');
 stock.D2={t:'n',v:7,f:'2+5'};
 assert.throws(()=>readReceiptFile({...input,contentBase64:XLSX.write(book,{type:'buffer',bookType:'xlsx'}).toString('base64')}),/fórmulas/);
 assert.throws(()=>readReceiptFile({csv:'SKU,Cantidad\n0001,"2'}),/comilla/);
 assert.throws(()=>readReceiptFile({csv:'SKU,Cantidad,Cantidad\n0001,2,2'}),/más de una columna/);
 assert.throws(()=>readReceiptFile({filename:'stock.xlsx',contentBase64:Buffer.from('not zip').toString('base64')}),/Excel/);
});

test('recepciones: un lote mezcla cantidades y series, suma sin alterar reservas; reintento único e historial',async t=>{
 const f=await fixture(t);
 await f.inventory.receive(f.actor,{commandId:randomUUID(),clientId:f.clientId,locationId:f.locationId,productId:f.a,quantity:10});
 const order=await f.inventory.createOrder(f.actor,{commandId:randomUUID(),clientId:f.clientId,externalId:'RESERVA',orderDate:'2026-10-29',destination:'Destino',recipientName:'Receptor',lines:[{productId:f.a,quantity:2}]});
 await f.inventory.reserveOrder(f.actor,order.id,{commandId:randomUUID()});
 const input=f.input([f.row('0001','250'),f.row('BC-0001','50',{row:3}),f.row('0002','3',{row:4,locationCode:'DEP'}),f.row('SER','1',{row:5,serial:'SERIE-001',barcode:'UNIT-001'}),f.row('SER','1',{row:6,serial:'SERIE-002'})]);
 const preview=await f.receipts.preview(f.actor,input);assert.equal(preview.valid,true,JSON.stringify(preview.rowErrors));assert.equal(preview.rows[0].current,8);assert.equal(preview.rows[0].after,308);assert.equal(preview.unitCount,305);
 assert.equal((await f.store.one('SELECT COUNT(*) AS n FROM inventory_receipt_batches'))!.n,0);
 const first=await f.receipts.commit({...f.actor,role:'DEPOT'},input);
 assert.equal(first.productCount,3);assert.equal(first.unitCount,305);
 assert.deepEqual(await f.receipts.commit({...f.actor,role:'DEPOT'},input),first);
 assert.equal((await f.store.one("SELECT quantity FROM inventory_balances WHERE product_id=? AND status='AVAILABLE'",f.a))!.quantity,308);
 assert.equal((await f.store.one("SELECT quantity FROM inventory_balances WHERE product_id=? AND status='RESERVED'",f.a))!.quantity,2);
 assert.equal((await f.store.one("SELECT COUNT(*) AS n FROM inventory_movements WHERE action='RECEIVE' AND command_id=?",input.commandId))!.n,4);
 const history=await f.receipts.history(f.actor,f.clientId);assert.equal(history.items.length,1);assert.equal(history.items[0].unit_count,305);
 await assert.rejects(f.receipts.commit({...f.actor,role:'DEPOT'},{...input,reason:'Cambio'}),isCode('DUPLICATE_COMMAND'));
 await assert.rejects(f.receipts.commit(f.actor,{...input,commandId:randomUUID()}),/lote contiene errores/);
 assert.equal((await f.store.one('SELECT COUNT(*) AS n FROM inventory_units'))!.n,2);
});

test('recepciones: detecta contenido repetido aunque se reordenen o agrupen filas y exige nueva referencia explícita',async t=>{
 const f=await fixture(t);const first=f.input([f.row('0001','3'),f.row('0002','4',{row:3})]);await f.receipts.commit(f.actor,first);
 const again=f.input([f.row('0002','4'),f.row('0001','1',{row:3}),f.row('0001','2',{row:4})]);
 const preview=await f.receipts.preview(f.actor,again);assert.equal(preview.valid,true);assert.equal(preview.repeatedContent,true);
 await assert.rejects(f.receipts.commit(f.actor,again),/lote contiene errores/);
 assert.equal((await f.store.one('SELECT SUM(quantity) AS n FROM inventory_balances'))!.n,7);
 // A rejected command cannot silently turn into an accepted command on retry.
 await assert.rejects(f.receipts.commit(f.actor,{...again,allowRepeatedContent:true}),isCode('DUPLICATE_COMMAND'));
 await f.receipts.commit(f.actor,{...again,commandId:randomUUID(),allowRepeatedContent:true});
 assert.equal((await f.store.one('SELECT SUM(quantity) AS n FROM inventory_balances'))!.n,14);
 await assert.rejects(f.receipts.commit(f.actor,{...first,commandId:randomUUID(),reference:first.reference.toLowerCase(),allowRepeatedContent:true}),/lote contiene errores/);
});

test('recepciones: errores de SKU, ubicación, cantidad y series rechazan todo y registran el intento',async t=>{
 const f=await fixture(t);const input=f.input([f.row('0001','5'),f.row('NO-EXISTE','3',{row:3}),f.row('SER','2',{row:4,serial:'S1'}),f.row('SER','1',{row:5,serial:'S1'}),f.row('0002','-1',{row:6,locationCode:'CUAR'})]);
 const report=await f.receipts.preview(f.actor,input);assert.equal(report.valid,false);assert.ok(report.rowErrors.length>=4);
 await assert.rejects(f.receipts.commit(f.actor,input),/No se recibió ninguna unidad/);
 assert.equal((await f.store.one('SELECT COUNT(*) AS n FROM inventory_balances'))!.n,0);
 assert.equal((await f.store.one('SELECT COUNT(*) AS n FROM inventory_movements'))!.n,0);
 assert.equal((await f.receipts.history(f.actor)).items[0].status,'REJECTED');
 await f.store.run('UPDATE inventory_products SET active=0 WHERE id=?',f.a);
 assert.equal((await f.receipts.preview(f.actor,f.input())).valid,false);
});

test('recepciones: rollback si falla una escritura a mitad del lote o el historial',async t=>{
 const f=await fixture(t);const original=f.store.run.bind(f.store);
 for(const failOn of ['movement','history']){
  let writes=0;f.store.run=async(sql,...args)=>{if((failOn==='movement'&&sql.startsWith('INSERT INTO inventory_movements')&&++writes===2)||(failOn==='history'&&sql.startsWith('INSERT INTO inventory_receipt_batches')))throw new Error('Fallo inyectado');return original(sql,...args);};
  await assert.rejects(f.receipts.commit(f.actor,f.input([f.row('0001','5'),f.row('0002','3',{row:3})])),/Fallo inyectado/);
  f.store.run=original;
  assert.equal((await f.store.one('SELECT COUNT(*) AS n FROM inventory_balances'))!.n,0);
  assert.equal((await f.store.one('SELECT COUNT(*) AS n FROM inventory_movements'))!.n,0);
  assert.equal((await f.store.one('SELECT COUNT(*) AS n FROM inventory_receipt_batches'))!.n,0);
 }
});

test('recepciones: aislamiento de cliente y empresa, permisos y límite de unidades',async t=>{
 const f=await fixture(t);
 await f.product('OTRO','QUANTITY',f.otherClient);
 assert.equal((await f.receipts.preview(f.actor,f.input([f.row('OTRO')]))).valid,false);
 for(const role of ['CUSTOMER','DRIVER']){
  await assert.rejects(f.receipts.preview({...f.actor,role},f.input()),isCode('FORBIDDEN'));
  await assert.rejects(f.receipts.history({...f.actor,role}),isCode('FORBIDDEN'));
  assert.throws(()=>f.receipts.read({...f.actor,role},{csv:'SKU,Cantidad\n0001,1'}),isCode('FORBIDDEN'));
 }
 await assert.rejects(f.receipts.preview({...f.actor,orgId:randomUUID()},f.input()),isCode('NOT_FOUND'));
 await assert.rejects(f.receipts.history(f.actor,randomUUID()),isCode('NOT_FOUND'));
 assert.equal((await f.receipts.preview(f.actor,f.input([f.row('0001','100001')]))).valid,false);
 assert.equal((await f.receipts.preview(f.actor,f.input([f.row('0001','60000'),f.row('0002','60000',{row:3})]))).valid,false);
});

test('recepciones: dos confirmaciones concurrentes no duplican una referencia; series existentes bloqueadas',async t=>{
 const f=await fixture(t);const input=f.input();
 const result=await Promise.allSettled([f.receipts.commit(f.actor,input),f.receipts.commit(f.actor,{...input,commandId:randomUUID()})]);
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await f.store.one('SELECT SUM(quantity) AS n FROM inventory_balances'))!.n,2);
 const serialized=f.input([f.row('SER','1',{serial:'SERIE-01',barcode:'UNIT-01'})]);await f.receipts.commit(f.actor,serialized);
 const duplicate=await f.receipts.preview(f.actor,f.input([f.row('SER','1',{serial:'serie-01',barcode:'UNIT-01'})]));
 assert.equal(duplicate.valid,false);assert.ok(duplicate.rowErrors.some(e=>e.field==='serial'));assert.ok(duplicate.rowErrors.some(e=>e.field==='barcode'));
 await assert.rejects(f.store.run('DELETE FROM inventory_receipt_batches'),/APPEND_ONLY/);
});

test('recepciones: revalida al confirmar y soporta mil SKUs en un lote',async t=>{
 const f=await fixture(t);const input=f.input();assert.equal((await f.receipts.preview(f.actor,input)).valid,true);
 await f.store.run('UPDATE inventory_locations SET active=0 WHERE id=?',f.locationId);
 await assert.rejects(f.receipts.commit(f.actor,input),/No se recibió ninguna unidad/);
 await f.store.run('UPDATE inventory_locations SET active=1 WHERE id=?',f.locationId);
 const rows=[];for(let i=0;i<1000;i++){const sku='MASS-'+i;await f.product(sku);rows.push(f.row(sku,'1',{row:i+2}));}
 const bulk=f.input(rows);const result=await f.receipts.commit(f.actor,bulk);
 assert.equal(result.productCount,1000);assert.equal(result.unitCount,1000);
 assert.equal((await f.store.one('SELECT COUNT(*) AS n FROM inventory_movements WHERE command_id=?',bulk.commandId))!.n,1000);
});
