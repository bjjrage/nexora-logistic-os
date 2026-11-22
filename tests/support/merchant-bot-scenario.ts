import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {MerchantBotSimulator} from '../../server/minios-bot.ts';
import {CustomerOrderIntake} from '../../server/customer-order-intake.ts';
import type {Database} from '../../server/database.ts';
import type {Actor} from '../../server/auth.ts';
import {Inventory} from '../../server/inventory.ts';

export async function exerciseBot(db:Database) {
  const id=()=>randomUUID();
  const orgId=id(),otherOrg=id(),adminId=id(),clientA=id(),clientB=id(),clientC=id();
  for(const org of [orgId,otherOrg])
    await db.run('INSERT INTO organizations(id,name,timezone) VALUES(?,?,?)',org,'Bot QA','America/Asuncion');
  await db.run('INSERT INTO users(id,org_id,username,name,password_hash,role) VALUES(?,?,?,?,?,?)',adminId,orgId,adminId,'Admin QA','unused','ADMIN');
  const merchant=async(org:string,clientId:string):Promise<Actor>=>{
    const account=id();
    await db.run('INSERT INTO clients(id,org_id,name) VALUES(?,?,?)',clientId,org,'Comercio '+clientId);
    await db.run('INSERT INTO customer_accounts(id,org_id,client_id,name,username,password_hash,enabled,created_at) VALUES(?,?,?,?,?,?,1,?)',
      account,org,clientId,'Cuenta QA',account,'unused',new Date().toISOString());
    return {id:account,role:'CUSTOMER',name:'Cuenta QA',orgId:org,clientId,driverId:null};
  };
  const a=await merchant(orgId,clientA),b=await merchant(orgId,clientB),c=await merchant(otherOrg,clientC);
  const admin:Actor={id:adminId,role:'ADMIN',orgId,name:'Admin QA',driverId:null};
  const inventory=new Inventory(db);
  const p=await inventory.createProduct(admin,{commandId:id(),clientId:clientA,sku:'BOT-QA',name:'Producto',tracking:'QUANTITY'});
  const location=await inventory.createLocation(admin,{commandId:id(),code:'BOT-QA',name:'Depósito QA',kind:'DEPOT'});
  await inventory.receive(admin,{commandId:id(),clientId:clientA,productId:p.id,locationId:location.id,quantity:3,reference:'Entrada QA'});
  const bot=new MerchantBotSimulator(db),intake=new CustomerOrderIntake(db);
  const order={externalId:'BOT-QA-01',orderDate:'2026-11-22',destination:'Destino QA',recipientName:'Persona QA',
    recipientPhone:'',restrictions:'',lines:[{productId:p.id,quantity:2}]};
  const quote={commandId:id(),order};
  const before=await bot.quote(a,quote);
  assert.equal(before.channels.WHATSAPP,'NOT_CONNECTED');
  assert.equal(before.stock[0].available,3);
  assert.deepEqual(await bot.quote(a,quote),before);
  for(const merchant of [b,c]) await assert.rejects(bot.get(merchant,before.id),/no encontrada/);
  await assert.rejects(bot.quote(b,{...quote,commandId:id()}),/Producto sin autorización/);
  for(const role of ['ADMIN','OPERATIONS','DEPOT','DRIVER'] as const)
    await assert.rejects(bot.quote({...admin,role},quote),/Ingresá como comerciante/);
  const shortage=await bot.quote(a,{commandId:id(),order:{...order,externalId:'BOT-QA-SHORT',lines:[{productId:p.id,quantity:4}]}});
  await assert.rejects(bot.confirm(a,shortage.id,{commandId:id(),expectedVersion:1}),/Stock insuficiente/);
  await assert.rejects(bot.confirm(a,before.id,{commandId:id(),expectedVersion:2}),/simulación ya cambió/);
  const confirm={commandId:id(),expectedVersion:1};
  const [first,retry]=await Promise.all([bot.confirm(a,before.id,confirm),bot.confirm(a,before.id,confirm)]);
  assert.equal(first.status,'SUBMITTED');
  assert.deepEqual(first,retry);
  assert.deepEqual(await bot.get(a,before.id),first);
  assert.equal((await intake.mine(a,{limit:25,offset:0})).total,1);
  assert.equal((await db.one('SELECT COUNT(*) AS n FROM inventory_orders WHERE org_id=?',orgId))?.n,0);
  assert.equal(Number((await inventory.availableProducts(a,[p.id]))[0].available),3);
  await assert.rejects(intake.submit(a,{...order,commandId:id()}),/Ya existe un pedido/);
  const accepted=await intake.accept(admin,first.requestId,{commandId:id(),expectedVersion:1});
  assert.equal((await inventory.orders(a,undefined,{orderId:accepted.orderId})).items[0].status,'DRAFT');
  assert.equal(Number((await inventory.availableProducts(a,[p.id]))[0].available),3);
  const stale=await bot.quote(a,{commandId:id(),order:{...order,externalId:'BOT-QA-STALE'}});
  assert.equal(stale.stock[0].available,3);
  await inventory.reserveOrder(admin,accepted.orderId,{commandId:id(),locationId:location.id});
  await assert.rejects(bot.confirm(a,stale.id,{commandId:id(),expectedVersion:1}),/Stock insuficiente al confirmar/);
  assert.equal((await intake.mine(a,{limit:25,offset:0})).total,1);
  return {orgId};
}
