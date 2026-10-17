import {cpSync,mkdirSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {dirname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

export function packageVercelSite(root:string,release:string){
  if(!/^[a-f0-9]{40}$/i.test(release))throw new Error('Se requiere el SHA del código compilado.');
  root=resolve(root);const target=resolve(root,'deploy/vercel/dist');
  if(!target.startsWith(root+sep)||!target.endsWith(sep+'deploy'+sep+'vercel'+sep+'dist'))throw new Error('Destino de build inválido.');
  for(const p of ['dist/index.html','MANUAL_MAESTRO_NEXORA_OS.html','manual/manual.js'])if(!existsSync(resolve(root,p)))throw new Error('Falta compilar el OS o su guía: '+p);
  rmSync(target,{recursive:true,force:true});mkdirSync(target,{recursive:true});
  cpSync(resolve(root,'dist'),target,{recursive:true,filter:path=>!path.endsWith('.map')});
  cpSync(resolve(root,'manual'),resolve(target,'manual'),{recursive:true});
  cpSync(resolve(root,'MANUAL_MAESTRO_NEXORA_OS.html'),resolve(target,'manual.html'));
  writeFileSync(resolve(target,'release.json'),JSON.stringify({release,backend:'railway'},null,2)+'\n');
  return target;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const release=process.env.VERCEL_GIT_COMMIT_SHA??process.env.GITHUB_SHA??execFileSync('git',['-c',`safe.directory=${root.replaceAll('\\','/')}`,'rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  packageVercelSite(root,release);console.log(JSON.stringify({staticOS:true,manual:true,release,backend:'railway',secretsCopied:false}));
}
