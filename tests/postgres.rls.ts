import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
test('isolated PostgreSQL: direct portal RLS denies foreign tenants, membership escalation and sensitive tables; SECURITY DEFINER boundaries',async()=>{
 const url=new URL(process.env.PG_TEST_ADMIN_URL??'');assert.ok(['127.0.0.1','localhost'].includes(url.hostname)&&url.pathname==='/nexora_test','Never run owner-level RLS fixtures against production');
 const db=new pg.Client({connectionString:url.toString()});await db.connect();
 const a=randomUUID(),b=randomUUID(),ca=randomUUID(),cb=randomUUID(),ra=randomUUID(),rb=randomUUID();
 try{
 await db.query('BEGIN');
 await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2),($3,$4)',[a,'rls-a@example.test',b,'rls-b@example.test']);
 await db.query('INSERT INTO public.portal_companies(id,name) VALUES($1,$2),($3,$4)',[ca,'QA A',cb,'QA B']);
 await db.query('INSERT INTO public.portal_memberships(user_id,company_id,email) VALUES($1,$2,$3),($4,$5,$6)',[a,ca,'rls-a@example.test',b,cb,'rls-b@example.test']);
 await db.query(`INSERT INTO public.portal_shipping_requests(id,company_id,requested_by,reference,origin_text,destination_text,recipient_name,parcel_count) VALUES($1,$2,$3,'QA-A','A','B','QA',1),($4,$5,$6,'QA-B','A','B','QA',1)`,[ra,ca,a,rb,cb,b]);
 const definer=(await db.query(`SELECT n.nspname,p.proname,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') AS anon FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prosecdef AND n.nspname IN('nexora','public','tracking_private')`)).rows;
 assert.ok(definer.length>0);for(const fn of definer){assert.ok(fn.proconfig?.some((v:string)=>v.startsWith('search_path=')),`Pinned search_path: ${fn.proname}`);if(fn.anon)assert.ok(['lookup_public_tracking','lookup_public_gps'].includes(fn.proname),'Only intentional bearer-code lookups may be anonymous SECURITY DEFINER');}
 await db.query('SET LOCAL ROLE authenticated');await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[b]);
 assert.deepEqual((await db.query('SELECT id FROM public.portal_companies')).rows.map(r=>r.id),[cb]);
 assert.deepEqual((await db.query('SELECT id FROM public.portal_shipping_requests')).rows.map(r=>r.id),[rb]);
 const denied=async(sql:string,args:unknown[]=[])=>{await db.query('SAVEPOINT denial');try{await assert.rejects(db.query(sql,args),(e:any)=>e.code==='42501');}finally{await db.query('ROLLBACK TO SAVEPOINT denial');}};
 await denied("UPDATE public.portal_memberships SET company_id=$1 WHERE user_id=$2",[ca,b]);
 await denied("UPDATE nexora.users SET role='ADMIN'");
 await denied('SELECT * FROM nexora.client_profiles');await denied('SELECT * FROM nexora.password_recovery');await denied('SELECT * FROM nexora.org_owners');
 await denied(`INSERT INTO public.portal_shipping_requests(id,company_id,reference,origin_text,destination_text,recipient_name,parcel_count) VALUES($1,$2,'QA-CROSS','A','B','QA',1)`,[randomUUID(),ca]);
 await denied(`DELETE FROM public.portal_shipping_requests WHERE id=$1`,[ra]);
 await denied("SELECT nexora.portal_registered_user('rls-a@example.test')");
 await db.query('RESET ROLE');await db.query('SET LOCAL ROLE anon');
 await denied('SELECT * FROM public.portal_memberships');await denied('SELECT * FROM nexora.org_owners');
 assert.equal((await db.query("SELECT public.track_order('B-FFFFFFFFFFFFFFFFFFFF') AS result")).rows[0].result,null);
 await db.query('RESET ROLE');await db.query('SET LOCAL ROLE nexora_runtime');
 await db.query('SELECT * FROM nexora.org_owners WHERE false');
 await denied('DELETE FROM nexora.org_owners WHERE false');
 await denied("UPDATE nexora.org_owners SET user_id=user_id WHERE false");
 }finally{await db.query('ROLLBACK');await db.end();}
});
