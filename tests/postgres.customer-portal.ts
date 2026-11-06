import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PostgresStore} from '../server/postgres.ts';
import {Logistics} from '../server/domain.ts';
import {Inventory} from '../server/inventory.ts';

test('PostgreSQL aislado: consulta y exportación del portal conservan el aislamiento y los permisos del runtime',async()=>{
  const url=new URL(process.env.DATABASE_URL??'');
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname)&&url.pathname==='/nexora_test');
  const store=new PostgresStore(url.toString()),orgId=randomUUID(),id=randomUUID(),rollback=Error('PORTAL_ROLLBACK');
  const command=()=>({commandId:randomUUID()});
  try {
    await store.verify();
    await assert.rejects(store.transaction(async()=>{
      await store.run('INSERT INTO organizations VALUES(?,?,?)',orgId,'Portal QA aislado','America/Asuncion');
      await store.run('INSERT INTO users(id,org_id,username,name,password_hash,role,driver_id) VALUES(?,?,?,?,?,?,NULL)',id,orgId,'portal-qa-'+id,'QA','unusable-fixture','ADMIN');
      const actor={id,orgId,name:'QA',role:'ADMIN' as const,driverId:null},domain=new Logistics(store),inventory=new Inventory(store);
      const a=(await domain.createClient(actor,{...command(),name:'Mayorista A'})).id,b=(await domain.createClient(actor,{...command(),name:'Mayorista B'})).id;
      const location=(await inventory.createLocation(actor,{...command(),code:'CENTRAL',name:'Central'})).id;
      for(const [clientId,letter] of [[a,'A'],[b,'B']]){
        const product=(await inventory.createProduct(actor,{...command(),clientId,sku:'SKU-'+letter,name:'Producto '+letter,tracking:'QUANTITY'})).id;
        await inventory.receive(actor,{...command(),clientId,productId:product,locationId:location,quantity:3,reference:'RECEPCION-'+letter});
        await inventory.createOrder(actor,{...command(),clientId,externalId:'PEDIDO-'+letter,orderDate:'2026-11-05',destination:'Destino',recipientName:'Receptor',lines:[{productId:product,quantity:1}]});
      }
      for(const [clientId,own,foreign] of [[a,'A','B'],[b,'B','A']]){
        const customer={...actor,role:'CUSTOMER',clientId};
        const movements=await inventory.movementsPage(customer,{clientId:clientId===a?b:a,q:'RECEPCION-',limit:1});
        assert.equal(movements.total,1);assert.equal(movements.items[0].sku,'SKU-'+own);
        for(const csv of [await inventory.exportCsv(customer),await inventory.exportMovementsCsv(customer),await inventory.exportOrdersCsv(customer,clientId===a?b:a)]){
          assert.ok(csv.includes('SKU-'+own));assert.ok(!csv.includes('SKU-'+foreign));
        }
        assert.equal((await inventory.movementsPage(customer,{q:'RECEPCION-'+foreign})).total,0);
        assert.equal((await inventory.orders(customer)).total,1);
      }
      const invalid={...actor,role:'CUSTOMER',clientId:null};
      await assert.rejects(()=>inventory.exportOrdersCsv(invalid),(error:any)=>error.code==='FORBIDDEN');
      await assert.rejects(()=>inventory.exportMovementsCsv({...actor,role:'DRIVER'}),(error:any)=>error.code==='FORBIDDEN');
      throw rollback;
    }),error=>error===rollback);
    assert.equal(await store.one('SELECT id FROM organizations WHERE id=?',orgId),undefined);
  } finally {await store.close();}
});
