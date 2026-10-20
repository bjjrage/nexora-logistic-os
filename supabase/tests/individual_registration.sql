begin;
do $$
declare v_user uuid;v_profile jsonb;v_second jsonb;v_client text;v_request uuid:=gen_random_uuid();
begin
 select u.id into v_user from auth.users u where u.email_confirmed_at is not null
 and exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='google')
 and not exists(select 1 from public.portal_memberships m where m.user_id=u.id)
 order by u.created_at limit 1;
 if v_user is null then raise exception 'A verified unmapped account is required for this rollback-only check';end if;
 perform set_config('request.jwt.claim.sub',v_user::text,true);
 set local role authenticated;
 v_profile:=public.register_individual_customer('Temporary registration QA','+595981000000',true);
 v_second:=public.register_individual_customer('Temporary registration QA','+595981000000',true);
 if v_profile is null or v_profile->>'company_id'<>v_second->>'company_id' then raise exception 'Registration was not idempotent';end if;
 if (select count(*) from public.individual_customers where user_id=v_user)<>1 then raise exception 'Own profile was not readable';end if;
 insert into public.portal_shipping_requests(id,company_id,reference,origin_text,destination_text,recipient_name,parcel_count)
 values(v_request,(v_profile->>'company_id')::uuid,'Temporary signup request','Temporary origin','Temporary destination','Temporary recipient',1);
 if public.portal_dashboard()->'company'->>'id'<>v_profile->>'company_id' then raise exception 'Dashboard tenant mismatch';end if;
 reset role;
 select client_id into v_client from public.individual_customers where user_id=v_user;
 if not has_table_privilege('nexora_runtime','nexora.client_profiles','SELECT') or not has_table_privilege('nexora_runtime','public.portal_shipping_requests','SELECT') then raise exception 'OS reader privileges missing';end if;
 if not exists(select 1 from nexora.client_profiles where client_id=v_client and phone='+595981000000') then raise exception 'OS contact profile missing';end if;
 if not exists(select 1 from public.portal_shipping_requests r join public.portal_companies c on c.id=r.company_id where r.id=v_request and c.os_client_id=v_client) then raise exception 'OS request queue missing';end if;
 reset role;
end$$;
rollback;
select 'Verified Google identity -> individual client -> service request -> OS queue, rolled back' as result;
