import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {packageVercelSite} from '../scripts/package-vercel-site.ts';

test('Vercel package includes OS and guide, excludes backend, secrets and source maps; records build version',t=>{
  const root=mkdtempSync(join(tmpdir(),'nexora-vercel-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  for(const p of ['dist/assets','manual','server'])mkdirSync(join(root,p),{recursive:true});
  for(const [p,body]of Object.entries({'dist/index.html':'OS','dist/assets/app.js':'app','dist/assets/app.js.map':'source map','manual/manual.js':'guide','MANUAL_MAESTRO_NEXORA_OS.html':'manual','MANUAL_WORKFLOWS_NEXORA_PORTATIL.html':'portable manual','.env':'private fixture','server/private.txt':'backend'}))writeFileSync(join(root,p),body);
  const out=packageVercelSite(root,'1'.repeat(40));
  for(const p of ['index.html','assets/app.js','manual.html','manual/manual.js','manual-portatil.html','release.json'])assert.ok(existsSync(join(out,p)),p);
  for(const p of ['.env','server','api','assets/app.js.map'])assert.equal(existsSync(join(out,p)),false,p);
  assert.equal(JSON.parse(readFileSync(join(out,'release.json'),'utf8')).release,'1'.repeat(40));
  assert.throws(()=>packageVercelSite(root,'unknown'));
});

test('Vercel routing sends API to existing HTTPS backend, keeps guide/assets separate and applies security headers',()=>{
  const config=JSON.parse(readFileSync(resolve('deploy/vercel/vercel.json'),'utf8'));
  assert.equal(config.functions,undefined);
  assert.deepEqual(config.rewrites[0],{source:'/api/:path*',destination:'https://nexora-logistic-production.up.railway.app/api/:path*'});
  const fallback=new RegExp('^'+config.rewrites.at(-1).source+'$');
  assert.equal(fallback.test('/routes'),true);
  for(const path of ['/api/ready','/assets/index.js','/manual.html','/manual-portatil.html','/manual/manual.js','/release.json'])assert.equal(fallback.test(path),false,path);
  assert.ok(config.headers[0].headers.some((h:{key:string})=>h.key==='Content-Security-Policy'));
});
