import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PostgresStore} from '../server/postgres.ts';
import {Logistics} from '../server/domain.ts';
import {Inventory} from '../server/inventory.ts';
import {PasswordRecovery} from '../server/password-recovery.ts';
import {checkPassword} from '../server/auth.ts';
test('isolated PostgreSQL: paged stock/catalog, lookup past 1000 products and audited password recovery use runtime grants',async()=>{
 const url=new URL(process.env.DATABASE_URL??'');assert.ok(['127.0.0.1','localhost'].includes(url.hostname)&&url.pathname==='/nexora_test');
 const store=new PostgresStore(url.toString()),rollback=Error('ISOLATED_ROLLBACK'),orgId=randomUUID(),id=randomUUID(),command=()=>({commandId:randomUUID()});
 try{await store.verify();await assert.rejects(store.transaction(async()=>{
  await store.run('INSERT INTO organizations VALUES(?,?,?)',orgId,'QA native pages','UTC');await store.run('INSERT INTO users VALUES(?,?,?,?,?,?,NULL)',id,orgId,'qa-native-'+id,'QA','unusable-fixture','ADMIN');
  const actor={id,orgId,name:'QA',role:'ADMIN' as const,driverId:null},domain=new Logistics(store),inventory=new Inventory(store),recovery=new PasswordRecovery(store);
  const client=(await domain.createClient(actor,{...command(),name:'A'})).id,other=(await domain.createClient(actor,{...command(),name:'B'})).id;
  await store.run(`INSERT INTO inventory_products(id,org_id,client_id,sku,name,tracking,unit,active,created_at,updated_at) SELECT gen_random_uuid()::text,?,?,'SKU-'||lpad(n::text,4,'0'),'Product '||lpad(n::text,4,'0'),'QUANTITY','unidad',1,now(),now() FROM generate_series(1,1005) n`,orgId,client);
  const catalog=await inventory.catalogPage(actor,{clientId:client,offset:1000,limit:25});assert.equal(catalog.total,1005);assert.equal(catalog.items.length,5);
  const last=await inventory.lookupCode(actor,{clientId:client,code:'SKU-1005'});assert.ok(last.product?.id);
  const location=(await inventory.createLocation(actor,{...command(),code:'QA',name:'QA'})).id;await inventory.receive(actor,{...command(),clientId:client,productId:last.product!.id,locationId:location,quantity:3});
  const stock=await inventory.stockPage(actor,{q:'SKU-1005'});assert.equal(stock.total,1);assert.equal(stock.items[0].quantity,3);assert.equal((await inventory.stockPage({...actor,role:'CUSTOMER',clientId:other})).total,0);
  const issued=await recovery.issue(actor,{kind:'USER',id});await recovery.redeem({token:issued.token,password:'QA-Native-Changed-2026!'});assert.equal(checkPassword('QA-Native-Changed-2026!',(await store.one('SELECT password_hash FROM users WHERE id=?',id))!.password_hash),true);
  assert.equal((await store.one("SELECT COUNT(*) n FROM audit WHERE org_id=? AND action='account.recovery.redeemed'",orgId))!.n,1);
  throw rollback;
 }),e=>e===rollback);}finally{await store.close();}
});
