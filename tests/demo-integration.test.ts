import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {Store} from '../server/db.ts';
import {seedPrivateDemo} from '../server/demo-seed.ts';
import {createApp} from '../server/app.ts';

test('DEMO sin contraseñas: sesiones por perfil, base ficticia y CRM + Mini OS',async()=>{
  const previous=process.env.NEXORA_DEMO_MODE;
  process.env.NEXORA_DEMO_MODE='isolated';
  const db=new Store(':memory:');
  let server:ReturnType<ReturnType<typeof createApp>['listen']>|undefined;
  try{
    await seedPrivateDemo(db);
    await seedPrivateDemo(db);
    assert.equal((await db.one('SELECT COUNT(*) AS n FROM users'))?.n,1);
    assert.equal((await db.one('SELECT COUNT(*) AS n FROM customer_accounts'))?.n,1);
    assert.equal((await db.one('SELECT COUNT(*) AS n FROM inventory_products'))?.n,2);
    assert.equal((await db.one('SELECT COUNT(*) AS n FROM crm_prospects'))?.n,3);
    for(const version of [24,25,27,28,29,30])assert.ok(await db.one('SELECT version FROM schema_migrations WHERE version=?',version));

    server=createApp(db).listen(0,'127.0.0.1');
    await once(server,'listening');
    const base='http://127.0.0.1:'+(server.address() as AddressInfo).port;
    assert.equal((await fetch(base+'/api/health')).status,200);
    const staff=await fetch(base+'/api/session');
    assert.equal(staff.status,200);
    assert.equal((await staff.json()).user.role,'ADMIN');
    const staffCookie=staff.headers.get('set-cookie')?.split(';')[0];
    assert.ok(staffCookie?.startsWith('logistics_session='));
    const bootstrap=await fetch(base+'/api/bootstrap',{headers:{Cookie:staffCookie}});
    assert.equal(bootstrap.status,200);
    const state=await bootstrap.json();
    assert.equal(state.crmAvailable,true);
    assert.equal(state.miniosReady,true);

    const merchant=await fetch(base+'/api/customer/session');
    assert.equal(merchant.status,200);
    assert.equal((await merchant.json()).user.role,'CUSTOMER');
    const merchantCookie=merchant.headers.get('set-cookie')?.split(';')[0];
    assert.ok(merchantCookie?.startsWith('nexora_customer_session='));
    const requests=await fetch(base+'/api/customer/order-requests',{headers:{Cookie:merchantCookie}});
    assert.equal(requests.status,200);
    // Identidades separadas: la cookie del cliente no da acceso al CRM del staff.
    const cross=await fetch(base+'/api/crm/prospects',{headers:{Cookie:merchantCookie}});
    assert.notEqual(cross.status,200);
    assert.equal((await fetch(base+'/api/health')).headers.get('x-robots-tag'),'noindex, nofollow');
  }finally{
    if(server){server.closeAllConnections();await new Promise<void>((resolve,reject)=>server!.close(e=>e?reject(e):resolve()));}
    await db.close();
    if(previous===undefined)delete process.env.NEXORA_DEMO_MODE;else process.env.NEXORA_DEMO_MODE=previous;
  }
});
