import {createServer} from 'node:http';
import {Store} from '../server/db.ts';
import {createApp} from '../server/app.ts';
if(process.env.NODE_ENV!=='test'||!process.env.ROUTING_PYTHON)throw new Error('Servidor de ruteo E2E solo para pruebas con OR-Tools instalado.');
delete process.env.DATABASE_URL;delete process.env.TRACCAR_GATEWAY_SECRET;
process.env.TRACCAR_ENABLED='false';process.env.QUADMINDS_ENABLED='false';
// Deterministic service doubles. OR-Tools and all operational APIs remain real.
const maps=createServer((req,res)=>{
 res.setHeader('Content-Type','application/json');
 if(req.url?.startsWith('/search'))res.end(JSON.stringify(new URL(req.url,'http://127.0.0.1').searchParams.get('q')?.startsWith('Lambar')?[{display_name:'Lambar\u00e9, Central, Paraguay',place_rank:16,lat:-25.3455354,lon:-57.6261456}]:[{display_name:'Destino QA, Paraguay',lat:-25.31,lon:-57.61}]));
 else{const n=(req.url?.split('/driving/')[1]?.split('?')[0]??'').split(';').length;res.end(JSON.stringify({code:'Ok',durations:Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i===j?0:60))}));}
}).listen(35099,'127.0.0.1');
process.env.ROUTING_OSRM_URL='http://127.0.0.1:35099';process.env.ROUTING_NOMINATIM_URL='http://127.0.0.1:35099';
const store=new Store(':memory:'),server=createApp(store).listen(3047,'127.0.0.1');
process.on('SIGTERM',()=>server.close(()=>maps.close(async()=>{await store.close();process.exit(0);})));
