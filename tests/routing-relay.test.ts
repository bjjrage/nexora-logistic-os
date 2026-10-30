import test from 'node:test';
import assert from 'node:assert/strict';
import {relayRouting} from '../server/routing-relay.ts';
import type {Actor} from '../server/auth.ts';
const actor:Actor={id:'qa',orgId:'qa',name:'QA',role:'ADMIN',driverId:null};
const req={method:'POST',body:{address:'Asunción'},headers:{cookie:'other=private; logistics_session='+'a'.repeat(64)}};
test('local routing uses the existing session and does not forward unrelated cookies',async()=>{
 let called=false;const fetcher:typeof fetch=async(url,init)=>{called=true;assert.equal(String(url),'https://os.example/api/routing/search');const headers=new Headers(init?.headers);assert.equal(headers.get('Cookie'),'logistics_session='+'a'.repeat(64));assert.equal(headers.get('Origin'),'https://os.example');assert.equal(headers.get('X-Requested-With'),'logistics-os');assert.equal(init?.body,JSON.stringify(req.body));return Response.json([{latitude:-25,longitude:-57}]);};
 assert.deepEqual(await relayRouting(req,actor,'postgres','/search','https://os.example',fetcher),[{latitude:-25,longitude:-57}]);assert.equal(called,true);
 await assert.rejects(relayRouting(req,{...actor,role:'CUSTOMER'},'postgres','/search','https://os.example',fetcher),{code:'FORBIDDEN'});
 await assert.rejects(relayRouting(req,actor,'sqlite','/search','https://os.example',fetcher),{code:'ROUTING_CONFIGURATION'});
 await assert.rejects(relayRouting(req,actor,'postgres','/search','http://os.example',fetcher),{code:'ROUTING_CONFIGURATION'});
 await assert.rejects(relayRouting({...req,headers:{}},actor,'postgres','/search','https://os.example',fetcher),{code:'UNAUTHORIZED'});
});
