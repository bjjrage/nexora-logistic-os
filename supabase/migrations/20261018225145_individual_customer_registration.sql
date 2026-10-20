-- Self-service individual customers. All authorization comes from verified Auth
-- identity and server-created mappings, never from editable Google metadata.
create schema if not exists website_private;
revoke all on schema website_private from public,anon,authenticated;
create table website_private.registration_settings (
 singleton boolean primary key default true check(singleton),
 org_id text not null references nexora.organizations(id)
);
alter table website_private.registration_settings enable row level security;
revoke all on website_private.registration_settings from public,anon,authenticated;
insert into website_private.registration_settings(org_id)
 select id from nexora.organizations where lower(btrim(name))='nexora logistic'
 and (select count(*) from nexora.organizations where lower(btrim(name))='nexora logistic')=1;
do $$begin
 if not exists(select 1 from website_private.registration_settings) then
  raise exception 'Configure the website organization explicitly before enabling registration';
 end if;
end$$;

create table public.individual_customers (
 user_id uuid primary key references auth.users(id),
 org_id text not null,
 client_id text not null,
 company_id uuid not null unique references public.portal_companies(id),
 full_name text not null check(length(btrim(full_name)) between 2 and 200),
 phone text not null check(phone ~ '^\+?[0-9 ()-]{7,40}$' and length(regexp_replace(phone,'[^0-9]','','g')) between 7 and 15),
 email text not null check(length(email) between 3 and 254),
 privacy_version text not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key(client_id,org_id) references nexora.clients(id,org_id),
 unique(org_id,client_id)
);
alter table public.individual_customers enable row level security;
revoke all on public.individual_customers from public,anon,authenticated;
grant select(user_id,company_id,full_name,phone,email,privacy_version,created_at,updated_at) on public.individual_customers to authenticated;
create policy individual_read_own on public.individual_customers for select to authenticated using(user_id=(select auth.uid()));
grant select on public.individual_customers to nexora_runtime;
create policy individual_runtime_read on public.individual_customers for select to nexora_runtime using(true);

create function website_private.register_individual(p_name text,p_phone text,p_consent boolean)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
 v_user uuid:=auth.uid();v_email text;v_org text;v_client text;v_company uuid;
 v_existing public.individual_customers;v_member public.portal_memberships;
begin
 if v_user is null then raise insufficient_privilege using message='Sign in first';end if;
 select email into v_email from auth.users u where u.id=v_user and u.email_confirmed_at is not null
  and exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='google');
 if v_email is null then raise insufficient_privilege using message='Verified Google account required';end if;
 if p_consent is distinct from true or p_name is null or length(btrim(p_name)) not between 2 and 200
  or p_phone is null or p_phone !~ '^\+?[0-9 ()-]{7,40}$'
  or length(regexp_replace(p_phone,'[^0-9]','','g')) not between 7 and 15 then
  raise invalid_parameter_value using message='Check name, phone and privacy consent';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('individual-signup:'||v_user::text,0));
 select * into v_existing from public.individual_customers where user_id=v_user;
 select * into v_member from public.portal_memberships where user_id=v_user;
 if v_existing.user_id is not null then
  if v_member.user_id is null or v_member.company_id<>v_existing.company_id or v_member.status<>'active'
   or not exists(select 1 from public.portal_companies where id=v_existing.company_id and active
    and os_org_id=v_existing.org_id and os_client_id=v_existing.client_id) then
    raise insufficient_privilege using message='Account paused; contact Nexora';
  end if;
  v_org:=v_existing.org_id;v_client:=v_existing.client_id;v_company:=v_existing.company_id;
 else
  if v_member.user_id is not null then raise insufficient_privilege using message='Managed account; contact Nexora';end if;
  select org_id into strict v_org from website_private.registration_settings where singleton;
  v_client:=gen_random_uuid()::text;v_company:=gen_random_uuid();
  insert into nexora.clients(id,org_id,name) values(v_client,v_org,btrim(p_name));
  insert into nexora.client_delivery_policies(org_id,client_id,delivery_provider,updated_at) values(v_org,v_client,'NEXORA',now());
  insert into public.portal_companies(id,name,os_org_id,os_client_id) values(v_company,btrim(p_name),v_org,v_client);
  insert into public.portal_memberships(user_id,company_id,status,email) values(v_user,v_company,'active',lower(v_email));
 end if;
 insert into public.individual_customers(user_id,org_id,client_id,company_id,full_name,phone,email,privacy_version)
 values(v_user,v_org,v_client,v_company,btrim(p_name),btrim(p_phone),lower(v_email),'2026-10-18')
 on conflict(user_id) do update set full_name=excluded.full_name,phone=excluded.phone,email=excluded.email,updated_at=now();
 update nexora.clients set name=btrim(p_name) where id=v_client and org_id=v_org;
 update public.portal_companies set name=btrim(p_name) where id=v_company;
 update public.portal_memberships set email=lower(v_email) where user_id=v_user;
 insert into nexora.client_profiles(org_id,client_id,contact_name,phone,email,notes,updated_at)
 values(v_org,v_client,btrim(p_name),btrim(p_phone),lower(v_email),'Registro individual desde la web de Nexora.',now())
 on conflict(org_id,client_id) do update set contact_name=excluded.contact_name,phone=excluded.phone,email=excluded.email,updated_at=now();
 return jsonb_build_object('user_id',v_user,'company_id',v_company,'full_name',btrim(p_name),'phone',btrim(p_phone),'email',lower(v_email));
end$$;
revoke all on function website_private.register_individual(text,text,boolean) from public,anon,authenticated;
grant usage on schema website_private to authenticated;
grant execute on function website_private.register_individual(text,text,boolean) to authenticated;
create function public.register_individual_customer(p_name text,p_phone text,p_consent boolean)
returns jsonb language sql security invoker set search_path=''
as $$select website_private.register_individual(p_name,p_phone,p_consent)$$;
revoke all on function public.register_individual_customer(text,text,boolean) from public,anon,authenticated;
grant execute on function public.register_individual_customer(text,text,boolean) to authenticated;
comment on table public.individual_customers is 'Self-registered individuals, each mapped exclusively to a newly created OS client. No access to existing clients is granted by signup.';
