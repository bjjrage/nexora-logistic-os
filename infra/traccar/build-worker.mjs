import { transform } from 'esbuild';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
await mkdir('.local/traccar',{recursive:true});
const core=(await readFile('server/traccar-position.ts','utf8')).replace(/^import type[^\n]+\n/,'');
const worker=(await readFile('infra/traccar/worker.ts','utf8')).replace("import { ingestTraccarPosition } from '../../server/traccar-position.ts';",core);
const result=await transform(worker,{loader:'ts',format:'esm',target:'esnext'});
await writeFile('.local/traccar/worker.js',result.code);
console.log('Worker Traccar empaquetado para Railway.');
