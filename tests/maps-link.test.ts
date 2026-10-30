import test from 'node:test';
import assert from 'node:assert/strict';
import {mapsPoint,resolveMapsLink} from '../server/maps-link.ts';
test('shared Maps place resolves its pin, never the map camera centre',async()=>{
 const point=mapsPoint(new URL('https://www.google.com/maps/place/Nexora/@-25,-57,14z/data=!3d-25.31!4d-57.61'))!;
 assert.equal(point.latitude,-25.31);assert.equal(point.name,'Nexora');
 assert.equal(mapsPoint(new URL('https://www.google.com/maps/@-25,-57,14z')),null);
 assert.equal((await resolveMapsLink('https://www.google.com/maps/search/?api=1&query=-25.31%2C-57.61'))![0].longitude,-57.61);
});
test('short links expand only within Google Maps and never forward credentials',async()=>{
 let calls=0;
 const fake:typeof fetch=async(url,init)=>{calls++;assert.equal(new URL(String(url)).hostname,'maps.app.goo.gl');assert.equal(init?.redirect,'manual');assert.equal(init?.headers,undefined);return new Response(null,{status:302,headers:{location:'https://www.google.com/maps/place/Deposito/data=!3d-25.31!4d-57.61'}});};
 assert.equal((await resolveMapsLink('https://maps.app.goo.gl/example',fake))![0].name,'Deposito');assert.equal(calls,1);
 for(const value of ['https://127.0.0.1/maps','https://www.google.com.evil.test/maps','https://user:pass@www.google.com/maps','http://maps.google.com/maps'])await assert.rejects(resolveMapsLink(value,fake));
 await assert.rejects(resolveMapsLink('https://maps.app.goo.gl/example',async()=>new Response(null,{status:302,headers:{location:'http://169.254.169.254/'}})));
 await assert.rejects(resolveMapsLink('https://www.google.com/maps/@-25,-57,14z',async()=>new Response(null,{status:200})));
});
