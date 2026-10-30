type Match=Record<string,any>;
const expand=(s:string)=>s.replace(/\bAv\.?\s+/gi,'Avenida ').replace(/\bMcal\.?\s+/gi,'Mariscal ').replace(/\bGral\.?\s+/gi,'General ').replace(/\bTte\.?\s+/gi,'Teniente ').replace(/\bCnel\.?\s+/gi,'Coronel ');
/** Progressively relax an address, without turning a street/city into an exact delivery pin. */
export async function searchAddress(address:string,search:(query:string)=>Promise<Match[]>):Promise<Match[]>{
 const parts=expand(address).split(',').map(p=>p.trim()).filter(Boolean),country=/^paraguay$/i.test(parts.at(-1)??''),city=parts.at(country?-2:-1);
 const variants=[address];
 if(parts.length>=(country?3:2)&&city){
  const suffix=[city,...(country?['Paraguay']:[])].join(', ');
  variants.push(`${parts[0]}, ${suffix}`);
  const street=parts[0].replace(/\s+(?:(?:n[°ºo.]?|nro\.?|número)\s*)?\d+[a-z]?\s*$/i,'').trim();
  variants.push(`${street}, ${suffix}`,`${city}, Paraguay`);
 }else if(expand(address)!==address)variants.push(expand(address));
 let index=0;
 for(const query of [...new Set(variants)]){
  const rows=await search(query);const relaxed=index++>0;
  if(rows.length)return rows.map(row=>({...row,matchedQuery:query,approximate:relaxed||Number(row.addressRank??0)<30,precision:relaxed||Number(row.addressRank??0)<30?(Number(row.addressRank??0)>=26?'STREET':'AREA'):'EXACT'}));
 }
 return [];
}
