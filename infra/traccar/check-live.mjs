import {readFileSync} from 'node:fs';
const {gatewaySecret}=JSON.parse(readFileSync('.local/traccar/secrets.json','utf8'));
const gateway='https://nexora-gps-bridge-production.up.railway.app';
for(const path of ['/health','/diagnostics']){
 const response=await fetch(gateway+path,{headers:path==='/diagnostics'?{Authorization:'Bearer '+gatewaySecret}:{},signal:AbortSignal.timeout(15000)});
 console.log(path,response.status,await response.text());
}
const denied=await fetch(gateway+'/devices',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)});console.log('Dispositivos sin autorización:',denied.status);
