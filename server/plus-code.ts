import {createRequire} from 'node:module';
import {ensure} from './errors.ts';
type Place={name:string;latitude:number;longitude:number;addressRank?:number};
type Codec={isFull:(code:string)=>boolean;isShort:(code:string)=>boolean;recoverNearest:(code:string,lat:number,lon:number)=>string;decode:(code:string)=>{latitudeCenter:number;longitudeCenter:number}};
const {OpenLocationCode}=createRequire(import.meta.url)('open-location-code') as {OpenLocationCode:new()=>Codec};
const codec=new OpenLocationCode();
const normalized=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export async function resolvePlusCode(value:string,search:(query:string)=>Promise<Place[]>){
 const match=value.trim().match(/^([23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{2,7})(?:\s*,?\s+|,|$)(.*)$/i);
 if(!match)return null;
 let code=match[1].toUpperCase();
 if(!codec.isFull(code)){
  ensure(codec.isShort(code),'VALIDATION_ERROR','El Plus Code no es válido.');
  const parts=match[2].split(',').map(s=>s.trim()).filter(Boolean);
  if(normalized(parts.at(-1)??'')==='paraguay')parts.pop();
  const city=parts.at(-1);
  ensure(city,'VALIDATION_ERROR','Agregá la ciudad después del Plus Code, por ejemplo: J9XG+VVH, Lambaré.');
  const places=await search(city+', Paraguay');
  const references=places.filter(p=>(p.addressRank??0)<=20&&normalized(p.name.split(',')[0])===normalized(city));
  const recovered=new Set(references.map(p=>codec.recoverNearest(code,p.latitude,p.longitude)));
  ensure(recovered.size===1,'VALIDATION_ERROR','No pudimos identificar la ciudad del Plus Code. Escribí el código seguido de la ciudad.');
  code=[...recovered][0];
 }
 const area=codec.decode(code);
 return [{name:value,latitude:area.latitudeCenter,longitude:area.longitudeCenter,addressRank:30,type:'plus_code',plusCode:code}];
}
