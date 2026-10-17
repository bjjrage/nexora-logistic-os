begin;
do $$
declare
 v_org text:=gen_random_uuid()::text;v_client text:=gen_random_uuid()::text;
 v_ship text:=gen_random_uuid()::text;v_other text:=gen_random_uuid()::text;
 v_code text:='B-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,20));
 v_data jsonb;
begin
 insert into nexora.organizations(id,name,timezone) values(v_org,'Temporary tracking QA','America/Asuncion');
 insert into nexora.clients(id,org_id,name) values(v_client,v_org,'Temporary private client');
 insert into nexora.shipments(id,org_id,client_id,reference,origin_text,destination_text,recipient_name,recipient_phone,proof_policy,created_at)
 values(v_ship,v_org,v_client,'Temporary A','Private origin','Private destination','Private recipient','Private phone','RECEIVER',now()),
 (v_other,v_org,v_client,'Temporary B','Other private origin','Other private destination','Other private recipient','Other private phone','RECEIVER',now());
 insert into nexora.parcels(id,org_id,shipment_id,code,state,custody_type,custody_id)
 values(gen_random_uuid()::text,v_org,v_ship,v_code,'IN_TRANSIT','VEHICLE','Private vehicle'),
 (gen_random_uuid()::text,v_org,v_other,'B-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,20)),'DELIVERED','RECIPIENT','Other private recipient');
 set local role anon;
 v_data:=public.track_order(v_code);
 if v_data is null or v_data->'counts' <> '{"IN_TRANSIT":1}'::jsonb or v_data->>'code'<>v_code then raise exception 'Tracking mismatch';end if;
 if v_data::text like '%Private%' or v_data::text like '%'||v_ship||'%' or v_data::text like '%'||v_other||'%' then raise exception 'Private information exposed';end if;
 if public.track_order('B-00000000000000000000') is not null or public.track_order(v_ship) is not null then raise exception 'Invalid lookup allowed';end if;
 reset role;
 if has_table_privilege('anon','nexora.parcels','SELECT') or has_table_privilege('anon','nexora.shipments','SELECT') then raise exception 'Anonymous table access';end if;
end;
$$;
rollback;
select 'Anonymous exact-code tracking and rollback verified' as result;
