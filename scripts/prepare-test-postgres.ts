import pg from 'pg';
import {readFileSync,readdirSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';

let connection=process.env.PG_TEST_ADMIN_URL;
if(!connection&&existsSync('.local/staging/init-password'))connection=`postgresql://nexora_test:${readFileSync('.local/staging/init-password','utf8').trim()}@127.0.0.1:55439/postgres`;
if(!connection)throw new Error('Falta PG_TEST_ADMIN_URL para PostgreSQL aislado. No se usa DATABASE_URL de producción.');
const url=new URL(connection);
if(!['127.0.0.1','localhost'].includes(url.hostname))throw new Error('Las pruebas solo preparan PostgreSQL local.');
const admin=new pg.Client({connectionString:url.toString()});await admin.connect();
try{if(!(await admin.query("SELECT 1 FROM pg_database WHERE datname='nexora_test'")).rowCount)await admin.query('CREATE DATABASE nexora_test');}finally{await admin.end();}
url.pathname='/nexora_test';const db=new pg.Client({connectionString:url.toString()});await db.connect();
try{
 await db.query(`DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN;END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN;END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS;END IF;
 END $$;
 CREATE SCHEMA IF NOT EXISTS auth;CREATE SCHEMA IF NOT EXISTS extensions;
 CREATE TABLE IF NOT EXISTS auth.users(id uuid PRIMARY KEY,email text,encrypted_password text);
 CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 GRANT USAGE ON SCHEMA auth,public TO anon,authenticated,service_role;
 GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated,service_role;
 CREATE TABLE IF NOT EXISTS public.test_migrations(version text PRIMARY KEY);`);
 await db.query(readFileSync('scripts/sql/tracking-worker-role.sql','utf8'));
 for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort()){
  if((await db.query('SELECT 1 FROM public.test_migrations WHERE version=$1',[file])).rowCount)continue;
  await db.query('BEGIN');try{
   // The registration migration requires the real operator to exist. A fresh,
   // strictly local test database has no production data, so seed a test operator.
   if(file.endsWith('_individual_customer_registration.sql'))await db.query("INSERT INTO nexora.organizations(id,name,timezone) SELECT $1,'Nexora Logistic','America/Asuncion' WHERE NOT EXISTS(SELECT 1 FROM nexora.organizations WHERE lower(btrim(name))='nexora logistic')",[randomUUID()]);
   await db.query(readFileSync(`supabase/migrations/${file}`,'utf8').replace(/^\uFEFF/,''));await db.query('INSERT INTO public.test_migrations VALUES($1)',[file]);await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK');throw e;}
 }
 const password=randomBytes(32).toString('hex');
 await db.query(`ALTER ROLE nexora_runtime LOGIN PASSWORD '${password}'`);
 await db.query("INSERT INTO auth.users(id,email) SELECT $1,$2 WHERE NOT EXISTS(SELECT 1 FROM auth.users WHERE email=$2)",[randomUUID(),'nexoralogisticpy@gmail.com']);
 const runtime=new URL(url);runtime.username='nexora_runtime';runtime.password=password;
 mkdirSync('.local/staging',{recursive:true});
 writeFileSync('.local/staging/test.env',`NODE_ENV=test\nDATABASE_LOCAL_TEST=true\nDATABASE_URL=${runtime}\nPG_TEST_ADMIN_URL=${url}\n`);
 console.log(JSON.stringify({database:'nexora_test',migrations:(await db.query('SELECT COUNT(*)::int AS n FROM public.test_migrations')).rows[0].n,isolated:true}));
}finally{await db.end();}
