import pg from 'pg';
import {spawn} from 'node:child_process';
import {readFileSync,createReadStream,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const backup=resolve(process.argv[2]??'');
if(!process.argv[2])throw new Error('Indicar carpeta del backup privado.');
const manifest=JSON.parse(readFileSync(resolve(backup,'manifest.json'),'utf8')),dump=resolve(backup,'os.dump');
const digest=createHash('sha256');for await(const data of createReadStream(dump))digest.update(data);
assert.equal(digest.digest('hex'),manifest.sha256,'Checksum inválido; no restaurar.');
const adminURL=new URL(process.env.PG_TEST_ADMIN_URL??'');
if(!['127.0.0.1','localhost'].includes(adminURL.hostname))throw new Error('Restore permitido únicamente en PostgreSQL local aislado.');
const name=`nexora_test_restore_${Date.now()}`,admin=new pg.Client({connectionString:adminURL.toString(),connectionTimeoutMillis:10000});await admin.connect();
try{await admin.query(`CREATE DATABASE "${name}"`);}finally{await admin.end();}
adminURL.pathname='/'+name;const db=new pg.Client({connectionString:adminURL.toString()});await db.connect();
const restore=async(section:string)=>new Promise<void>((ok,fail)=>{
 const child=spawn(process.env.PG_RESTORE_BIN??'pg_restore',['--exit-on-error','--no-owner','--no-acl',`--section=${section}`,'--dbname',name,dump],{windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,PGHOST:adminURL.hostname,PGPORT:adminURL.port||'5432',PGUSER:decodeURIComponent(adminURL.username),PGPASSWORD:decodeURIComponent(adminURL.password),PGSSLMODE:'disable'}});
 let output='';child.stderr.on('data',d=>output+=d.toString());child.on('error',fail);child.on('exit',code=>code===0?ok():fail(new Error(`Restore ${section} falló (${code}): ${output}`)));
});
try{
 await db.query(`DROP SCHEMA public;CREATE SCHEMA auth;CREATE SCHEMA extensions;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,encrypted_password text);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;CREATE EXTENSION btree_gist WITH SCHEMA extensions;SET TIME ZONE 'UTC';`);
 await restore('pre-data');await restore('data');
 // Auth platform credentials are outside the OS dump. Restore only identity FK placeholders, never invent login credentials.
 await db.query(`INSERT INTO auth.users(id,email) SELECT user_id,email FROM public.portal_memberships ON CONFLICT(id) DO NOTHING;INSERT INTO auth.users(id) SELECT DISTINCT requested_by FROM public.portal_shipping_requests ON CONFLICT(id) DO NOTHING;`);
 await restore('post-data');await db.query('SET extra_float_digits=3');
 const verified=[];
 for(const table of manifest.tables){const target=`"${table.schema.replaceAll('"','""')}"."${table.name.replaceAll('"','""')}"`;const result=(await db.query(`SELECT count(*)::text AS rows,md5(COALESCE(string_agg(md5(row_to_json(t)::text),'' ORDER BY md5(row_to_json(t)::text)),'')) AS digest FROM ${target} t`)).rows[0];assert.equal(result.rows,table.rows,`${target}: count`);assert.equal(result.digest,table.digest,`${target}: data hash`);verified.push(`${table.schema}.${table.name}`);}
 const result={at:new Date().toISOString(),database:name,verifiedTables:verified.length,countsAndHashesMatch:true,sha256:manifest.sha256,authPlatformRestored:false};
 writeFileSync(resolve(backup,'restore-check.json'),JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify(result));
}finally{await db.end();}
