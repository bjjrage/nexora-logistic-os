import pg from 'pg';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,createReadStream} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

const connection=process.env.DATABASE_URL;if(!connection)throw new Error('Falta DATABASE_URL privada.');
const url=new URL(connection),local=process.env.NODE_ENV==='test'&&['127.0.0.1','localhost'].includes(url.hostname)&&url.pathname.startsWith('/nexora_test');
const ca=resolve(process.env.PGSSLROOTCERT??'server/certs/supabase-prod-ca-2021.crt');
const db=new pg.Client({connectionString:connection,connectionTimeoutMillis:10000,query_timeout:30000,ssl:local?false:{rejectUnauthorized:true,ca:readFileSync(ca,'utf8')}});await db.connect();
const schemas=['nexora','public','tracking_private'];
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),directory=resolve(process.env.BACKUP_DIR??'.local/backups',stamp);mkdirSync(directory,{recursive:true,mode:0o700});
try{
 await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 await db.query("SET LOCAL TIME ZONE 'UTC'");
 await db.query('SET LOCAL extra_float_digits=3');
 const tables=(await db.query(`SELECT n.nspname AS schema,c.relname AS name,c.relrowsecurity,
 has_table_privilege(current_user,c.oid,'SELECT') AS readable,
 EXISTS(SELECT 1 FROM pg_policy p JOIN pg_roles r ON r.oid=ANY(p.polroles) WHERE p.polrelid=c.oid AND r.rolname=current_user AND p.polcmd IN('r','*') AND pg_get_expr(p.polqual,p.polrelid)='true') AS unrestricted
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1) AND c.relkind='r' ORDER BY n.nspname,c.relname`,[schemas])).rows;
 // pg_dump --enable-row-security is only allowed after proving each table is readable without row filtering.
 // Never silently produce a partial backup because RLS hides rows.
 for(const table of tables)if(!table.readable||table.relrowsecurity&&!table.unrestricted&&!local)throw new Error(`Backup incompleto: permisos insuficientes en ${table.schema}.${table.name}`);
 const snapshot=(await db.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
 const manifest=[];
 for(const table of tables){const name=`"${table.schema.replaceAll('"','""')}"."${table.name.replaceAll('"','""')}"`;const result=(await db.query(`SELECT count(*)::text AS rows,md5(COALESCE(string_agg(md5(row_to_json(t)::text),'' ORDER BY md5(row_to_json(t)::text)),'')) AS digest FROM ${name} t`)).rows[0];manifest.push({schema:table.schema,name:table.name,...result});}
 const file=resolve(directory,'os.dump'),binary=process.env.PG_DUMP_BIN??'pg_dump';
 const args=['--format=custom','--no-owner','--no-acl','--enable-row-security',`--snapshot=${snapshot}`,`--file=${file}`,...schemas.map(s=>`--schema=${s}`)];
 await new Promise<void>((ok,fail)=>{const child=spawn(binary,args,{stdio:['ignore','ignore','pipe'],windowsHide:true,env:{...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:url.pathname.slice(1),PGSSLMODE:local?'disable':'verify-full',PGSSLROOTCERT:ca}});let error='';child.stderr.on('data',d=>{error+=d.toString();});child.once('error',fail);child.once('exit',code=>code===0?ok():fail(new Error(`pg_dump falló (${code}); no se certifica backup. ${error.replace(/postgres(?:ql)?:\/\/\S+/g,'[redacted]')}`)));});
 await db.query('COMMIT');
 const checksum=createHash('sha256');for await(const chunk of createReadStream(file))checksum.update(chunk);
 const result={createdAt:new Date().toISOString(),scope:'OS application schemas; Supabase Auth identities/storage/config require a separate platform backup',schemas,sha256:checksum.digest('hex'),tables:manifest};
 writeFileSync(resolve(directory,'manifest.json'),JSON.stringify(result,null,2),{mode:0o600});
 console.log(JSON.stringify({backup:directory,tables:manifest.length,sha256:result.sha256,completeForScope:true}));
}finally{await db.end();}
