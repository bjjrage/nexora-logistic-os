import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function packageManual(root:string){
 let html=readFileSync(resolve(root,'MANUAL_MAESTRO_NEXORA_OS.html'),'utf8');
 for(const asset of ['manual/manual.css','manual/workflows.css']){
  const css=readFileSync(resolve(root,asset),'utf8');
  html=html.replace(`<link rel="stylesheet" href="${asset}">`,`<style data-source="${asset}">${css}</style>`);
 }
 const scripts=['manual/lessons.js','manual/workflows.js','manual/manual.js'];
 // Inline scripts must run after the document exists. The online manual keeps
 // its external scripts so it continues to work with the production CSP.
 for(const asset of scripts)html=html.replace(`<script src="${asset}" defer></script>`,'');
 html=html.replace('</body>',scripts.map(asset=>`<script data-source="${asset}">${readFileSync(resolve(root,asset),'utf8').replace(/<\/script/gi,'<\\/script')}</script>`).join('\n')+'\n</body>');
 writeFileSync(resolve(root,'MANUAL_WORKFLOWS_NEXORA_PORTATIL.html'),html);
 return 'MANUAL_WORKFLOWS_NEXORA_PORTATIL.html';
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log('Manual autocontenido: '+packageManual(process.cwd()));
