import {createServer,type Server} from 'node:http';
import {Store} from '../../server/db.ts';
import {createApp} from '../../server/app.ts';
const listening=(server:Server)=>new Promise<void>((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
const close=(server:Server)=>{const closed=new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));server.closeAllConnections();return closed;};
/** Own the fixtures in the Playwright worker so teardown also finishes on Windows. */
export async function startRoutingTestServer(){
 if(!process.env.ROUTING_PYTHON)throw Error('OR-Tools es obligatorio en el E2E de ruteo');
 process.env.NODE_ENV='test';delete process.env.DATABASE_URL;delete process.env.TRACCAR_GATEWAY_SECRET;process.env.TRACCAR_ENABLED='false';process.env.QUADMINDS_ENABLED='false';
 const maps=createServer((req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.url?.startsWith('/search')){const q=new URL(req.url,'http://127.0.0.1').searchParams.get('q')??'';res.end(JSON.stringify(q.startsWith('Lambar')?[{display_name:'Lambaré, Central, Paraguay',place_rank:16,lat:-25.3455354,lon:-57.6261456}]:q.includes('Centro')?[]:[{display_name:'Avenida Mariscal Estigarribia, San Lorenzo, Paraguay',place_rank:26,lat:-25.3443204,lon:-57.5145034,boundingbox:[-25.35,-25.34,-57.52,-57.51]}]));}
  else if(req.url?.startsWith('/route/')){const coordinates=req.url.split('/driving/')[1].split('?')[0].split(';').map(p=>p.split(',').map(Number));res.end(JSON.stringify({code:'Ok',routes:[{distance:12500,duration:600,geometry:{type:'LineString',coordinates},legs:coordinates.slice(1).map(()=>({distance:12500/(coordinates.length-1),duration:600/(coordinates.length-1)}))}]}));}
  else{const n=(req.url?.split('/driving/')[1]?.split('?')[0]??'').split(';').length;res.end(JSON.stringify({code:'Ok',durations:Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i===j?0:60))}));}
 }).listen(0,'127.0.0.1');await listening(maps);
 const port=(maps.address() as {port:number}).port;process.env.ROUTING_OSRM_URL=`http://127.0.0.1:${port}`;process.env.ROUTING_NOMINATIM_URL=process.env.ROUTING_OSRM_URL;
 const store=new Store(':memory:'),server=createApp(store).listen(0,'127.0.0.1');await listening(server);
 return {origin:`http://127.0.0.1:${(server.address() as {port:number}).port}`,close:async()=>{await close(server);await close(maps);await store.close();}};
}
