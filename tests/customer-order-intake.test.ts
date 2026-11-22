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
    const editPayload={...command(),expectedVersion:1,kind:'EDIT',reason:'Corregir dirección',
      order:{orderDate:payload.orderDate,destination:'Nueva dirección',recipientName:payload.recipientName,lines:payload.lines}};
    const path='/api/customer/order-requests/'+first.body.id+'/change';
    assert.equal((await call(path,customerB,editPayload)).status,404);
    const invalidSku={...editPayload,commandId:id(),order:{...editPayload.order,lines:[{productId:bProduct,quantity:1}]}};
    assert.equal((await call(path,customerA,invalidSku)).status,403);
    const responses=await Promise.all([call(path,customerA,editPayload),call(path,customerA,editPayload)]);
    assert.equal(responses[0].status,200);
    assert.deepEqual(responses[0].body,responses[1].body);
    assert.equal(responses[0].body.version,2);
    assert.equal((await call(path,customerA,{...editPayload,commandId:id()})).status,409);
    assert.equal((await call('/api/minios/order-requests/'+first.body.id+'/accept',adminCookie,{...command(),expectedVersion:1})).status,409);
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

    assert.equal(order.body.destination,'Nueva dirección');
    const read=await call('/api/orders/read?orderId='+accepted.body.orderId,customerA);
    assert.equal(read.body.items[0].status,'DRAFT');
    assert.equal((await call('/api/orders/read?orderId='+accepted.body.orderId,customerB)).body.total,0);
    const editAccepted=await call(path,customerA,{...editPayload,commandId:id(),expectedVersion:3,order:{...editPayload.order,destination:'Propuesta comercial'}});
    assert.equal(editAccepted.status,200);
    assert.ok(editAccepted.body.changeId);
    const changes=await call('/api/minios/order-requests?status=CHANGE_PENDING',adminCookie);
    assert.equal(changes.body.total,1);
    assert.equal(changes.body.rows[0].change.proposed.destination,'Propuesta comercial');
    const review='/api/minios/order-requests/'+first.body.id+'/review';
    const reviewBody={...command(),expectedVersion:4,changeId:editAccepted.body.changeId,outcome:'ACKNOWLEDGED',reason:'Recibido por operaciones'};
    assert.equal((await call(review,customerA,reviewBody)).status,403);
    const reviewed=await call(review,adminCookie,reviewBody);
    assert.equal(reviewed.status,200);
    assert.deepEqual((await call(review,adminCookie,reviewBody)).body,reviewed.body);
    const cancel={...command(),kind:'CANCEL',expectedVersion:5,reason:'Cancelación comercial solicitada'};
    assert.ok((await call(path,customerA,cancel)).body.changeId);
    assert.equal((await call('/api/orders/'+accepted.body.orderId,adminCookie)).body.destination,'Nueva dirección');
    const history=await call('/api/customer/order-requests/'+first.body.id+'/history',customerA);
    assert.deepEqual(history.body.rows.map((r:{kind:string})=>r.kind),
      ['CHANGE_REQUESTED','CHANGE_REVIEWED','CHANGE_REQUESTED','ACCEPTED','EDITED','SUBMITTED']);
    assert.equal((await call(path,customerA,editPayload)).body.version,2);
    const draft=await call('/api/customer/order-requests',customerA,{...payload,...command(),externalId:'COM-A-CANCEL'});
    const draftPath='/api/customer/order-requests/'+draft.body.id+'/change';
    const cancelled=await call(draftPath,customerA,{...cancel,...command(),expectedVersion:1});
    assert.equal(cancelled.body.status,'CANCELLED');
    assert.equal((await call('/api/minios/order-requests/'+draft.body.id+'/accept',adminCookie,command())).status,409);
    assert.equal((await call('/api/minios/order-requests?status=CANCELLED',adminCookie)).body.total,1);
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

    await db.run('DELETE FROM schema_migrations WHERE version=28');
    assert.equal((await call('/api/customer/order-requests',customerA)).status,503);
    assert.equal((await call('/api/orders/read',customerA)).status,200);
  } finally{
    server.closeAllConnections();
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    await db.close();
  }
});
