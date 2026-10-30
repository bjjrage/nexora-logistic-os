type Match=Record<string,any>;
const expand=(s:string)=>s.replace(/\bAv\.?\s+/gi,'Avenida ').replace(/\bMcal\.?\s+/gi,'Mariscal ').replace(/\bGral\.?\s+/gi,'General ').replace(/\bTte\.?\s+/gi,'Teniente ').replace(/\bCnel\.?\s+/gi,'Coronel ');
const normalized=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9 ]/g,'').trim();
/** Progressively relax an address, without turning a street/city into an exact delivery pin. */
export async function searchAddress(address:string,search:(query:string)=>Promise<Match[]>):Promise<Match[]>{
 const parts=expand(address).split(',').map(p=>p.trim()).filter(Boolean),country=/^paraguay$/i.test(parts.at(-1)??''),city=parts.at(country?-2:-1);
 const variants=[address];
 const localityQuery=city?`${city}, Paraguay`:'';
 if(parts.length>=(country?3:2)&&city){
  const suffix=[city,...(country?['Paraguay']:[])].join(', ');
  const mainStreet=parts[0].split(/\s+(?:c\s*\/|esq\.?|esquina|&)\s*/i)[0].replace(/\b(?:n[°ºo.]|nro\.?|número)\s*(\d+)/gi,'$1').trim();
  variants.push(`${mainStreet}, ${suffix}`);
  const street=mainStreet.replace(/\s+(?:(?:n[°ºo.]?|nro\.?|número)\s*)?\d+[a-z]?\s*$/i,'').trim();
  variants.push(`${street}, ${suffix}`);if(/^calle\s+/i.test(street))variants.push(`${street.replace(/^calle\s+/i,'')}, ${suffix}`);variants.push(`${city}, Paraguay`);
  variants.pop();const cross=parts[0].split(/\s+(?:c\s*\/|esq\.?|esquina|&)\s*/i)[1]?.trim();if(cross)variants.push(`${cross}, ${suffix}`);
  if(parts.length>(country?3:2)){const neighborhood=parts[1].replace(/^(?:b[°º.]|barrio)\s*/i,'').trim();if(neighborhood)variants.push(`${neighborhood}, ${suffix}`);}variants.push(`${city}, Paraguay`);
 }else if(expand(address)!==address)variants.push(expand(address));
 let index=0,areaFallback:Match[]=[];
 for(const query of [...new Set(variants)]){
  const raw=await search(query),relaxed=index++>0,localityOnly=query===localityQuery;
  const rows=raw.filter(row=>{
   const names=String(row.name??'').split(',').map(normalized),rank=Number(row.addressRank??0);
   if(localityOnly)return rank<=25&&(!row.name||names[0]===normalized(city!));
   if(city&&names.length>1&&rank>=21&&!names.slice(1).includes(normalized(city)))return false;
   if(city&&names.length>1&&rank<=20&&names[0]!==normalized(city))return false;
   return true;
  });
  if(rows.length){const specific=localityOnly?[]:rows.filter(row=>Number(row.addressRank??0)>=26),selected=specific.length?specific:rows;const result:Match[]=selected.map(row=>({...row,matchedQuery:query,approximate:localityOnly||relaxed||Number(row.addressRank??0)<30,precision:localityOnly?'AREA':relaxed||Number(row.addressRank??0)<30?(Number(row.addressRank??0)>=26?'STREET':'AREA'):'EXACT'}));if(specific.length)return result;if(!areaFallback.length||Math.max(...result.map(r=>Number(r.addressRank??0)))>Math.max(...areaFallback.map(r=>Number(r.addressRank??0))))areaFallback=result;}
 }
 return areaFallback;
}
