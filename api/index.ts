import { PostgresStore } from '../server/postgres.ts';
import { createApp } from '../server/app.ts';

// Deployment never falls back to a local/ephemeral SQLite database.
if(process.env.DATABASE_PROVIDER!=='postgres')throw new Error('El despliegue de Nexora requiere DATABASE_PROVIDER=postgres.');
const store=new PostgresStore(process.env.DATABASE_URL??'',process.env.DATABASE_SCHEMA??'nexora');
const app=createApp(store);
let verified:Promise<void>|undefined;
export default async function handler(req:Parameters<typeof app>[0],res:Parameters<typeof app>[1]){
  try{verified??=store.verify().catch(error=>{verified=undefined;throw error;});await verified;return app(req,res);}
  catch{res.statusCode=503;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:{code:'DATABASE_UNAVAILABLE',message:'La base de Nexora no está disponible o requiere una migración.'}}));}
}
