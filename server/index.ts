import { resolve } from 'node:path';
import { Store } from './db.ts';
import { createApp } from './app.ts';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { PostgresStore } from './postgres.ts';
import type { Database } from './database.ts';
import {Diagnostics} from './observability.ts';
import {alertingSink} from './alerts.ts';
import {seedPrivateDemo} from './demo-seed.ts';

if (existsSync('.env')) loadEnvFile('.env');
if(!process.env.RELEASE_SHA&&process.env.RAILWAY_GIT_COMMIT_SHA)process.env.RELEASE_SHA=process.env.RAILWAY_GIT_COMMIT_SHA;

const databasePath=process.env.DATABASE_PATH??resolve('.local/logistics.sqlite');
const provider=process.env.DATABASE_PROVIDER??'sqlite';
const demo=process.env.NEXORA_DEMO_MODE==='isolated';
if(process.env.NODE_ENV==='production'&&provider!=='postgres'&&!demo)throw new Error('Producción requiere PostgreSQL; no se permite una base SQLite temporal.');
if(demo&&(provider!=='sqlite'||Boolean(process.env.DATABASE_URL)))throw new Error('Demo aislada exige SQLite y ausencia de DATABASE_URL.');
// Las contraseñas de las cuentas demo se generan al sembrar los datos; el usuario no debe ingresarlas.
if(!['sqlite','postgres'].includes(provider)) throw new Error('DATABASE_PROVIDER inválido.');
const store:Database=provider==='postgres'?new PostgresStore(process.env.DATABASE_URL??'',process.env.DATABASE_SCHEMA??'nexora'):new Store(databasePath);
if(store instanceof PostgresStore) await store.verify();
if(demo) await seedPrivateDemo(store);
const port=Number(process.env.PORT??3001);
const host=process.env.HOST??'127.0.0.1';
if(!Number.isInteger(port)||port<1||port>65535) throw new Error('PORT debe ser un puerto TCP válido.');
const diagnostics=new Diagnostics(alertingSink());
const server=createApp(store,undefined,undefined,diagnostics).listen(port,host,()=>diagnostics.emit('server.started',{host,port,database:store.kind}));
const shutdown=()=>{setTimeout(()=>process.exit(1),10000).unref();server.close(async()=>{await store.close();process.exit(0);});server.closeIdleConnections();};
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
const fatal=(error:unknown)=>{diagnostics.emit('server.fatal',{errorType:error instanceof Error?error.name:'UnknownError'});server.close();setTimeout(()=>process.exit(1),1000).unref();};
process.on('uncaughtException',fatal);process.on('unhandledRejection',fatal);
