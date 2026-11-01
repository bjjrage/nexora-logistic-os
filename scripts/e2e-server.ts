import {Store} from '../server/db.ts';
import {createApp} from '../server/app.ts';
if(process.env.NODE_ENV!=='test')throw new Error('Servidor E2E solo para pruebas.');
// No .env, no real DB, no external GPS credentials. Each process starts empty.
delete process.env.DATABASE_URL;delete process.env.TRACCAR_GATEWAY_SECRET;
process.env.TRACCAR_ENABLED='false';process.env.QUADMINDS_ENABLED='false';
const store=new Store(':memory:');
const port=Number(process.env.E2E_PORT??3039);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Puerto E2E invÃ¡lido.');
const server=createApp(store).listen(port,'127.0.0.1');
let closing=false;
process.on('SIGTERM',()=>{
 if(closing)return;
 closing=true;
 server.close(async()=>{await store.close();process.exit(0);});
 server.closeAllConnections();
});
