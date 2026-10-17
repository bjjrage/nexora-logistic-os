import {readFileSync} from 'node:fs';
import {PostgresStore} from '../../server/postgres.ts';
const state=JSON.parse(readFileSync('.local/traccar/live-qa.json','utf8'));
const db=new PostgresStore(process.env.DATABASE_URL);
for(const s of state.samples){const device=await db.one('SELECT unique_id FROM traccar_devices WHERE org_id=? AND device_id=?',state.org,s.device);if(!device)throw Error('QA device missing');const r=await fetch(process.env.TRACCAR_PHONE_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({id:device.unique_id,lat:String(s.latitude),lon:'-57.6',timestamp:new Date().toISOString(),accuracy:'12'})});if(!r.ok)throw Error('OsmAnd '+r.status);}
await db.close();console.log('QA synthetic positions refreshed');
