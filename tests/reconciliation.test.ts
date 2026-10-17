import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Store} from '../server/db.ts';
import {setup} from '../server/auth.ts';
import {Logistics} from '../server/domain.ts';
import {Inventory} from '../server/inventory.ts';
import {reconcileInventory} from '../server/reconciliation.ts';
test('reconciliation independently detects quantity and serial corruption and isolates organizations',async t=>{
 const store=new Store(':memory:');t.after(()=>store.close());const ids=await setup(store,{organizationName:'QA',timezone:'UTC',username:'reconcile-qa',password:'QA-Reconcile-2026!'});
 const actor={id:ids.userId,orgId:ids.orgId,name:'QA',role:'ADMIN' as const,driverId:null},command=()=>({commandId:randomUUID()});
 const inventory=new Inventory(store),domain=new Logistics(store);
 const client=(await domain.createClient(actor,{...command(),name:'QA'})).id,location=(await inventory.createLocation(actor,{...command(),code:'QA',name:'QA'})).id;
 for(const tracking of ['QUANTITY','SERIAL']){const product=await inventory.createProduct(actor,{...command(),clientId:client,sku:tracking,name:tracking,tracking});await inventory.receive(actor,{...command(),clientId:client,productId:product.id,locationId:location,quantity:2,...(tracking==='SERIAL'?{serials:[{serial:'A'},{serial:'B'}]}:{})});}
 assert.equal((await reconcileInventory(store,actor)).ok,true);
 await store.run('UPDATE inventory_balances SET quantity=quantity+1 WHERE org_id=?',actor.orgId);
 let result=await reconcileInventory(store,actor);assert.equal(result.ok,false);assert.equal(result.quantityIssues.length,1);assert.equal(result.quantityIssues[0].expected,2);assert.equal(result.quantityIssues[0].actual,3);
 await store.run("UPDATE inventory_units SET status='DELIVERED' WHERE serial='A'");result=await reconcileInventory(store,actor);assert.equal(result.serialIssues.length,1);
 await assert.rejects(reconcileInventory(store,{...actor,role:'DEPOT'}),(e:any)=>e.code==='FORBIDDEN');
 const foreign=randomUUID();await store.run('INSERT INTO organizations VALUES(?,?,?)',foreign,'Foreign','UTC');assert.equal((await reconcileInventory(store,{...actor,orgId:foreign})).ok,true);
});
