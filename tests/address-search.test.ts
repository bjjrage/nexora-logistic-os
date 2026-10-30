import test from 'node:test';
import assert from 'node:assert/strict';
import {searchAddress} from '../server/address-search.ts';
test('exact locations keep their precision and do not trigger a broader search',async()=>{
 const queries:string[]=[];const rows=await searchAddress('Palma 145, Asunción, Paraguay',async q=>{queries.push(q);return [{name:'Palma 145',latitude:-25.28,longitude:-57.63,addressRank:30}];});
 assert.equal(queries.length,1);assert.equal(rows[0].precision,'EXACT');assert.equal(rows[0].approximate,false);
});
test('a neighborhood mismatch falls back to the real street and keeps its bounds and approximation',async()=>{
 const queries:string[]=[],address='Av. Mariscal Estigarribia 1080, Centro, San Lorenzo, Paraguay';
 const rows=await searchAddress(address,async q=>{queries.push(q);return q==='Avenida Mariscal Estigarribia 1080, San Lorenzo, Paraguay'?[{name:'Avenida Mariscal Estigarribia, San Lorenzo',latitude:-25.3443,longitude:-57.5145,addressRank:26,bounds:[-25.35,-25.34,-57.52,-57.51]}]:[];});
 assert.deepEqual(queries,[address,'Avenida Mariscal Estigarribia 1080, San Lorenzo, Paraguay']);assert.equal(rows[0].precision,'STREET');assert.equal(rows[0].approximate,true);assert.equal(rows[0].latitude,-25.3443);assert.equal(rows[0].bounds.length,4);
});
test('street and city fallbacks never become exact house locations, even when a broader query matches a building',async()=>{
 const queries:string[]=[];const rows=await searchAddress('Palma 145, Centro, Asunción, Paraguay',async q=>{queries.push(q);return q==='Palma, Asunción, Paraguay'?[{latitude:-25.28,longitude:-57.63,addressRank:30}]:[];});
 assert.ok(queries.includes('Palma, Asunción, Paraguay'));assert.equal(rows[0].approximate,true);
 const area=await searchAddress('Calle inexistente 999, Barrio, San Lorenzo, Paraguay',async q=>q==='San Lorenzo, Paraguay'?[{latitude:-25.34,longitude:-57.52,addressRank:16}]:[]);
 assert.equal(area[0].precision,'AREA');assert.equal(area[0].approximate,true);
});
test('search failures do not invent a point or retry an unavailable provider',async()=>{
 assert.deepEqual(await searchAddress('Un lugar sin resultados',async()=>[]),[]);let calls=0;
 await assert.rejects(searchAddress('Palma 145, Asunción, Paraguay',async()=>{calls++;throw new Error('OFFLINE');}),/OFFLINE/);assert.equal(calls,1);
});
