-- Live portal: invoker functions and row policies, using the OS as source of truth.
alter table public.portal_companies
  add column os_org_id text,
  add column os_client_id text,
  add constraint portal_os_client_fk foreign key(os_client_id,os_org_id) references nexora.clients(id,org_id),
  add constraint portal_os_pair check ((os_org_id is null) = (os_client_id is null)),
  add constraint portal_os_unique unique(os_org_id,os_client_id);

create table public.portal_shipping_requests (
  id uuid primary key,
  company_id uuid not null references public.portal_companies(id),
  requested_by uuid not null default auth.uid() references auth.users(id),
  reference text not null check(char_length(btrim(reference)) between 1 and 200),
  origin_text text not null check(char_length(btrim(origin_text)) between 1 and 500),
  destination_text text not null check(char_length(btrim(destination_text)) between 1 and 500),
  recipient_name text not null check(char_length(btrim(recipient_name)) between 1 and 200),
  recipient_phone text not null default '' check(char_length(recipient_phone)<=80),
  parcel_count integer not null check(parcel_count between 1 and 200),
  status text not null default 'REQUESTED' check(status in ('REQUESTED','ACCEPTED','REJECTED')),
  shipment_id text references nexora.shipments(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index portal_requests_company_created on public.portal_shipping_requests(company_id,created_at desc);
create index portal_requests_user on public.portal_shipping_requests(requested_by);
create index portal_requests_shipment on public.portal_shipping_requests(shipment_id);
alter table public.portal_shipping_requests enable row level security;
revoke all on public.portal_shipping_requests from anon,authenticated;
grant select on public.portal_shipping_requests to authenticated;
grant insert(id,company_id,reference,origin_text,destination_text,recipient_name,recipient_phone,parcel_count) on public.portal_shipping_requests to authenticated;
create policy portal_requests_read on public.portal_shipping_requests for select to authenticated using (
 exists(select 1 from public.portal_companies c join public.portal_memberships m on m.company_id=c.id where c.id=portal_shipping_requests.company_id and c.active and m.user_id=(select auth.uid()) and m.status='active')
);
create policy portal_requests_create on public.portal_shipping_requests for insert to authenticated with check (
 requested_by=(select auth.uid()) and status='REQUESTED' and shipment_id is null and
 exists(select 1 from public.portal_companies c join public.portal_memberships m on m.company_id=c.id where c.id=portal_shipping_requests.company_id and c.active and m.user_id=(select auth.uid()) and m.status='active')
);

create function public.portal_can_read_client(p_org text,p_client text) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.portal_companies c join public.portal_memberships m on m.company_id=c.id where c.active and c.os_org_id=p_org and c.os_client_id=p_client and m.user_id=(select auth.uid()) and m.status='active');
$$;
revoke all on function public.portal_can_read_client(text,text) from public,anon;
grant execute on function public.portal_can_read_client(text,text) to authenticated;
grant usage on schema nexora to authenticated;
grant select(id,org_id,client_id,reference,origin_text,destination_text,recipient_name,recipient_phone,created_at) on nexora.shipments to authenticated;
grant select(id,org_id,shipment_id,code,state) on nexora.parcels to authenticated;
grant select(id,org_id,parcel_id,action,created_at) on nexora.custody_events to authenticated;
grant select(id,org_id,parcel_id,filename,mime_type,data,created_at) on nexora.evidence to authenticated;
create policy portal_shipments_read on nexora.shipments for select to authenticated using (public.portal_can_read_client(org_id,client_id));
create policy portal_parcels_read on nexora.parcels for select to authenticated using (
 exists(select 1 from nexora.shipments s where s.id=shipment_id and s.org_id=parcels.org_id and public.portal_can_read_client(s.org_id,s.client_id))
);
create policy portal_events_read on nexora.custody_events for select to authenticated using (
 exists(select 1 from nexora.parcels p join nexora.shipments s on s.id=p.shipment_id and s.org_id=p.org_id where p.id=parcel_id and p.org_id=custody_events.org_id and public.portal_can_read_client(s.org_id,s.client_id))
);
create policy portal_evidence_read on nexora.evidence for select to authenticated using (
 exists(select 1 from nexora.parcels p join nexora.shipments s on s.id=p.shipment_id and s.org_id=p.org_id where p.id=parcel_id and p.org_id=evidence.org_id and public.portal_can_read_client(s.org_id,s.client_id))
);

create function public.portal_dashboard() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare company public.portal_companies;
begin
 select c.* into company from public.portal_companies c join public.portal_memberships m on m.company_id=c.id
 where m.user_id=auth.uid() and m.status='active' and c.active;
 if not found then raise insufficient_privilege using message='Customer access is not active'; end if;
 return jsonb_build_object(
  'company',jsonb_build_object('id',company.id,'name',company.name,'linked',company.os_client_id is not null),
  'shipments',coalesce((select jsonb_agg(t.data order by t.created_at desc) from (
    select s.created_at,jsonb_build_object('id',s.id,'reference',s.reference,'origin',s.origin_text,'destination',s.destination_text,
      'recipient',s.recipient_name,'createdAt',s.created_at,'parcels',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'code',p.code,'state',p.state) order by p.code) from nexora.parcels p where p.shipment_id=s.id),'[]'::jsonb)) data
    from nexora.shipments s where s.org_id=company.os_org_id and s.client_id=company.os_client_id order by s.created_at desc limit 500
  )t),'[]'::jsonb),
  'documents',coalesce((select jsonb_agg(t.data order by t.created_at desc) from (
    select e.created_at,jsonb_build_object('id',e.id,'name',e.filename,'mime',e.mime_type,'createdAt',e.created_at,'reference',s.reference,'parcel',p.code) data
    from nexora.evidence e join nexora.parcels p on p.id=e.parcel_id and p.org_id=e.org_id join nexora.shipments s on s.id=p.shipment_id and s.org_id=p.org_id
    where s.org_id=company.os_org_id and s.client_id=company.os_client_id order by e.created_at desc limit 500
  )t),'[]'::jsonb),
  'requests',coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at desc) from (
    select id,reference,origin_text,destination_text,parcel_count,status,shipment_id,created_at from public.portal_shipping_requests
    where company_id=company.id order by created_at desc limit 200
  )t),'[]'::jsonb),
  'loadedAt',now(),'shipmentLimit',500,'documentLimit',500
 );
end $$;

create function public.portal_shipment_events(p_shipment_id text) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at),'[]'::jsonb) from (
  select e.id,e.action,e.created_at,p.code from nexora.custody_events e join nexora.parcels p on p.id=e.parcel_id and p.org_id=e.org_id
  where p.shipment_id=p_shipment_id order by e.created_at limit 1000
 )t;
$$;

create function public.portal_document(p_document_id text) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',id,'name',filename,'mime',mime_type,'base64',encode(data,'base64'))
 from nexora.evidence where id=p_document_id and octet_length(data)<=8388608;
$$;

revoke all on function public.portal_dashboard(),public.portal_shipment_events(text),public.portal_document(text) from public,anon;
grant execute on function public.portal_dashboard(),public.portal_shipment_events(text),public.portal_document(text) to authenticated;

-- The OS administrative API manages memberships and accepts customer requests.
grant usage on schema public,auth to nexora_runtime;
grant select(id,email) on auth.users to nexora_runtime;
grant select,insert,update on public.portal_companies,public.portal_memberships,public.portal_shipping_requests to nexora_runtime;
create policy portal_companies_runtime on public.portal_companies for all to nexora_runtime using(true) with check(true);
create policy portal_memberships_runtime on public.portal_memberships for all to nexora_runtime using(true) with check(true);
create policy portal_requests_runtime on public.portal_shipping_requests for all to nexora_runtime using(true) with check(true);
comment on function public.portal_dashboard() is 'Live OS customer data; runs with caller privileges and row-level isolation.';
