import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { request } from 'node:https';
import { DomainError, ensure } from './errors.ts';

const blocked=new BlockList();
for(const [address,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const)blocked.addSubnet(address,prefix,'ipv4');
for(const [address,prefix] of [['::',128],['::1',128],['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20],['fc00::',7],['fe80::',10],['ff00::',8]] as const)blocked.addSubnet(address,prefix,'ipv6');
const globalV6=new BlockList();globalV6.addSubnet('2000::',3,'ipv6');
export function isPublicAddress(address:string){const family=isIP(address);return !!family&&(family===4||globalV6.check(address,'ipv6'))&&!blocked.check(address,family===4?'ipv4':'ipv6');}
export type DownloadedProof={mimeType:string;dataBase64:string};
export async function downloadQuadProof(url:string,allowedHosts:string[]):Promise<DownloadedProof>{
  const startedAt=Date.now();
  let parsed:URL;try{parsed=new URL(url);}catch{throw new DomainError('QUADMINDS_PROOF_UNAVAILABLE','El comprobante no contiene una URL válida.',502);}
  ensure(parsed.protocol==='https:'&&!parsed.username&&!parsed.password&&!parsed.port&&allowedHosts.includes(parsed.hostname.toLowerCase())&&!isIP(parsed.hostname),'QUADMINDS_PROOF_UNAVAILABLE','El host de comprobantes no está autorizado.',502);
  const addresses=await new Promise<{address:string;family:number}[]>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new DomainError('QUADMINDS_PROOF_UNAVAILABLE','La resolución del host agotó el tiempo.',502)),3000);
    lookup(parsed.hostname,{all:true}).then(result=>{clearTimeout(timer);resolve(result);},()=>{clearTimeout(timer);reject(new DomainError('QUADMINDS_PROOF_UNAVAILABLE','No se pudo resolver el host del comprobante.',502));});
  });
  ensure(addresses.length&&addresses.every(a=>isPublicAddress(a.address)),'QUADMINDS_PROOF_UNAVAILABLE','El host de comprobantes no es público.',502);
  const selected=addresses.find(a=>a.family===4)??addresses[0];
  // Pin the checked address while preserving hostname/SNI and certificate verification.
  return new Promise((resolve,reject)=>{
    const req=request(parsed,{method:'GET',agent:false,lookup:(_host,options,callback)=>{
      if(typeof options==='object'&&options.all)callback(null,[selected]);
      else (callback as (error:null,address:string,family:number)=>void)(null,selected.address,selected.family);
    }},response=>{
      if(response.statusCode!==200){response.resume();reject(new DomainError('QUADMINDS_PROOF_UNAVAILABLE','No se pudo descargar el comprobante.',502));return;}
      const mime=String(response.headers['content-type']??'').split(';')[0];
      if(!['image/png','image/jpeg','image/webp'].includes(mime)){response.destroy();reject(new DomainError('QUADMINDS_PROOF_UNAVAILABLE','El comprobante no es una imagen compatible.',502));return;}
      const chunks:Buffer[]=[];let size=0;
      response.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>5_000_000){response.destroy(new DomainError('QUADMINDS_PROOF_UNAVAILABLE','El comprobante excede el tamaño permitido.',502));return;}chunks.push(chunk);});
      response.on('error',reject);response.on('end',()=>{if(!response.complete){reject(new DomainError('QUADMINDS_PROOF_UNAVAILABLE','El comprobante está incompleto.',502));return;}resolve({mimeType:mime,dataBase64:Buffer.concat(chunks).toString('base64')});});
    });
    const deadline=setTimeout(()=>req.destroy(new DomainError('QUADMINDS_PROOF_UNAVAILABLE','La descarga del comprobante agotó el tiempo.',502)),Math.max(1,15000-(Date.now()-startedAt)));
    req.once('close',()=>clearTimeout(deadline));req.on('error',reject);req.end();
  });
}
