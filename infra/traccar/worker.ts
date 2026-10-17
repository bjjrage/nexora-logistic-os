// Bundled by build-worker.mjs into one Railway Function. No OS/website source is published.
import pg from 'pg@8.16.3';
import { timingSafeEqual } from 'node:crypto';
import { ingestTraccarPosition } from '../../server/traccar-position.ts';

const env=process.env;
const base=env.TRACCAR_INTERNAL_URL;
if(!base||!/^http:\/\/[a-z0-9-]+\.railway\.internal:8082$/.test(base))throw new Error('TRACCAR_INTERNAL_URL inválida');
if(!env.DATABASE_URL||!env.PG_CA||!env.GATEWAY_SECRET||env.GATEWAY_SECRET.length<32)throw new Error('Falta configuración privada');
const pool=new pg.Pool({connectionString:env.DATABASE_URL,max:3,connectionTimeoutMillis:10000,statement_timeout:15000,ssl:{rejectUnauthorized:true,ca:env.PG_CA}});
pool.on('error',()=>console.error('Conexión de base interrumpida'));
let connected=false,checkedAt=null,cookie='',stopping=false;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const headers=()=>({Authorization:'Basic '+Buffer.from(env.TRACCAR_EMAIL+':'+env.TRACCAR_PASSWORD).toString('base64'),'Content-Type':'application/json'});
async function api(path,options={}) {
  const response=await fetch(base+'/api'+path,{...options,headers:{...headers(),...options.headers},redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('TRACCAR_HTTP_'+response.status);
  return response.status===204?null:response.json();
}
async function bootstrap() {
  try{await api('/devices');return;}catch{}
  const adminAuth={Authorization:'Basic '+Buffer.from(env.BOOTSTRAP_EMAIL+':'+env.BOOTSTRAP_PASSWORD).toString('base64'),'Content-Type':'application/json'};
  // Management port is private. Public access is only to OsmAnd/5055.
  await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Nexora Traccar administración',email:env.BOOTSTRAP_EMAIL,password:env.BOOTSTRAP_PASSWORD}),signal:AbortSignal.timeout(10000)});
  const server=await fetch(base+'/api/server',{headers:adminAuth,signal:AbortSignal.timeout(10000)});
  if(!server.ok)throw new Error('BOOTSTRAP_NO_ACCESS');
  const settings=await server.json();settings.registration=false;settings.readonly=false;settings.deviceReadonly=false;
  const secured=await fetch(base+'/api/server',{method:'PUT',headers:adminAuth,body:JSON.stringify(settings),signal:AbortSignal.timeout(10000)});
  if(!secured.ok)throw new Error('BOOTSTRAP_CONFIG_FAILED');
  const created=await fetch(base+'/api/users',{method:'POST',headers:adminAuth,body:JSON.stringify({name:'Nexora GPS integración',email:env.TRACCAR_EMAIL,password:env.TRACCAR_PASSWORD,administrator:false,readonly:false,deviceReadonly:false,userLimit:0,deviceLimit:-1}),signal:AbortSignal.timeout(10000)});
  if(!created.ok)throw new Error('BOOTSTRAP_USER_FAILED');
  await api('/devices');
}
async function source(value) {
  connected=value;checkedAt=new Date().toISOString();
  await pool.query("INSERT INTO nexora.tracking_source_state VALUES('TRACCAR',$1,$2) ON CONFLICT(source) DO UPDATE SET connected=excluded.connected,checked_at=excluded.checked_at",[value?1:0,checkedAt]);
}
async function savePosition(value) {
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query("SET LOCAL search_path TO nexora,pg_catalog");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('nexora-commands:nexora'))");
    const sql=s=>{let i=0;return s.replace(/\?/g,()=>'$'+(++i));};
    const store={transaction:async f=>f(),one:async(s,...p)=>(await client.query(sql(s),p)).rows[0],run:async(s,...p)=>({changes:(await client.query(sql(s),p)).rowCount})};
    await ingestTraccarPosition(store,value);
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
async function session() {
  const response=await fetch(base+'/api/session',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({email:env.TRACCAR_EMAIL,password:env.TRACCAR_PASSWORD}),signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('TRACCAR_LOGIN_FAILED');
  cookie=response.headers.get('set-cookie')?.split(';')[0]??'';
  if(!cookie)throw new Error('TRACCAR_SESSION_MISSING');
}
async function stream() {
  await session();
  const ws=new WebSocket(base.replace('http:','ws:')+'/api/socket',{headers:{Cookie:cookie}});
  let chain=Promise.resolve();
  let heartbeat;
  const finished=new Promise((resolve,reject)=>{
    const finish=()=>{clearTimeout(heartbeat);resolve();};
    ws.onclose=finish;ws.onerror=()=>{clearTimeout(heartbeat);reject(new Error('TRACCAR_SOCKET'));};
    const probe=async()=>{
      if(stopping){ws.close();return;}
      try{
        // Recovery also covers a provider event missed while the WebSocket was unavailable.
        const positions=await api('/positions');
        if(!Array.isArray(positions)||positions.length>10000)throw new Error('TRACCAR_POSITIONS_INVALID');
        for(const p of positions)await savePosition(p);
        await source(true);
      }catch{await source(false).catch(()=>{});ws.close();return;}
      heartbeat=setTimeout(probe,30000);
    };
    ws.onopen=()=>{void probe();};
    ws.onmessage=event=>{
      if(typeof event.data!=='string'||event.data.length>2_000_000){ws.close();return;}
      chain=chain.then(async()=>{const message=JSON.parse(event.data);if(message.positions){if(!Array.isArray(message.positions)||message.positions.length>10000)throw new Error('BAD_POSITIONS');for(const p of message.positions)await savePosition(p);}}).catch(()=>{ws.close();});
    };
  });
  await finished;await chain;
}
function authorized(request) {
  const supplied=Buffer.from(request.headers.get('Authorization')??''),expected=Buffer.from('Bearer '+env.GATEWAY_SECRET);
  return supplied.length===expected.length&&timingSafeEqual(supplied,expected);
}
const server=Bun.serve({port:Number(env.PORT??3000),hostname:'0.0.0.0',maxRequestBodySize:4096,async fetch(request){
  const url=new URL(request.url);
  const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
  if(url.pathname==='/health')return reply({status:'ok',upstream:connected?'connected':'connecting'});
  if(!authorized(request))return reply({error:'Unauthorized'},401);
  if(url.pathname==='/diagnostics')return reply({connected,checkedAt});
  if(/^\/devices\/\d+$/.test(url.pathname)&&request.method==='DELETE'){
    try{
      const id=url.pathname.split('/').pop(),body=await request.json();
      const device=(await pool.query('SELECT org_id FROM nexora.traccar_devices WHERE device_id=$1',[id])).rows[0];
      if(!device||device.org_id!==body.orgId)return reply({error:'Not found'},404);
      if((await pool.query('SELECT vehicle_id FROM nexora.traccar_vehicle_bindings WHERE device_id=$1',[id])).rows.length)return reply({error:'Device still assigned'},409);
      await api('/devices/'+id,{method:'DELETE'});
      return reply({removed:true});
    }catch{return reply({error:'No se pudo retirar el dispositivo'},502);}
  }
  if(url.pathname==='/devices'&&request.method==='POST'){
    try{
      const body=await request.json();
      if(!/^[a-f0-9-]{36}$/i.test(body.commandId)||!/^[a-f0-9-]{36}$/i.test(body.orgId)||typeof body.name!=='string'||!body.name.trim()||body.name.length>80)return reply({error:'Invalid input'},400);
      if(!(await pool.query('SELECT id FROM nexora.organizations WHERE id=$1',[body.orgId])).rows.length)return reply({error:'Organization not found'},404);
      const uniqueId='NX-'+body.commandId.replaceAll('-','');
      const previous=(await pool.query('SELECT * FROM nexora.traccar_devices WHERE unique_id=$1',[uniqueId])).rows[0];
      if(previous){if(previous.org_id!==body.orgId||previous.name!==body.name)return reply({error:'Conflict'},409);return reply({id:previous.device_id,identifier:previous.unique_id,name:previous.name,phoneUrl:env.PHONE_URL});}
      // Exact identifier makes a timeout/retry recover the same provider device.
      const devices=await api('/devices');
      let device=devices.find(d=>d.uniqueId===uniqueId);
      if(!device)device=await api('/devices',{method:'POST',body:JSON.stringify({name:body.name,uniqueId})});
      await pool.query('INSERT INTO nexora.traccar_devices(device_id,org_id,unique_id,name,created_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(device_id) DO NOTHING',[String(device.id),body.orgId,uniqueId,body.name]);
      const saved=(await pool.query('SELECT * FROM nexora.traccar_devices WHERE device_id=$1',[String(device.id)])).rows[0];
      if(saved?.org_id!==body.orgId)return reply({error:'Conflict'},409);
      return reply({id:String(device.id),identifier:uniqueId,name:body.name,phoneUrl:env.PHONE_URL});
    }catch{return reply({error:'No se pudo registrar el dispositivo'},502);}
  }
  return reply({error:'Not found'},404);
}});
async function run(){let failures=0;while(!stopping){try{await bootstrap();failures=0;await stream();}catch{failures++;console.error('GPS temporalmente desconectado; se reintentará');}await source(false).catch(()=>{});await pause(Math.min(30000,1000*2**Math.min(failures,5)));}}
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopping=true;void source(false).finally(async()=>{server.stop(true);await pool.end();process.exit(0);});});
await run();
