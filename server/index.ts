import { resolve } from 'node:path';
import { Store } from './db.ts';
import { createApp } from './app.ts';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { PostgresStore } from './postgres.ts';
import type { Database } from './database.ts';

if (existsSync('.env')) loadEnvFile('.env');

const databasePath=process.env.DATABASE_PATH??resolve('.local/logistics.sqlite');
const provider=process.env.DATABASE_PROVIDER??'sqlite';
if(!['sqlite','postgres'].includes(provider)) throw new Error('DATABASE_PROVIDER inválido.');
const store:Database=provider==='postgres'?new PostgresStore(process.env.DATABASE_URL??'',process.env.DATABASE_SCHEMA??'nexora'):new Store(databasePath);
if(store instanceof PostgresStore) await store.verify();
const port=Number(process.env.PORT??3001);
const server=createApp(store).listen(port,'127.0.0.1',()=>console.log(`Nexora OS: http://127.0.0.1:${port} · ${store.kind==='postgres'?'Supabase PostgreSQL':'SQLite local'}`));
const shutdown=()=>server.close(async()=>{await store.close();process.exit(0);});
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
