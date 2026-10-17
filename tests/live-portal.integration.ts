import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {PostgresStore} from '../server/postgres.ts';
import {createApp} from '../server/app.ts';
import {hash} from '../server/auth.ts';
import {Logistics} from '../server/domain.ts';

test('live Google portal: runtime permissions, administrative grant, persisted request, acceptance and isolation; rollback',async()=>{
  const store=new PostgresStore(process.env.DATABASE_URL??''),org=randomUUID(),otherOrg=randomUUID(),actorId=randomUUID(),token=randomBytes(32).toString('hex'),rollback=Error('PORTAL_QA_ROLLBACK');
  let server:ReturnType<ReturnType<typeof createApp>['listen']>|undefined;
  try{
    await assert.rejects(store.one('SELECT encrypted_password FROM auth.users LIMIT 1'),{code:'42501'});
    await assert.rejects(store.transaction(async()=>{
      const identity=await store.one("SELECT nexora.portal_registered_user(?) AS id",'nexoralogisticpy@gmail.com');assert.ok(identity?.id,'Corporate Google account exists');identity.email='nexoralogisticpy@gmail.com';
      await store.run('INSERT INTO organizations VALUES(?,?,?)',org,'Portal transient QA','America/Asuncion');
      await store.run('INSERT INTO organizations VALUES(?,?,?)',otherOrg,'Other transient QA','America/Asuncion');
      await store.run("INSERT INTO users(id,org_id,username,name,password_hash,role,driver_id) VALUES(?,?,?,?,?,? ,NULL)",actorId,org,'portal-qa-'+actorId,'QA','unusable-fixture','ADMIN');
      await store.run('INSERT INTO sessions VALUES(?,?,?)',hash(token),actorId,new Date(Date.now()+600000).toISOString());
      const actor={id:actorId,orgId:org,name:'QA',role:'ADMIN' as const,driverId:null},domain=new Logistics(store);
      const client=(await domain.createClient(actor,{commandId:randomUUID(),name:'Customer QA'})).id;
      const foreignClient=randomUUID();await store.run('INSERT INTO clients VALUES(?,?,?)',foreignClient,otherOrg,'Foreign QA');
      const bind=AsyncLocalStorage.snapshot();
      const contextStore=new Proxy(store,{get(target,key){const value=Reflect.get(target,key);return typeof value==='function'?(...args:unknown[])=>bind(()=>value.apply(target,args)):value;}});
      server=createApp(contextStore).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server!.once('listening',resolve));
      const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
      const call=async(path:string,body?:unknown,cookie=true)=>{
        const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{...(cookie?{cookie:`logistics_session=${token}`} :{}),...(body?{'Content-Type':'application/json','X-Requested-With':'logistics-os',Origin:origin}:{})},body:body?JSON.stringify(body):undefined});
        return {status:response.status,data:await response.json()};
      };
      assert.equal((await call('/api/customer-google-access',undefined,false)).status,401);
      assert.equal((await call('/api/customer-google-access',{commandId:randomUUID(),clientId:foreignClient,email:identity.email})).status,404);
      const command={commandId:randomUUID(),clientId:client,email:identity.email};
      const grant=await call('/api/customer-google-access',command);assert.equal(grant.status,200,JSON.stringify(grant.data));
      assert.deepEqual((await call('/api/customer-google-access',command)).data,grant.data);
      const accounts=await call('/api/customer-google-access');assert.equal(accounts.data.items.length,1);assert.equal(accounts.data.items[0].clientName,'Customer QA');
      const requestId=randomUUID();
      await store.run("INSERT INTO public.portal_shipping_requests(id,company_id,requested_by,reference,origin_text,destination_text,recipient_name,parcel_count) VALUES(?,?,?,?,?,?,?,?)",requestId,grant.data.companyId,identity.id,'WEB-QA','Asunción','Encarnación','Receiver QA',2);
      const accepted=await call(`/api/customer-shipping-requests/${requestId}/accept`,{});assert.equal(accepted.status,200,JSON.stringify(accepted.data));
      const repeated=await call(`/api/customer-shipping-requests/${requestId}/accept`,{});assert.deepEqual(repeated.data,accepted.data);
      assert.equal((await store.one('SELECT COUNT(*) AS n FROM shipments WHERE org_id=?',org))?.n,1);
      assert.equal((await store.one('SELECT COUNT(*) AS n FROM parcels WHERE shipment_id=?',accepted.data.id))?.n,2);
      assert.equal((await call('/api/customer-google-access')).data.requests[0].status,'ACCEPTED');
      assert.equal((await call(`/api/customer-google-access/${identity.id}/revoke`,{commandId:randomUUID()})).status,200);
      assert.equal((await call('/api/customer-google-access')).data.items[0].status,'suspended');
      await new Promise<void>((resolve,reject)=>server!.close(error=>error?reject(error):resolve()));server=undefined;
      throw rollback;
    }),error=>error===rollback);
    assert.equal(await store.one('SELECT id FROM organizations WHERE id=?',org),undefined);
  }finally{if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));await store.close();}
});
