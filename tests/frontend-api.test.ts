import test from 'node:test';
import assert from 'node:assert/strict';
import {api} from '../frontend/api.ts';

test('solicitud que no termina cancela la conexión y devuelve timeout recuperable',async()=>{
 let aborted=false;
 const fetcher:typeof fetch=async(_url,init)=>new Promise((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>{aborted=true;reject(new Error('Aborted'));},{once:true}));
 await assert.rejects(()=>api('/api/routes',{method:'POST'},{fetcher,timeoutMs:15}),(error:any)=>error.code==='REQUEST_TIMEOUT'&&error.message.includes('guardado puede haberse completado'));
 assert.equal(aborted,true);
});

test('timeout cubre también la lectura JSON, y una respuesta posterior funciona',async()=>{
 const stalled=async()=>({ok:true,json:()=>new Promise(()=>{})}) as unknown as Response;
 await assert.rejects(()=>api('/api/bootstrap',undefined,{fetcher:stalled,timeoutMs:15}),(error:any)=>error.code==='REQUEST_TIMEOUT'&&error.message.includes('consulta'));
 const result=await api('/api/bootstrap',undefined,{fetcher:async()=>Response.json({routes:[]}),timeoutMs:100});
 assert.deepEqual(result,{routes:[]});
});

test('API mantiene la sesión y los errores de validación del servidor',async()=>{
 let request:RequestInit|undefined;
 const fetcher:typeof fetch=async(_url,init)=>{request=init;return Response.json({error:{code:'VALIDATION_ERROR',message:'El fin debe ser posterior.',details:{field:'endAt'}}},{status:400});};
 await assert.rejects(()=>api('/api/routes',{method:'POST',body:'{}'},{fetcher}),(error:any)=>error.code==='VALIDATION_ERROR'&&error.message==='El fin debe ser posterior.'&&error.details.field==='endAt');
 assert.equal(request?.credentials,'same-origin');assert.equal(request?.body,'{}');
});

test('API no presenta como confirmado un guardado con respuesta vacía',async()=>{
 await assert.rejects(()=>api('/api/routes',{method:'POST'},{fetcher:async()=>new Response('not-json',{status:200})}),(error:any)=>error.code==='INVALID_RESPONSE');
});
