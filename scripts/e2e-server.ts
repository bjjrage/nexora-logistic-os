import {Store} from '../server/db.ts';
import {createApp} from '../server/app.ts';
if(process.env.NODE_ENV!=='test')throw new Error('Servidor E2E solo para pruebas.');
// No .env, no real DB, no external GPS credentials. Each process starts empty.
delete process.env.DATABASE_URL;delete process.env.TRACCAR_GATEWAY_SECRET;
process.env.TRACCAR_ENABLED='false';process.env.QUADMINDS_ENABLED='false';
const store=new Store(':memory:');
const server=createApp(store).listen(3039,'127.0.0.1');
process.on('SIGTERM',()=>server.close(async()=>{await store.close();process.exit(0);}));
