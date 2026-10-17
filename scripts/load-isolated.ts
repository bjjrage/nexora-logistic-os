import pg from 'pg';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {PostgresStore} from '../server/postgres.ts';
import {createApp} from '../server/app.ts';
import {hash} from '../server/auth.ts';
import {Diagnostics} from '../server/observability.ts';
const url=new URL(process.env.PG_TEST_ADMIN_URL??'');
if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/nexora_test')throw new Error('Carga solo en PostgreSQL ficticio local.');
const admin=new pg.Client({connectionString:url.toString()});await admin.connect();
let org=randomUUID(),user=randomUUID(),client=randomUUID();const token=randomBytes(32).toString('hex'),size=100000;
const label=process.env.LOAD_LABEL??'baseline';if(!/^[a-z0-9-]+$/.test(label))throw new Error('LOAD_LABEL inválido.');
try{
 await admin.query('BEGIN');
 if(process.env.LOAD_REUSE==='true'){
  const fixture=(await admin.query("SELECT o.id AS org,u.id AS actor,c.id AS client FROM nexora.organizations o JOIN nexora.users u ON u.org_id=o.id JOIN nexora.clients c ON c.org_id=o.id WHERE o.name='QA carga ficticia' ORDER BY o._sequence DESC LIMIT 1")).rows[0];
  if(!fixture)throw new Error('No existe fixture de carga.');org=fixture.org;user=fixture.actor;client=fixture.client;
 }else{
 await admin.query('INSERT INTO nexora.organizations(id,name,timezone) VALUES($1,$2,$3)',[org,'QA carga ficticia','America/Asuncion']);
 await admin.query("INSERT INTO nexora.users(id,org_id,username,name,password_hash,role) VALUES($1,$2,$3,'QA','unusable-fixture','ADMIN')",[user,org,'qa-load-'+user]);
 await admin.query("INSERT INTO nexora.clients(id,org_id,name) VALUES($1,$2,'QA carga')",[client,org]);
 await admin.query(`INSERT INTO nexora.shipments(id,org_id,client_id,reference,origin_text,destination_text,recipient_name,recipient_phone,proof_policy,created_at)
 SELECT 'load-'||$1||'-'||n,$1,$2,'QA-'||n,'Origen QA','Destino QA','Persona ficticia','','RECEIVER',now()+n*interval '1 microsecond' FROM generate_series(1,$3::int) n`,[org,client,size]);
 await admin.query(`INSERT INTO nexora.parcels(id,org_id,shipment_id,code,state,custody_type,custody_id,weight_grams,volume_cm3)
 SELECT 'parcel-'||$1||'-'||n,$1,'load-'||$1||'-'||n,'B-'||upper(substr(md5($1||'-'||n),1,20)),'EXPECTED','SENDER',$2,100,100 FROM generate_series(1,$3::int) n`,[org,client,size]);
 }
 await admin.query('INSERT INTO nexora.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval \'2 hours\')',[hash(token),user]);
 await admin.query('COMMIT');
 const plans=(await admin.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT * FROM nexora.shipments WHERE org_id=$1 ORDER BY created_at DESC,id LIMIT 25',[org])).rows;
 mkdirSync('.local/load',{recursive:true});writeFileSync(`.local/load/plan-${label}.json`,JSON.stringify(plans,null,2));
}finally{await admin.end();}
const store=new PostgresStore(process.env.DATABASE_URL??'');await store.verify();const server=createApp(store,undefined,undefined,new Diagnostics(()=>{})).listen(3041,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
const duration=Number(process.env.LOAD_DURATION_MS??600000),concurrency=10,start=performance.now(),times:number[]=[],errors:Record<string,number>={};
console.log(JSON.stringify({started:true,durationMs:duration,concurrentUsers:concurrency,assumption:'10x a single simultaneous pilot user',shipments:size,parcels:size,productionTouched:false}));
try{
 await Promise.all(Array.from({length:concurrency},async(_,worker)=>{let n=0;while(performance.now()-start<duration){const at=performance.now(),path=n++%10===0?'/api/bootstrap':'/api/shipments?limit=25&offset='+((worker+n)%20)*25;try{const response=await fetch('http://127.0.0.1:3041'+path,{headers:{cookie:`logistics_session=${token}`},signal:AbortSignal.timeout(30000)});await response.arrayBuffer();if(!response.ok)errors[String(response.status)]=(errors[String(response.status)]??0)+1;}catch{errors.network=(errors.network??0)+1;}times.push(performance.now()-at);await new Promise(r=>setTimeout(r,Math.max(0,500-(performance.now()-at))));}}));
 times.sort((a,b)=>a-b);const failures=Object.values(errors).reduce((a,b)=>a+b,0),percentile=(n:number)=>Math.round(times[Math.min(times.length-1,Math.floor(times.length*n))]);
 const result={at:new Date().toISOString(),label,durationMs:Math.round(performance.now()-start),concurrency,shipments:size,parcels:size,requests:times.length,errors,errorRate:failures/times.length,p50Ms:percentile(.5),p95Ms:percentile(.95),p99Ms:percentile(.99),pass:failures===0&&percentile(.95)<1000};writeFileSync(`.local/load/result-${label}.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(!result.pass)process.exitCode=1;
}finally{await new Promise<void>(r=>server.close(()=>r()));await store.close();}
