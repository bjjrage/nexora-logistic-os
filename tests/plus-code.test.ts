import test from 'node:test';
import assert from 'node:assert/strict';
import {resolvePlusCode} from '../server/plus-code.ts';
const city={name:'Lambaré, Central, Paraguay',latitude:-25.346,longitude:-57.606,addressRank:16};
test('the Plus Code from the screenshot resolves using its city, not the street text',async()=>{
 const result=await resolvePlusCode('J9XG+VVH, San Vicente & Aca Verá, Lambaré',async query=>{assert.equal(query,'Lambaré, Paraguay');return [city];});
 assert.equal(result![0].plusCode,'5864J9XG+VVH');
 assert.ok(Math.abs(result![0].latitude-(-25.3503125))<0.000001);
 assert.ok(Math.abs(result![0].longitude-(-57.622765625))<0.000001);
});
test('full codes decode offline; short codes require an unambiguous city',async()=>{
 const full=await resolvePlusCode('5864J9XG+VVH',async()=>{throw new Error('Must not search');});assert.equal(full![0].type,'plus_code');
 await assert.rejects(resolvePlusCode('J9XG+VVH',async()=>[city]),{code:'VALIDATION_ERROR'});
 await assert.rejects(resolvePlusCode('J9XG+VVH, Lambaré',async()=>[]),{code:'VALIDATION_ERROR'});
 await assert.rejects(resolvePlusCode('J9XG+VVH, Lambaré',async()=>[city,{...city,latitude:-23}]),{code:'VALIDATION_ERROR'});
 assert.equal(await resolvePlusCode('Avenida España, Asunción',async()=>[]),null);
});
