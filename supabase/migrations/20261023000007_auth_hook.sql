-- Pilot allowlist: the Supabase Auth "before user created" hook (spec §5, §6).
--
-- The pilot is invite-only. Supabase Auth calls identity.before_user_created before it creates any
-- user, by any method (email, Apple, anonymous), and refuses the sign-up unless the address is in
-- identity.pilot_allowlist. Refused addresses are logged in identity.signup_rejections so the
-- operator can allowlist a tester after their first attempt. This matters most for Apple "Hide My
-- Email": the relay address (xxxx@privaterelay.appleid.com) is not known beforehand.
--
-- The hook is wired up in supabase/config.toml ([auth.hook.before_user_created]) for local
-- development. On a hosted project, enable it in the dashboard (Authentication > Hooks) and pick
-- this function.
--
-- To invite a tester:
--   insert into identity.pilot_allowlist (email) values ('tester@example.com');
-- To find the relay address of a tester who was just refused:
--   select * from identity.signup_rejections order by rejected_at desc;
--
-- The log holds the address and the time of the attempt and nothing else. Neither table is
-- readable by clients; the operator uses the SQL editor or the service connection.

-- ---------------------------------------------------------------------------
-- Rejection log
-- ---------------------------------------------------------------------------
-- One row per refused attempt, so a tester who tries twice leaves two rows. Only the hook writes it.
create table identity.signup_rejections (
  email extensions.citext not null,
  rejected_at timestamptz not null default now()
);

-- No policies: like the allowlist, invisible to clients even if a grant ever slipped in.
alter table identity.signup_rejections enable row level security;

-- ---------------------------------------------------------------------------
-- The hook
-- ---------------------------------------------------------------------------
-- Receives the event Supabase Auth sends ({"user": {...}, "metadata": {...}}) and returns either
-- '{}' to let the sign-up through or {"error": {"http_code", "message"}} to refuse it. The app maps
-- the message "This pilot is invite-only" to its own error, so do not reword it.
--
-- Security definer, so the auth service needs no access to the two tables (which have row-level
-- security and no policies): the only thing supabase_auth_admin can do is call this function. The
-- search_path is empty, so the operator for citext equality is spelled out: with a bare `=` the
-- lookup would fall back to case-sensitive text comparison.
--
-- A sign-up with no email (phone, anonymous, a malformed event) can't be on the allowlist, so it is
-- refused the same way, and there is no address to log.
create function identity.before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  signup_email constant extensions.citext :=
    nullif(pg_catalog.btrim(before_user_created.event -> 'user' ->> 'email'), '');
begin
  if signup_email is not null and exists (
    select 1
      from identity.pilot_allowlist a
     where a.email operator(extensions.=) signup_email
  ) then
    return '{}'::jsonb;
  end if;

  if signup_email is not null then
    insert into identity.signup_rejections (email) values (signup_email);
  end if;

  return pg_catalog.jsonb_build_object(
    'error',
    pg_catalog.jsonb_build_object('http_code', 403, 'message', 'This pilot is invite-only')
  );
end
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Postgres lets PUBLIC execute every new function. Only the auth service calls the hook.
revoke all on function identity.before_user_created(jsonb) from public, anon, authenticated;
grant usage on schema identity to supabase_auth_admin;
grant execute on function identity.before_user_created(jsonb) to supabase_auth_admin;
