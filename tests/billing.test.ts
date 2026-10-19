import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/db.ts';
import {calculateBilling} from '../server/billing.ts';
import {createApp} from '../server/app.ts';

import {cmd,billingFixture,exerciseBilling} from './support/billing-fixture.ts';

test('billing: arithmetic uses integer guaranies, included tax buckets and bounded totals',()=>{
 const line=(quantity:number,unitPrice:number,vatRate:0|5|10)=>({description:'QA',quantity,unitPrice,vatRate});
 const r=calculateBilling([line(1,110000,10),line(2,52500,5),line(1,20000,0)]);
 assert.equal(r.total,235000);assert.equal(r.vat10,10000);assert.equal(r.vat5,5000);assert.equal(r.taxable5,100000);assert.equal(r.exempt,20000);
 for(let price=1;price<100;price++){const v=calculateBilling([line(1,price,10)]);assert.equal(v.vat10,Math.round(price/11));assert.equal(v.taxable10+v.vat10,v.total);}
 assert.throws(()=>calculateBilling([line(1000000,10000000000,10)]),/supera/);
 assert.throws(()=>calculateBilling([line(1,1.5,10)]));assert.throws(()=>calculateBilling([line(0,100,10)]));
});
test('billing: state, idempotency, snapshot, isolation, shipment reservations and concurrency',async t=>{const store=new Store(':memory:');t.after(()=>store.close());await exerciseBilling(store);});
test('billing API: requires authenticated admin and never issues a fiscal document',async t=>{
 const store=new Store(':memory:');t.after(()=>store.close());const {actor,billing,input}=await billingFixture(store);
 const app=createApp(store),server=app.listen(0,'127.0.0.1');t.after(()=>new Promise<void>(r=>server.close(()=>r())));
 await new Promise<void>(r=>server.once('listening',r));const address=server.address() as {port:number},base='http://127.0.0.1:'+address.port;
 assert.equal((await fetch(base+'/api/billing')).status,401);
 const token='a'.repeat(64);const {hash}=await import('../server/auth.ts');
 await store.run('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)',hash(token),actor.id,new Date(Date.now()+60000).toISOString());
 const headers={'Content-Type':'application/json','X-Requested-With':'logistics-os',Cookie:'logistics_session='+token};
 assert.equal((await fetch(base+'/api/billing',{headers})).status,200);
 assert.equal((await fetch(base+'/api/billing/issuer',{method:'POST',headers:{Cookie:headers.Cookie,'Content-Type':'application/json'},body:'{}'})).status,403);
 const d=await billing.save(actor,null,{...cmd(),revision:0,data:input});
 assert.equal((await fetch(base+'/api/billing/documents/'+d.id+'/issue',{method:'POST',headers,body:'{}'})).status,409);
 await store.run("UPDATE users SET role='DEPOT' WHERE id=?",actor.id);
 assert.equal((await fetch(base+'/api/billing',{headers})).status,403);
});
