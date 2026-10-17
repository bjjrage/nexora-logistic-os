import { resolve } from 'node:path';
import { Store } from './db.ts';
import { createApp } from './app.ts';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { PostgresStore } from './postgres.ts';
import type { Database } from './database.ts';
import {Diagnostics} from './observability.ts';

if (existsSync('.env')) loadEnvFile('.env');

const databasePath=process.env.DATABASE_PATH??resolve('.local/logistics.sqlite');
const provider=process.env.DATABASE_PROVIDER??'sqlite';
if(!['sqlite','postgres'].includes(provider)) throw new Error('DATABASE_PROVIDER inválido.');
const store:Database=provider==='postgres'?new PostgresStore(process.env.DATABASE_URL??'',process.env.DATABASE_SCHEMA??'nexora'):new Store(databasePath);
if(store instanceof PostgresStore) await store.verify();
const port=Number(process.env.PORT??3001);
const host=process.env.HOST??'127.0.0.1';
if(!Number.isInteger(port)||port<1||port>65535) throw new Error('PORT debe ser un puerto TCP válido.');
const diagnostics=new Diagnostics();
const server=createApp(store,undefined,undefined,diagnostics).listen(port,host,()=>diagnostics.emit('server.started',{host,port,database:store.kind}));
const shutdown=()=>server.close(async()=>{await store.close();process.exit(0);});
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
const fatal=(error:unknown)=>{diagnostics.emit('server.fatal',{errorType:error instanceof Error?error.name:'UnknownError'});server.close();setTimeout(()=>process.exit(1),1000).unref();};
process.on('uncaughtException',fatal);process.on('unhandledRejection',fatal);
