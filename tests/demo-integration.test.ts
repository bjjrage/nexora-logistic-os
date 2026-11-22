import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {Store} from '../server/db.ts';
import {seedPrivateDemo} from '../server/demo-seed.ts';
import {createApp} from '../server/app.ts';

test('DEMO privada: semilla ficticia, módulos combinados y autenticación previa',async()=>{
  const envKeys=['DEMO_ADMIN_PASSWORD','DEMO_CUSTOMER_PASSWORD','NEXORA_DEMO_MODE','NEXORA_DEMO_BASIC_USER','NEXORA_DEMO_BASIC_PASSWORD'];
  const original=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
  Object.assign(process.env,{DEMO_ADMIN_PASSWORD:'Demo-Admin-Test-2026!',DEMO_CUSTOMER_PASSWORD:'Demo-Merchant-Test-2026!',
    NEXORA_DEMO_MODE:'isolated',NEXORA_DEMO_BASIC_USER:'demo-review',NEXORA_DEMO_BASIC_PASSWORD:'Demo-Private-Basic-Long-2026-Test!'});
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
    server=createApp(db).listen(0,'127.0.0.1');await once(server,'listening');
    const base='http://127.0.0.1:'+(server.address() as AddressInfo).port;
    const blocked=await fetch(base+'/api/health');
    assert.equal(blocked.status,401);
    const headers={Authorization:'Basic '+Buffer.from('demo-review:Demo-Private-Basic-Long-2026-Test!').toString('base64')};
    assert.equal((await fetch(base+'/api/health',{headers})).status,200);
    assert.equal((await fetch(base+'/api/session',{headers})).status,200);
    assert.equal((await fetch(base+'/api/customer/session',{headers})).status,200);
    // La página /portal/ se compila después de npm test; validar la UI en el E2E de build, no en este test unitario.
    assert.equal((await fetch(base+'/api/customer/session',{headers})).status,200);
  }finally{
    if(server){server.closeAllConnections();await new Promise<void>((resolve,reject)=>server!.close(e=>e?reject(e):resolve()));}
    await db.close();
    for(const key of envKeys){const value=original[key];if(value===undefined)delete process.env[key];else process.env[key]=value;}
  }
});
