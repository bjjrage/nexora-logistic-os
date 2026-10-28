import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {packageManual} from '../scripts/package-manual.ts';

test('portable manual bundles its styles and ordered scripts after the body, without API calls or unsafe script endings',t=>{
 const root=mkdtempSync(join(tmpdir(),'nexora-manual-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'manual'));
 const styles=['manual.css','workflows.css'],scripts=['lessons.js','workflows.js','manual.js'];
 writeFileSync(join(root,'MANUAL_MAESTRO_NEXORA_OS.html'),'<html><head>'+styles.map(p=>`<link rel="stylesheet" href="manual/${p}">`).join('')+scripts.map(p=>`<script src="manual/${p}" defer></script>`).join('')+'</head><body><main id="main"></main></body></html>');
 for(const p of styles)writeFileSync(join(root,'manual',p),'body{color:red}');
 for(const p of scripts)writeFileSync(join(root,'manual',p),'window.demo="</script>";');
 const output=readFileSync(join(root,packageManual(root)),'utf8');
 assert.ok(!output.includes('src="manual/'));assert.ok(!output.includes('href="manual/'));
 assert.ok(output.indexOf('<main')<output.indexOf('<script data-source'));
 assert.ok(output.indexOf('data-source="manual/lessons.js"')<output.indexOf('data-source="manual/workflows.js"'));
 assert.ok(output.includes('<\\/script>'));
 const engine=readFileSync('manual/workflows.js','utf8');assert.doesNotMatch(engine,/\bfetch\s*\(|XMLHttpRequest|\/api\//);
});
