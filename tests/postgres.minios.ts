import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PostgresStore} from '../server/postgres.ts';
import {CustomerOrderIntake} from '../server/customer-order-intake.ts';
import {Inventory} from '../server/inventory.ts';
import type {Actor} from '../server/auth.ts';

test('Mini OS PostgreSQL: RLS, aislamiento y conversión mediante núcleo de pedidos',async()=>{
  const url=new URL(process.env.DATABASE_URL??'');
  assert.ok(['localhost','127.0.0.1'].includes(url.hostname)&&url.pathname==='/nexora_test');
  const db=new PostgresStore(url.toString()),rollback=new Error('MINIOS_TEST_ROLLBACK');
  const id=()=>randomUUID();
  try{
    await db.verify();
    const policy=await db.one("SELECT row_security_active(c.oid) AS active FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='nexora' AND c.relname='customer_order_requests'");
    assert.equal(policy?.active,true);
    for(const role of ['anon','authenticated','service_role','nexora_tracking_worker']){
      const granted=await db.one('SELECT has_table_privilege(?,?,?) AS allowed',role,'nexora.customer_order_requests','SELECT');
      assert.equal(granted?.allowed,false);
    }
    await assert.rejects(db.transaction(async()=>{
      const org=id(),a=id(),b=id(),adminId=id(),customerId=id(),otherCustomerId=id(),stamp=new Date().toISOString();
      await db.run('INSERT INTO organizations(id,name,timezone) VALUES(?,?,?)',org,'Mini OS PG QA','America/Asuncion');
      await db.run('INSERT INTO users(id,org_id,username,name,password_hash,role) VALUES(?,?,?,?,?,?)',adminId,org,adminId,'Admin QA','unused','ADMIN');
      for(const [clientId,label] of [[a,'A'],[b,'B']])
        await db.run('INSERT INTO clients(id,org_id,name) VALUES(?,?,?)',clientId,org,'Comercio '+label);
      await db.run('INSERT INTO customer_accounts(id,org_id,client_id,name,username,password_hash,enabled,created_at) VALUES(?,?,?,?,?,?,1,?)',
        customerId,org,a,'Cliente A','a-'+customerId,'unused',stamp);
      await db.run('INSERT INTO customer_accounts(id,org_id,client_id,name,username,password_hash,enabled,created_at) VALUES(?,?,?,?,?,?,1,?)',
        otherCustomerId,org,b,'Cliente B','b-'+otherCustomerId,'unused',stamp);
      const admin:Actor={id:adminId,orgId:org,name:'QA',role:'ADMIN',driverId:null},
        customer:Actor={id:customerId,orgId:org,name:'A',role:'CUSTOMER',driverId:null,clientId:a},
        other:Actor={id:otherCustomerId,orgId:org,name:'B',role:'CUSTOMER',driverId:null,clientId:b};
      const product=(await new Inventory(db).createProduct(admin,{
        commandId:id(),clientId:a,sku:'PG-MINIOS-A',name:'Artículo A',tracking:'QUANTITY',
      })).id;
      const service=new CustomerOrderIntake(db),commandId=id();
      const request=await service.submit(customer,{commandId,externalId:'PG-REQ-1',orderDate:'2026-11-22',
        destination:'Asunción',recipientName:'Receptor',recipientPhone:'',restrictions:'',
        lines:[{productId:product,quantity:2}]});
      assert.equal(request.status,'PENDING');
      assert.equal((await service.mine(other,{limit:25,offset:0})).total,0);
      assert.equal((await service.mine(customer,{limit:25,offset:0})).total,1);
      await assert.rejects(service.accept(other,request.id,{commandId:id()}),/Tu rol no permite/);
      const accepted=await service.accept(admin,request.id,{commandId:id()});
      assert.equal(accepted.status,'ACCEPTED');
      assert.equal((await db.one('SELECT status FROM inventory_orders WHERE org_id=? AND id=?',org,accepted.orderId))?.status,'DRAFT');
      assert.equal((await db.one('SELECT COUNT(*) AS total FROM inventory_order_parcels WHERE org_id=?',org))?.total,0);
      throw rollback;
    }),/MINIOS_TEST_ROLLBACK/);
  }finally{await db.close();}
});
