import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ensure,DomainError} from './errors.ts';
export type Point={latitude:number;longitude:number};
export type RoadRoute={distanceMeters:number;drivingSeconds:number;geometry:{type:'LineString';coordinates:number[][]};legs:{distanceMeters:number;drivingSeconds:number}[]};
/** Preserve the approved stop order: OSRM route, never trip/optimization. */
export async function roadRoute(points:Point[]):Promise<RoadRoute>{
 ensure(points.length>=2&&points.length<=162,'PLAN_LIMIT','El recorrido admite hasta 160 paradas.');
 const base=service('ROUTING_OSRM_URL');base.pathname=base.pathname.replace(/\/$/,'')+'/route/v1/driving/'+points.map(p=>`${p.longitude},${p.latitude}`).join(';');base.search='overview=full&geometries=geojson&steps=false&alternatives=false';
 const result=await json(base),route=result.routes?.[0],finite=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
 ensure(result.code==='Ok'&&route&&finite(route.distance)&&finite(route.duration)&&route.geometry?.type==='LineString'&&Array.isArray(route.geometry.coordinates)&&route.geometry.coordinates.length>=2&&route.geometry.coordinates.length<=250000&&route.geometry.coordinates.every((p:any)=>Array.isArray(p)&&p.length>=2&&Number.isFinite(p[0])&&Math.abs(p[0])<=180&&Number.isFinite(p[1])&&Math.abs(p[1])<=90)&&Array.isArray(route.legs)&&route.legs.length===points.length-1&&route.legs.every((l:any)=>finite(l.distance)&&finite(l.duration)),'ROUTING_UNAVAILABLE','No se pudo obtener el trazado por calles. Reintentá; las reservas y las rutas se conservan.',503);
 return {distanceMeters:route.distance,drivingSeconds:Math.ceil(route.duration),geometry:route.geometry,legs:route.legs.map((l:any)=>({distanceMeters:l.distance,drivingSeconds:Math.ceil(l.duration)}))};
}
export type RoutingProviders={matrix:(points:Point[])=>Promise<number[][]>;solve:(model:any)=>Promise<any>;search:(address:string)=>Promise<any[]>};
async function json(url:URL){
 try{const response=await fetch(url,{signal:AbortSignal.timeout(15000),headers:{'User-Agent':'Nexora-Routing/1.0'}});ensure(response.ok,'ROUTING_UNAVAILABLE','El servicio de mapas no respondió.',503);return await response.json();}
 catch(error){if(error instanceof DomainError)throw error;throw new DomainError('ROUTING_UNAVAILABLE','No se pudo consultar el servicio de mapas. Reintentá sin modificar la reserva.',503);}
}
function service(name:string){const value=process.env[name];ensure(value,'ROUTING_NOT_CONFIGURED',`Falta configurar ${name} en el servidor.`,503);const url=new URL(value);ensure(['http:','https:'].includes(url.protocol),'ROUTING_NOT_CONFIGURED','Dirección del servicio inválida.',503);return url;}
export function solveLocal(model:any):Promise<any>{
 return new Promise((resolve,reject)=>{
  const child=spawn(process.env.ROUTING_PYTHON??'python3',[fileURLToPath(new URL('./routing-solver.py',import.meta.url))],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  let output='',failed=false;const fail=()=>{if(!failed){failed=true;child.kill();reject(new DomainError('ROUTING_UNAVAILABLE','El optimizador OR-Tools no está disponible. No se modificó el stock.',503));}};
  const timer=setTimeout(fail,15000);child.on('error',fail);child.stdout.on('data',data=>{output+=data;if(output.length>1000000)fail();});child.stderr.resume();
  child.on('close',code=>{clearTimeout(timer);if(failed)return;if(code!==0)return fail();try{resolve(JSON.parse(output));}catch{fail();}});
  child.stdin.on('error',fail);child.stdin.end(JSON.stringify(model));
 });
}
export const routingProviders:RoutingProviders={
 async matrix(points){
  const base=service('ROUTING_OSRM_URL');base.pathname=base.pathname.replace(/\/$/,'')+'/table/v1/driving/'+points.map(p=>`${p.longitude},${p.latitude}`).join(';');base.search='annotations=duration';
  const result=await json(base);ensure(result.code==='Ok'&&Array.isArray(result.durations)&&result.durations.length===points.length,'ROUTING_UNAVAILABLE','OSRM no devolvió una matriz válida.',503);
  ensure(result.durations.every((row:any)=>Array.isArray(row)&&row.length===points.length&&row.every((n:any)=>typeof n==='number'&&Number.isFinite(n)&&n>=0)),'UNREACHABLE_DESTINATION','Hay destinos sin conexión por carretera. Revisá sus puntos antes de planificar.');
  return result.durations.map((row:number[])=>row.map(n=>Math.ceil(n)));
 },solve:solveLocal,
 async search(address){
  const url=service('ROUTING_NOMINATIM_URL');url.pathname=url.pathname.replace(/\/$/,'')+'/search';url.search=new URLSearchParams({q:address,format:'jsonv2',limit:'5',countrycodes:'py','accept-language':'es'}).toString();
  const rows=await json(url);ensure(Array.isArray(rows),'ROUTING_UNAVAILABLE','Respuesta inválida del buscador de direcciones.',503);
  return rows.map((p:any)=>({name:p.display_name,latitude:Number(p.lat),longitude:Number(p.lon),addressRank:Number(p.place_rank??0),type:p.type,...(Array.isArray(p.boundingbox)&&p.boundingbox.length===4&&p.boundingbox.every((n:any)=>Number.isFinite(Number(n)))?{bounds:p.boundingbox.map(Number)}:{})})).filter((p:Point)=>Number.isFinite(p.latitude)&&Number.isFinite(p.longitude));
 }
};
