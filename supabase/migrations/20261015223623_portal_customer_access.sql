-- Google identifies the person; Nexora assigns their company separately.
create table public.portal_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.portal_memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid not null references public.portal_companies(id),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now()
);

create index portal_memberships_company_id_idx on public.portal_memberships(company_id);
alter table public.portal_companies enable row level security;
alter table public.portal_memberships enable row level security;

revoke all on public.portal_companies, public.portal_memberships from anon, authenticated;
grant select on public.portal_companies, public.portal_memberships to authenticated;
grant all on public.portal_companies, public.portal_memberships to service_role;

create policy "Read own membership" on public.portal_memberships
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Read assigned active company" on public.portal_companies
  for select to authenticated
  using (active and exists (
    select 1 from public.portal_memberships m
    where m.company_id = portal_companies.id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  ));

comment on table public.portal_memberships is 'Administratively assigned customer access; clients cannot create or change memberships.';
