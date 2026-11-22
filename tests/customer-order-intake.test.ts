import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {Store} from '../server/db.ts';
import {createApp} from '../server/app.ts';
import {hash} from '../server/auth.ts';

test('Mini OS: cliente instruye, Operaciones registra, audit e aislamiento sin reservar stock',async()=>{
  const db=new Store(':memory:');
  const server=createApp(db).listen(0,'127.0.0.1');
  await once(server,'listening');
  const origin='http://127.0.0.1:'+(server.address() as AddressInfo).port;
  const id=()=>randomUUID();
  const call=async(path:string,cookie:string,body?:object,method='POST')=>{
    const response=await fetch(origin+path,{method:body?method:'GET',headers:{
      'X-Requested-With':'logistics-os','Content-Type':'application/json',Cookie:cookie,
    },body:body?JSON.stringify(body):undefined});
    return {status:response.status,body:await response.json()};
  };
  try{
    const setup=await fetch(origin+'/api/setup',{method:'POST',headers:{'X-Requested-With':'logistics-os','Content-Type':'application/json'},
      body:JSON.stringify({organizationName:'Mini OS QA',timezone:'America/Asuncion',username:'qa-minios',password:'Mini-Os-2026!Key'})});
    assert.equal(setup.status,201);
    const adminCookie=(setup.headers.get('set-cookie')??'').split(';')[0];
    assert.ok(adminCookie.startsWith('logistics_session='));
    const command=()=>({commandId:id()});
    const client=async(name:string)=>{
      const created=await call('/api/clients',adminCookie,{...command(),name});
      assert.equal(created.status,200,JSON.stringify(created.body));
      return created.body.id as string;
    };
    const a=await client('Comercio A'),b=await client('Comercio B');
    const products=async(clientId:string,sku:string)=>{
      const created=await call('/api/inventory/products',adminCookie,{...command(),clientId,sku,name:'Producto '+sku,tracking:'QUANTITY'});
      assert.equal(created.status,201,JSON.stringify(created.body));
      return created.body.id as string;
    };
    const aProduct=await products(a,'SKU-A'),bProduct=await products(b,'SKU-B');
    const customer=async(clientId:string,username:string)=>{
      const created=await call('/api/customer-access',adminCookie,{...command(),clientId,name:'Vendedor '+username,username,password:'Portal-2026!Login'});
      assert.equal(created.status,200,JSON.stringify(created.body));
      const login=await fetch(origin+'/api/customer/login',{method:'POST',headers:{'X-Requested-With':'logistics-os','Content-Type':'application/json'},
        body:JSON.stringify({username,password:'Portal-2026!Login'})});
      assert.equal(login.status,200);
      const cookie=(login.headers.get('set-cookie')??'').split(';')[0];
      assert.ok(cookie.startsWith('nexora_customer_session='));
      return cookie;
    };
    const customerA=await customer(a,'minios-a'),customerB=await customer(b,'minios-b');
    const payload={...command(),externalId:'COM-A-101',orderDate:'2026-11-22',
      destination:'Asunción, Paraguay',recipientName:'Cliente A',lines:[{productId:aProduct,quantity:2}]};
    const first=await call('/api/customer/order-requests',customerA,payload);
    assert.equal(first.status,201,JSON.stringify(first.body));
    assert.equal(first.body.status,'PENDING');
    assert.equal((await db.one('SELECT COUNT(*) AS total FROM inventory_orders'))?.total,0);
    const retry=await call('/api/customer/order-requests',customerA,payload);
    assert.deepEqual(retry.body,first.body);
    assert.equal((await call('/api/customer/order-requests',customerB)).body.total,0);
    const cross=await call('/api/customer/order-requests',customerA,{...command(),externalId:'OTRO',orderDate:'2026-11-22',
      destination:'Central',recipientName:'Receptor',lines:[{productId:bProduct,quantity:1}]});
    assert.equal(cross.status,403);
    assert.equal((await call('/api/customer/order-requests',adminCookie,payload)).status,401);
    const manualStock=await call('/api/inventory',customerA);
    assert.equal(manualStock.status,200);
    const queued=await call('/api/minios/order-requests?status=PENDING',adminCookie);
    assert.equal(queued.status,200,JSON.stringify(queued.body));
    assert.equal(queued.body.total,1);
    assert.equal(queued.body.rows[0].order.externalId,'COM-A-101');
    assert.equal((await call('/api/minios/order-requests/'+first.body.id+'/accept',customerA,command())).status,403);
    const accepted=await call('/api/minios/order-requests/'+first.body.id+'/accept',adminCookie,command());
    assert.equal(accepted.status,200,JSON.stringify(accepted.body));
    assert.equal(accepted.body.status,'ACCEPTED');
    const acceptedAgain=await call('/api/minios/order-requests/'+first.body.id+'/accept',adminCookie,command());
    assert.equal(acceptedAgain.body.orderId,accepted.body.orderId);
    const order=await call('/api/orders/'+accepted.body.orderId,adminCookie);
    assert.equal(order.status,200,JSON.stringify(order.body));
    assert.equal(order.body.status,'DRAFT');
    assert.equal((await db.one('SELECT COUNT(*) AS total FROM inventory_orders'))?.total,1);
    assert.equal((await db.one('SELECT COUNT(*) AS total FROM inventory_order_parcels'))?.total,0);
    assert.equal((await call('/api/customer/order-requests',customerA)).body.rows[0].status,'ACCEPTED');

    const another=await call('/api/customer/order-requests',customerA,{...command(),externalId:'COM-A-102',orderDate:'2026-11-22',
      destination:'Central',recipientName:'Receptor',lines:[{productId:aProduct,quantity:1}]});
    assert.equal(another.status,201);
    const rejected=await call('/api/minios/order-requests/'+another.body.id+'/reject',adminCookie,{...command(),reason:'Dirección incompleta'});
    assert.equal(rejected.body.status,'REJECTED');
    assert.equal((await call('/api/minios/order-requests/'+another.body.id+'/accept',adminCookie,command())).status,409);
    const duplicate=await call('/api/customer/order-requests',customerA,{...command(),...payload,externalId:'COM-A-102'});
    assert.equal(duplicate.status,409);

    // Otra organización: acceso cruzado vedado incluso con IDs conocidos.
    const otherOrg=id(),otherAdmin=id(),otherToken=randomBytes(32).toString('hex');
    await db.run('INSERT INTO organizations(id,name,timezone) VALUES(?,?,?)',otherOrg,'Otro OS QA','America/Asuncion');
    await db.run('INSERT INTO users(id,org_id,username,name,password_hash,role) VALUES(?,?,?,?,?,?)',otherAdmin,otherOrg,'other-qa','Operaciones B','unused','ADMIN');
    await db.run('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)',hash(otherToken),otherAdmin,'2099-01-01T00:00:00.000Z');
    const otherCookie='logistics_session='+otherToken;
    assert.equal((await call('/api/minios/order-requests/'+first.body.id+'/accept',otherCookie,command())).status,404);
    assert.equal((await call('/api/minios/order-requests?status=ACCEPTED',otherCookie)).body.total,0);

    await db.run('DELETE FROM schema_migrations WHERE version=27');
    assert.equal((await call('/api/customer/order-requests',customerA)).status,503);
    assert.equal((await call('/api/orders/read',customerA)).status,200);
  } finally{
    server.closeAllConnections();
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    await db.close();
  }
});
