import {ensure,DomainError} from './errors.ts';
const allowed=(url:URL)=>url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&(
 url.hostname==='maps.app.goo.gl'||url.hostname==='maps.google.com'||(['google.com','www.google.com'].includes(url.hostname)&&url.pathname.startsWith('/maps')));
function decoded(value:string){try{return decodeURIComponent(value);}catch{return value;}}
export function mapsPoint(url:URL){
 const data=decoded(url.pathname+url.search);
 const match=data.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/)
  ??(url.searchParams.get('query')??url.searchParams.get('q')??'').match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
 if(!match)return null;
 const latitude=Number(match[1]),longitude=Number(match[2]);
 ensure(Number.isFinite(latitude)&&Number.isFinite(longitude)&&Math.abs(latitude)<=90&&Math.abs(longitude)<=180,'VALIDATION_ERROR','El enlace contiene una ubicación inválida.');
 // @latitude,longitude is the camera centre, not necessarily the selected place.
 return {latitude,longitude,addressRank:30,type:'shared_pin',name:decoded(url.pathname.match(/\/place\/([^/]+)/)?.[1]?.replaceAll('+',' ')??'Lugar compartido de Google Maps')};
}
export async function resolveMapsLink(value:string,fetcher:typeof fetch=fetch){
 let url:URL;try{url=new URL(value);}catch{ensure(false,'VALIDATION_ERROR','Pegá el enlace de Compartir de Google Maps.');}
 for(let i=0;i<5;i++){
  ensure(allowed(url!),'VALIDATION_ERROR','Usá un enlace HTTPS de Google Maps.');
  const point=mapsPoint(url!);if(point)return [point];
  let response:Response;
  try{response=await fetcher(url!,{method:'HEAD',redirect:'manual',signal:AbortSignal.timeout(4000)});}catch{throw new DomainError('ROUTING_UNAVAILABLE','No pudimos abrir el enlace de Maps. Probá de nuevo o copiá el enlace completo de la ficha del lugar.',503);}
  await response.body?.cancel();
  const next=response.headers.get('location');
  if(![301,302,303,307,308].includes(response.status)||!next)break;
  url=new URL(next,url!);
 }
 ensure(false,'VALIDATION_ERROR','Ese enlace no contiene el punto exacto. Abrí la ficha del lugar en Google Maps y copiá su enlace con Compartir; no la vista general del mapa.');
}
