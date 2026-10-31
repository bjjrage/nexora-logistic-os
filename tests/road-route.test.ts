import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {roadRoute} from '../server/routing-providers.ts';
test('OSRM route preserves ordered waypoints, requests full GeoJSON and rejects incomplete road responses',async t=>{
 const saved=process.env.ROUTING_OSRM_URL;let fail=false;
 const server=createServer((req,res)=>{
  assert.equal(req.url,'/route/v1/driving/-57.6,-25.3;-57.61,-25.31;-57.6,-25.3?overview=full&geometries=geojson&steps=false&alternatives=false');
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:'Ok',routes:[{distance:10000,duration:120.5,geometry:{type:'LineString',coordinates:[[-57.6,-25.3],[-57.61,-25.31],[-57.6,-25.3]]},legs:fail?[]:[{distance:5000,duration:60},{distance:5000,duration:60.5}]}]}));
 }).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 t.after(async()=>{if(saved===undefined)delete process.env.ROUTING_OSRM_URL;else process.env.ROUTING_OSRM_URL=saved;await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();});});
 process.env.ROUTING_OSRM_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const points=[{latitude:-25.3,longitude:-57.6},{latitude:-25.31,longitude:-57.61},{latitude:-25.3,longitude:-57.6}];
 const road=await roadRoute(points);assert.equal(road.distanceMeters,10000);assert.equal(road.drivingSeconds,121);assert.equal(road.legs.length,2);fail=true;await assert.rejects(roadRoute(points),{code:'ROUTING_UNAVAILABLE'});
});
