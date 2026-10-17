import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {Store} from '../server/db.ts';
import {setup,hash} from '../server/auth.ts';
import {createApp} from '../server/app.ts';
import {Diagnostics,WindowLimiter} from '../server/observability.ts';
test('bounded limiter rejects bursts, clears expired keys and cannot grow without bound',()=>{
 const limit=new WindowLimiter(2,100,2);assert.equal(limit.allow('A',0),true);assert.equal(limit.allow('A',1),true);assert.equal(limit.allow('A',2),false);assert.equal(limit.allow('B',2),true);assert.equal(limit.allow('C',3),false);assert.equal(limit.allow('C',102),true);
});
test('server error reference correlates response and JSON log without leaking message, input or query',async t=>{
 const store=new Store(':memory:');t.after(()=>store.close());const ids=await setup(store,{organizationName:'QA',timezone:'UTC',username:'obs-qa',password:'QA-Observability-2026!'});
 const token=randomBytes(32).toString('hex');await store.run('INSERT INTO sessions VALUES(?,?,?)',hash(token),ids.userId,new Date(Date.now()+60000).toISOString());
 const entries:Record<string,unknown>[]=[],diagnostics=new Diagnostics(e=>entries.push(e));
 const failing=new Proxy(store,{get(target,key){if(key==='one')return async(sql:string,...args:any[])=>{if(sql==='SELECT 1 AS connected')throw new Error('PRIVATE_PASSWORD_PERSONAL_DATA');return target.one(sql,...args);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 const server=createApp(failing,undefined,undefined,diagnostics).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));t.after(()=>new Promise<void>(r=>server.close(()=>r())));
 const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`,id=randomUUID();
 const response=await fetch(origin+'/api/health?secret=PRIVATE_QUERY',{headers:{'X-Request-Id':id}});assert.equal(response.status,500);assert.equal(response.headers.get('X-Request-Id'),id);assert.equal((await response.json()).error.requestId,id);
 assert.equal(entries.find(e=>e.event==='server.error')?.requestId,id);assert.doesNotMatch(JSON.stringify(entries),/PRIVATE_PASSWORD|PRIVATE_QUERY/);
 const event=await fetch(origin+'/api/diagnostics/events',{method:'POST',headers:{cookie:`logistics_session=${token}`,'X-Requested-With':'logistics-os','Content-Type':'application/json',Origin:origin},body:JSON.stringify({kind:'UI_ERROR',component:'Window',password:'do-not-log'})});assert.equal(event.status,400);
 assert.equal((await fetch(origin+'/api/diagnostics')).status,401);
});
