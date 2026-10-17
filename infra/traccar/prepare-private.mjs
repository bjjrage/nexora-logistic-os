import {randomBytes} from 'node:crypto';
import {mkdirSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
mkdirSync('.local/traccar',{recursive:true});
const path='.local/traccar/secrets.json';
if(!existsSync(path))writeFileSync(path,JSON.stringify(Object.fromEntries(['mysqlRoot','mysqlPassword','gatewaySecret','adminPassword','integrationPassword','workerPassword'].map(key=>[key,randomBytes(32).toString('hex')]))));
loadEnvFile('.env');
const secrets=JSON.parse(readFileSync(path,'utf8'));
const url=new URL(process.env.DATABASE_URL);
url.username=url.hostname.endsWith('.pooler.supabase.com')?'nexora_tracking_worker.pnaqjenemmfydetkpokk':'nexora_tracking_worker';url.password=secrets.workerPassword;
for(const key of ['sslmode','sslcert','sslkey','sslrootcert'])url.searchParams.delete(key);
writeFileSync('.local/traccar/worker-private.json',JSON.stringify({DATABASE_URL:url.toString(),PG_CA:readFileSync('server/certs/supabase-prod-ca-2021.crt','utf8'),GATEWAY_SECRET:secrets.gatewaySecret,
  TRACCAR_INTERNAL_URL:'http://nexora-traccar.railway.internal:8082',TRACCAR_EMAIL:'gps-integration@nexora.invalid',TRACCAR_PASSWORD:secrets.integrationPassword,
  BOOTSTRAP_EMAIL:'gps-admin@nexora.invalid',BOOTSTRAP_PASSWORD:secrets.adminPassword,PORT:'3000'}));
console.log('Credenciales de Traccar creadas en configuración privada.');
