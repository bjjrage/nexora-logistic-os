import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { loadEnvFile } from 'node:process';

const root=fileURLToPath(new URL('../',import.meta.url));
const local=resolve(root,'.local');mkdirSync(local,{recursive:true});
if(existsSync(resolve(root,'.env')))loadEnvFile(resolve(root,'.env'));
const demo=process.argv.includes('--demo');
const provider=demo?'sqlite':process.env.DATABASE_PROVIDER??'sqlite';
const statePath=resolve(local,demo?'preview-demo.json':'preview.json');
type Preview={pid:number;port:number;instanceId:string;databasePath:string;root:string};
const mode=process.argv[2]??'start';
const previous:Preview|null=existsSync(statePath)?JSON.parse(readFileSync(statePath,'utf8')):null;
const port=previous?.port??(demo?5174:5173);
async function health(targetPort:number){
  try{const identity=await fetch(`http://127.0.0.1:${targetPort}/api/preview-identity`,{signal:AbortSignal.timeout(2500)});if(identity.ok)return await identity.json();
    const r=await fetch(`http://127.0.0.1:${targetPort}/api/health`,{signal:AbortSignal.timeout(5000)});return r.ok?await r.json():null;
  }catch{return null;}
}
const observed=await health(port);
const owned=previous&&previous.root===root&&observed?.previewInstanceId===previous.instanceId;
if(mode==='status'){
  console.log(owned?`Aplicación activa: http://127.0.0.1:${port}`:'La vista previa administrada está detenida.');
}else{
  if(!['start','restart','stop'].includes(mode))throw new Error('Usá start, restart, status o stop.');
  if(owned&&mode==='start'){console.log(`Aplicación ya activa: http://127.0.0.1:${port}`);process.exit(0);}
  if(owned&&(mode==='restart'||mode==='stop')){
    process.kill(previous.pid,'SIGTERM');
    for(let i=0;i<30;i++){if(!(await health(port)))break;await delay(100);}
  }
  if(mode==='stop'){console.log(owned?'Vista previa detenida.':'No hay una vista previa propia activa para detener.');process.exit(0);}
  if(await health(port))throw new Error(`El puerto ${port} está ocupado por otro servidor; no se detuvo ningún proceso ajeno.`);
  if(!existsSync(resolve(root,'dist/index.html')))throw new Error('Ejecutá npm run build antes de iniciar la vista previa.');
  const databasePath=demo?resolve(local,'demo.sqlite'):process.env.DATABASE_PATH??resolve(local,'logistics.sqlite');
  if(demo&&!existsSync(databasePath))throw new Error('Primero ejecutá npm run seed:demo.');
  if(provider==='postgres'&&!process.env.DATABASE_URL)throw new Error('Falta la conexión privada DATABASE_URL.');
  const instanceId=randomUUID();
  const output=openSync(resolve(local,'preview.log'),'a'),errors=openSync(resolve(local,'preview-error.log'),'a');
  const child=spawn(process.execPath,[resolve(root,'server/index.ts')],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',output,errors],env:{...process.env,PORT:String(port),DATABASE_PROVIDER:provider,DATABASE_PATH:databasePath,PREVIEW_INSTANCE_ID:instanceId}});
  child.on('error',error=>{console.error(error.message);process.exitCode=1;});
  child.unref();closeSync(output);closeSync(errors);
  if(!child.pid)throw new Error('No se pudo iniciar el servidor local.');
  writeFileSync(statePath,JSON.stringify({pid:child.pid,port,instanceId,databasePath,root},null,2));
  let ready=false;
  for(let i=0;i<40;i++){const result=await health(port);if(result?.previewInstanceId===instanceId){ready=true;break;}await delay(150);}
  if(!ready)throw new Error('El servidor no confirmó el arranque. Revisá .local/preview-error.log.');
  console.log(`Aplicación activa: http://127.0.0.1:${port} · ${demo?'DEMO SQLite aislada':provider==='postgres'?'Supabase PostgreSQL':'SQLite local'}`);
  console.log('Permanece iniciada hasta npm run preview:stop.');
}
