import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PostgresStore} from '../server/postgres.ts';
import {passwordHash,type Actor} from '../server/auth.ts';
import {Logistics} from '../server/domain.ts';
import {Inventory} from '../server/inventory.ts';
import {CatalogImport} from '../server/catalog-import.ts';
import {StockReceipts} from '../server/stock-receipts.ts';

test('PostgreSQL: actual Stock sugerido file adds 249 units atomically, retry is unique and runtime cannot edit history',async()=>{
 const url=new URL(process.env.DATABASE_URL??'');
 assert.ok(['127.0.0.1','localhost'].includes(url.hostname)&&/^\/nexora_test/.test(url.pathname),'Only an isolated local PostgreSQL test database is allowed');
 const db=new PostgresStore(url.toString()),rollback=new Error('ROLLBACK_RECEIPTS_QA');
 try{
  await db.verify();
  await assert.rejects(db.transaction(async()=>{
   const orgId=randomUUID(),userId=randomUUID(),cmd=()=>({commandId:randomUUID()});
   await db.run('INSERT INTO organizations VALUES(?,?,?)',orgId,'QA receipt batch','America/Asuncion');
   await db.run('INSERT INTO users(id,org_id,username,name,password_hash,role,driver_id) VALUES(?,?,?,?,?,?,NULL)',userId,orgId,'qa-'+randomUUID(),'QA',passwordHash('QA-Receipt-2026!'),'ADMIN');
   const actor:Actor={id:userId,orgId,name:'QA',role:'ADMIN',driverId:null};
   const inventory=new Inventory(db),receipts=new StockReceipts(db),catalog=new CatalogImport(db);
   const clientId=(await new Logistics(db).createClient(actor,{...cmd(),name:'Bristol isolated QA'})).id;
   const locationId=(await inventory.createLocation(actor,{...cmd(),code:'C1',name:'QA depot',kind:'DEPOT'})).id;
   const source={filename:'bristol-catalog-stock-demo.xlsx',contentBase64:readFileSync(new URL('./fixtures/bristol-catalog-stock-demo.xlsx',import.meta.url)).toString('base64')};
   await catalog.import(actor,{...cmd(),...source,clientId});
   const parsed=receipts.read(actor,source);assert.equal(parsed.sheet,'Stock sugerido');assert.equal(parsed.rows.length,30);
   const charger=(await db.one("SELECT id FROM inventory_products WHERE org_id=? AND client_id=? AND sku='MOCK-NX-0015'",orgId,clientId))!.id;
   await inventory.receive(actor,{...cmd(),clientId,productId:charger,locationId,quantity:31});
   const input={...cmd(),clientId,locationId,reference:'RECEIPT-'+randomUUID(),source:'XLSX',filename:source.filename,rows:parsed.rows};
   const preview=await receipts.preview(actor,input);assert.equal(preview.valid,true);assert.equal(preview.unitCount,249);
   assert.equal(preview.rows.find(row=>row.sku==='MOCK-NX-0015')!.current,31);assert.equal(preview.rows.find(row=>row.sku==='MOCK-NX-0015')!.after,41);
   const result=await receipts.commit(actor,input);assert.equal(result.productCount,30);assert.equal(result.unitCount,249);
   assert.deepEqual(await receipts.commit(actor,input),result);
   assert.equal(Number((await db.one('SELECT SUM(quantity) AS n FROM inventory_balances WHERE org_id=?',orgId))!.n),280);
   assert.equal(Number((await db.one('SELECT COUNT(*) AS n FROM inventory_receipt_batches WHERE org_id=?',orgId))!.n),1);
   assert.equal((await receipts.history(actor,clientId)).items.length,1);
   const completeClient=(await new Logistics(db).createClient(actor,{...cmd(),name:'Bristol completar QA'})).id;
   await catalog.import(actor,{...cmd(),...source,clientId:completeClient});
   const completeProducts=await db.all('SELECT id,sku FROM inventory_products WHERE org_id=? AND client_id=?',orgId,completeClient);
   const already:Record<string,number>={'0003':5,'0011':7,'0012':2,'0015':31,'0018':1,'0021':5,'0026':5,'0028':1,'0029':1};
   for(const [sku,quantity] of Object.entries(already))await inventory.receive(actor,{...cmd(),clientId:completeClient,locationId,productId:completeProducts.find(p=>p.sku==='MOCK-NX-'+sku)!.id,quantity});
   const complete={...cmd(),clientId:completeClient,locationId,reference:'COMPLETE-'+randomUUID(),mode:'COMPLETE_SHEET',source:'XLSX',filename:source.filename,rows:parsed.rows};
   const missing=await receipts.preview(actor,complete);assert.equal(missing.unitCount,212);assert.equal(missing.productCount,29);
   assert.equal((await receipts.commit(actor,{...complete,expectedPlanHash:missing.planHash})).unitCount,212);
   const again={...complete,...cmd(),reference:'AGAIN-'+randomUUID()},covered=await receipts.preview(actor,again);
   assert.equal(covered.unitCount,0);assert.equal((await receipts.commit(actor,{...again,expectedPlanHash:covered.planHash})).status,'UNCHANGED');
   assert.equal(Number((await db.one('SELECT SUM(quantity) AS n FROM inventory_balances WHERE org_id=? AND client_id=?',orgId,completeClient))!.n),270);
   assert.equal((await receipts.history(actor,completeClient)).items.length,1);
   const invalid={...input,...cmd(),reference:'BAD-'+randomUUID(),rows:[...parsed.rows,{row:99,sku:'UNKNOWN-QA',quantity:'1',locationCode:'',serial:'',barcode:''}]};
   await assert.rejects(receipts.commit(actor,invalid),/No se recibió ninguna unidad/);
   assert.equal(Number((await db.one('SELECT SUM(quantity) AS n FROM inventory_balances WHERE org_id=? AND client_id=?',orgId,clientId))!.n),280);
   assert.equal((await db.one("SELECT has_table_privilege(current_user,'nexora.inventory_receipt_batches','UPDATE') AS allowed"))!.allowed,false);
   assert.equal((await db.one("SELECT has_table_privilege(current_user,'nexora.inventory_receipt_batches','DELETE') AS allowed"))!.allowed,false);
   throw rollback;
  }),error=>error===rollback);
 }finally{await db.close();}
});
