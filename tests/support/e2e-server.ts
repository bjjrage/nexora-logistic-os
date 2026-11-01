import {spawn,type ChildProcess} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

const origin='http://127.0.0.1:3039';

export async function startE2EServer(){
 const child:ChildProcess=spawn(process.execPath,['scripts/e2e-server.ts'],{
  cwd:process.cwd(),
  env:{...process.env,NODE_ENV:'test',E2E_PORT:'3039'},
  stdio:['ignore','pipe','pipe'],
 });
 let output='';
 const capture=(chunk:Buffer)=>{output=(output+chunk.toString()).slice(-6000);};
 child.stdout?.on('data',capture);
 child.stderr?.on('data',capture);
 const started=Date.now();
 while(Date.now()-started<15000){
  if(child.exitCode!==null)throw new Error(`E2E server exited with ${child.exitCode}. ${output}`);
  try{
   const response=await fetch(origin+'/api/session',{signal:AbortSignal.timeout(500)});
   if(response.ok)return {origin,close:()=>stop(child)};
  }catch{}
  await delay(100);
 }
 child.kill('SIGTERM');
 throw new Error(`E2E server did not become ready within 15 seconds. ${output}`);
}

async function stop(child:ChildProcess){
 if(child.exitCode!==null)return;
 const stopped=new Promise<void>(resolve=>child.once('exit',()=>resolve()));
 child.kill('SIGTERM');
 await Promise.race([stopped,delay(5000)]);
 if(child.exitCode===null){
  child.kill('SIGKILL');
  await stopped;
 }
}
