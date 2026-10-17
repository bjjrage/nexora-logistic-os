-- Production engine verification: every fixture and permission check rolls back.
begin;
do $$
declare org text:=gen_random_uuid()::text; actor text:=gen_random_uuid()::text;
 a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); ca uuid:=gen_random_uuid(); cb uuid:=gen_random_uuid();
 sa text:=gen_random_uuid()::text; sb text:=gen_random_uuid()::text; pa text:=gen_random_uuid()::text; pb text:=gen_random_uuid()::text;
 ea text:=gen_random_uuid()::text; eb text:=gen_random_uuid()::text;
begin
 perform set_config('portal.qa',jsonb_build_object('a',a,'b',b,'ca',ca,'cb',cb,'sa',sa,'sb',sb,'ea',ea,'eb',eb)::text,true);
 insert into nexora.organizations(id,name,timezone) values(org,'Transient portal QA','America/Asuncion');
 insert into nexora.users(id,org_id,username,name,password_hash,role) values(actor,org,'portal-qa-'||actor,'QA','unusable-fixture','ADMIN');
 insert into auth.users(id,email) values(a,'portal-a-'||a||'@example.test'),(b,'portal-b-'||b||'@example.test');
 insert into nexora.clients(id,org_id,name) values(ca::text,org,'Transient A'),(cb::text,org,'Transient B');
 insert into public.portal_companies(id,name,os_org_id,os_client_id) values(ca,'Transient A',org,ca::text),(cb,'Transient B',org,cb::text);
 insert into public.portal_memberships(user_id,company_id) values(a,ca),(b,cb);
 insert into nexora.shipments(id,org_id,client_id,reference,origin_text,destination_text,recipient_name,recipient_phone,proof_policy,created_at)
 values(sa,org,ca::text,'PORTAL-QA-A','O','D','R','','RECEIVER',now()),(sb,org,cb::text,'PORTAL-QA-B','O','D','R','','RECEIVER',now());
 insert into nexora.parcels(id,org_id,shipment_id,code,state,custody_type,custody_id)
 values(pa,org,sa,'PORTAL-QA-'||pa,'DELIVERED','RECIPIENT','R'),(pb,org,sb,'PORTAL-QA-'||pb,'IN_TRANSIT','VEHICLE','V');
 insert into nexora.evidence(id,org_id,parcel_id,actor_id,filename,mime_type,data,sha256,created_at)
 values(ea,org,pa,actor,'qa.png','image/png',decode('010203','hex'),'qa',now()),(eb,org,pb,actor,'qa.png','image/png',decode('040506','hex'),'qa',now());
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('portal.qa')::jsonb->>'a',true);
do $$
declare ids jsonb:=current_setting('portal.qa')::jsonb; data jsonb;
begin
 data:=public.portal_dashboard();
 assert jsonb_array_length(data->'shipments')=1,'A shipment isolation';
 assert data->'shipments'->0->>'reference'='PORTAL-QA-A','A tenant';
 assert public.portal_document(ids->>'eb') is null,'Cross-tenant evidence';
 assert public.portal_document(ids->>'ea')->>'base64'='AQID','Actual document bytes';
 assert (select count(*) from nexora.parcels)=1,'Direct parcel RLS';
 insert into public.portal_shipping_requests(id,company_id,reference,origin_text,destination_text,recipient_name,parcel_count)
 values(gen_random_uuid(),(ids->>'ca')::uuid,'QA request','O','D','R',1);
 begin
  insert into public.portal_shipping_requests(id,company_id,reference,origin_text,destination_text,recipient_name,parcel_count)
  values(gen_random_uuid(),(ids->>'cb')::uuid,'FORGED','O','D','R',1);
  raise exception 'Tenant forgery accepted';
 exception when insufficient_privilege then null; end;
 begin
  update public.portal_shipping_requests set status='ACCEPTED';
  raise exception 'Customer status mutation accepted';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('portal.qa')::jsonb->>'b',true);
do $$
declare ids jsonb:=current_setting('portal.qa')::jsonb; data jsonb;
begin
 data:=public.portal_dashboard();assert data->'shipments'->0->>'reference'='PORTAL-QA-B','B tenant';
 assert jsonb_array_length(data->'requests')=0,'Cross-tenant requests';
 assert public.portal_document(ids->>'ea') is null,'B cannot read A evidence';
end $$;
reset role;
update public.portal_memberships set status='suspended' where user_id=(current_setting('portal.qa')::jsonb->>'a')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('portal.qa')::jsonb->>'a',true);
do $$ begin
 assert (select count(*) from nexora.shipments)=0,'Suspension immediately removes reads';
 begin perform public.portal_dashboard();raise exception 'Suspended dashboard accepted';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
