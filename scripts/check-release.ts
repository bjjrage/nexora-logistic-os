import {execFileSync} from 'node:child_process';
const root=process.cwd().replaceAll('\\','/');
const git=(...args:string[])=>execFileSync('git',['-c',`safe.directory=${root}`,...args],{encoding:'utf8'}).trim();
const local=git('rev-parse','HEAD'),remote=git('ls-remote','origin','refs/heads/main').split(/\s/)[0];
const clean=git('status','--porcelain').length===0;
const origin=new URL(process.env.OS_PUBLIC_URL??'https://nexora-logistic-production.up.railway.app');
if(origin.protocol!=='https:')throw new Error('OS_PUBLIC_URL requiere HTTPS.');
let online:string|null=null,ready=false;
try{
 const [version,health]=await Promise.all(['/api/version','/api/ready'].map(path=>fetch(new URL(path,origin),{signal:AbortSignal.timeout(15000),redirect:'error'})));
 if(version.ok)online=(await version.json()).release;
 ready=health.ok&&(await health.json()).status==='ready';
}catch{}
const synchronized=clean&&local===remote&&local===online&&ready;
console.log(JSON.stringify({local,github:remote,online,workingTreeClean:clean,ready,synchronized},null,2));
if(!synchronized)process.exitCode=1;
