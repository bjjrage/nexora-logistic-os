-- Keep auth's schema private; the trusted OS resolves one known Google email.
revoke select(id,email) on auth.users from nexora_runtime;
revoke usage on schema auth from nexora_runtime;
alter table public.portal_memberships add column email text check(char_length(email)<=254);
update public.portal_memberships m set email=u.email from auth.users u where u.id=m.user_id;
create function nexora.portal_registered_user(p_email text) returns uuid
language sql stable security definer set search_path='' as $$
 select id from auth.users where lower(email)=lower(btrim(p_email)) and char_length(p_email)<=254 limit 1;
$$;
revoke all on function nexora.portal_registered_user(text) from public,anon,authenticated;
grant execute on function nexora.portal_registered_user(text) to nexora_runtime;
comment on function nexora.portal_registered_user(text) is 'Server-only exact-email lookup used after ADMIN authorization in the OS. Private schema; never executable by portal visitors.';
