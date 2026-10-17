import {appendFileSync,mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
const directory=resolve('.local/monitor');mkdirSync(directory,{recursive:true});
const statusPath=resolve(directory,'state.json'),previous=existsSync(statusPath)?JSON.parse(readFileSync(statusPath,'utf8')):{};
const targets=[{name:'os',url:process.env.OS_MONITOR_URL??'http://127.0.0.1:5173/api/ready'},{name:'web',url:'https://nexoralogisticpy.netlify.app/seguimiento/'}];
if(process.env.TRACCAR_GATEWAY_URL)targets.push({name:'gps',url:new URL('/health',process.env.TRACCAR_GATEWAY_URL).toString()});
const now=new Date().toISOString(),outboxPath=resolve(directory,'outbox.json');
const outbox:Record<string,any>[]=existsSync(outboxPath)?JSON.parse(readFileSync(outboxPath,'utf8')):[];
const results=await Promise.all(targets.map(async target=>{const started=performance.now();let ok=false;try{const r=await fetch(target.url,{signal:AbortSignal.timeout(10000),redirect:'error'});await r.arrayBuffer();ok=r.ok;}catch{}return {name:target.name,ok,durationMs:Math.round(performance.now()-started)};}));
const state=Object.fromEntries(results.map(r=>{const failures=r.ok?0:(previous[r.name]?.failures??0)+1;return [r.name,{...r,observedOk:r.ok,ok:r.ok||failures<3&&(previous[r.name]?.ok??true),failures,at:now}];}));
const changed=Object.values(state).filter(r=>previous[r.name]?.ok!==r.ok&&previous[r.name]!==undefined);
writeFileSync(statusPath,JSON.stringify(state,null,2));appendFileSync(resolve(directory,'checks.jsonl'),JSON.stringify({at:now,results})+'\n');
if(changed.length){const alert={at:now,type:'monitor.status_changed',services:changed};appendFileSync(resolve(directory,'alerts.jsonl'),JSON.stringify(alert)+'\n');console.log(JSON.stringify(alert));outbox.push({id:crypto.randomUUID(),alert,attempts:0,nextAttempt:0,status:'PENDING'});writeFileSync(outboxPath,JSON.stringify(outbox,null,2));
}
// Optional private relay. Persist before delivery; retry only metadata alerts with a stable idempotency key.
if(process.env.ALERT_WEBHOOK_URL){const relay=new URL(process.env.ALERT_WEBHOOK_URL);if(relay.protocol!=='https:')throw new Error('El canal de alertas exige HTTPS.');
 for(const item of outbox.filter(item=>item.status==='PENDING'&&item.nextAttempt<=Date.now()).slice(0,3)){
  item.attempts++;try{const response=await fetch(relay,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':item.id,...(process.env.ALERT_WEBHOOK_SECRET?{Authorization:`Bearer ${process.env.ALERT_WEBHOOK_SECRET}`}:{})},body:JSON.stringify(item.alert),signal:AbortSignal.timeout(10000),redirect:'error'});if(!response.ok)throw new Error('delivery-failed');item.status='SENT';}catch{item.status=item.attempts>=3?'FAILED':'PENDING';item.nextAttempt=Date.now()+60000*2**item.attempts;}
  writeFileSync(outboxPath,JSON.stringify(outbox,null,2));
 }
}
if(results.some(r=>!r.ok))process.exitCode=1;
