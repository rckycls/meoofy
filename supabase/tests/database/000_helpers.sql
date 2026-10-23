-- Helpers shared by every pgTAP file. Deliberately not wrapped in begin/rollback: pg_prove runs
-- each file in its own session, in name order, so these persist for the files that follow
-- (until the next `supabase db reset`). Everything is idempotent, so reruns are safe.
--
--   tests.create_user(email, meta)  inserts an auth user (the auth trigger then creates the
--                                   profile and account) and returns its id. Call as postgres.
--   tests.authenticate_as(uid)      acts as that user for the rest of the transaction: role
--                                   authenticated, JWT claims with sub = uid, so auth.uid() = uid.
--   tests.clear_auth()              returns to the session role (postgres) with no JWT claims.

set client_min_messages = warning; -- no "already exists, skipping" notices on reruns

create schema if not exists tests;

create or replace function tests.create_user(email text, meta jsonb default '{}'::jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  values (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
    create_user.email, '', now(), '{"provider": "email", "providers": ["email"]}',
    create_user.meta, now(), now()
  );
  return uid;
end
$$;

-- No SET clauses on these two: the role and claims they set must outlive the call.
create or replace function tests.authenticate_as(uid uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aud', 'authenticated')::text, true);
end
$$;

create or replace function tests.clear_auth()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'none', true);
end
$$;

-- Tests switch between users while acting as authenticated, so that role may call the
-- switching helpers. Creating users stays postgres-only.
grant usage on schema tests to authenticated;
revoke execute on all functions in schema tests from public;
grant execute on function tests.authenticate_as(uuid), tests.clear_auth() to authenticated;

select plan(1);
select pass('helpers');
select * from finish();
