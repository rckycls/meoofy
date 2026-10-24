-- Pilot allowlist: the before-user-created auth hook and the rejection log.
-- Uses tests.create_user / tests.authenticate_as / tests.clear_auth from 000_helpers.sql.
-- Seeded allowlist (supabase/seed.sql): owner@pawpin.test and e2e@pawpin.test.
begin;
select plan(39);

-- The log may hold rows from earlier sign-up attempts against this database. Empty it inside this
-- transaction (rolled back at the end), so the counts below see only this file's rows.
delete from identity.signup_rejections;

-- ---------------------------------------------------------------------------
-- Shape
-- ---------------------------------------------------------------------------
select has_table('identity', 'signup_rejections', 'identity.signup_rejections exists');
select columns_are('identity', 'signup_rejections', array['email', 'rejected_at']);
select ok(
  (select a.atttypid = 'extensions.citext'::regtype
     from pg_attribute a
    where a.attrelid = 'identity.signup_rejections'::regclass and a.attname = 'email'),
  'signup_rejections.email is citext');
select ok(
  (select a.atttypid = 'timestamptz'::regtype and a.attnotnull and a.atthasdef
     from pg_attribute a
    where a.attrelid = 'identity.signup_rejections'::regclass and a.attname = 'rejected_at'),
  'signup_rejections.rejected_at is a not-null timestamptz with a default');

select has_function('identity', 'before_user_created', array['jsonb'],
  'identity.before_user_created(event) exists');
select function_returns('identity', 'before_user_created', array['jsonb'], 'jsonb',
  'the hook returns jsonb');
select is_empty(
  $$ select p.oid::regprocedure
       from pg_proc p
      where p.oid = to_regprocedure('identity.before_user_created(jsonb)')
        and (not p.prosecdef or p.proconfig is null
             or not p.proconfig @> array['search_path=""']) $$,
  'the hook is security definer with an empty search_path');

-- ---------------------------------------------------------------------------
-- Grants: only the auth service may call the hook, and nobody reads the tables directly
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(g order by g)
     from (select case when a.grantee = 0 then 'public' else a.grantee::regrole::text end
             from pg_proc p, aclexplode(p.proacl) a
            where p.oid = to_regprocedure('identity.before_user_created(jsonb)')) s(g)),
  array['postgres', 'supabase_auth_admin'],
  'only the owner and supabase_auth_admin hold execute on the hook (not public)');
select ok(has_function_privilege('supabase_auth_admin', 'identity.before_user_created(jsonb)', 'EXECUTE'),
  'supabase_auth_admin can execute the hook');
select ok(not has_function_privilege('authenticated', 'identity.before_user_created(jsonb)', 'EXECUTE'),
  'authenticated cannot execute the hook');
select ok(not has_function_privilege('anon', 'identity.before_user_created(jsonb)', 'EXECUTE'),
  'anon cannot execute the hook');
select ok(has_schema_privilege('supabase_auth_admin', 'identity', 'USAGE'),
  'supabase_auth_admin can use schema identity');
select ok(not has_schema_privilege('anon', 'identity', 'USAGE'),
  'anon cannot use schema identity');
select table_privs_are('identity', 'signup_rejections', 'authenticated', array[]::text[]);
select table_privs_are('identity', 'signup_rejections', 'anon', array[]::text[]);
-- The hook is security definer, so the auth service needs no table access of its own.
select table_privs_are('identity', 'pilot_allowlist', 'supabase_auth_admin', array[]::text[]);
select table_privs_are('identity', 'signup_rejections', 'supabase_auth_admin', array[]::text[]);

-- ---------------------------------------------------------------------------
-- Seed
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(email::text order by email) from identity.pilot_allowlist
    where email in ('owner@pawpin.test', 'e2e@pawpin.test')),
  array['e2e@pawpin.test', 'owner@pawpin.test'],
  'the seed allowlists the owner and e2e test accounts');

-- ---------------------------------------------------------------------------
-- Allowed: the hook returns an empty object and logs nothing
-- ---------------------------------------------------------------------------
select is(
  identity.before_user_created('{"user":{"email":"Owner@Pawpin.test"}}'),
  '{}'::jsonb,
  'an allowlisted email is allowed, whatever its case');
select is(
  identity.before_user_created('{"user":{"email":"e2e@pawpin.test"}}'),
  '{}'::jsonb,
  'the e2e account is allowed');

insert into identity.pilot_allowlist (email) values ('Mixed.Case@Pawpin.test');
select is(
  identity.before_user_created('{"user":{"email":"mixed.case@pawpin.test"}}'),
  '{}'::jsonb,
  'a mixed-case allowlist entry matches a lower-case sign-up email');
select is(
  identity.before_user_created('{"user":{"email":"MIXED.CASE@PAWPIN.TEST"}}'),
  '{}'::jsonb,
  'a mixed-case allowlist entry matches an upper-case sign-up email');
select is((select count(*)::int from identity.signup_rejections), 0,
  'allowed sign-ups are not logged as rejections');

-- ---------------------------------------------------------------------------
-- Rejected: 403 with the invite-only message, and the address is logged
-- ---------------------------------------------------------------------------
select is(
  identity.before_user_created('{"user":{"email":"abc@privaterelay.appleid.com"}}'),
  '{"error":{"http_code":403,"message":"This pilot is invite-only"}}'::jsonb,
  'an unknown Apple relay address is refused with the invite-only 403');
select is(
  (select count(*)::int from identity.signup_rejections
    where email = 'abc@privaterelay.appleid.com'),
  1, 'the refused address is logged once');
select ok(
  (select rejected_at = now() from identity.signup_rejections
    where email = 'abc@privaterelay.appleid.com'),
  'the rejection is stamped with the time of the attempt');

select is(
  identity.before_user_created('{"user":{"email":"ABC@PrivateRelay.AppleID.com"}}')
    #>> '{error,http_code}',
  '403', 'a second attempt is refused again');
select is(
  (select count(*)::int from identity.signup_rejections
    where email = 'abc@privaterelay.appleid.com'),
  2, 'every refused attempt is logged, matched case-insensitively');
select is(
  (select count(*)::int from identity.signup_rejections where email = 'owner@pawpin.test'),
  0, 'allowlisted addresses never appear in the rejection log');

-- A sign-up without an email (phone, anonymous, malformed event) cannot be allowlisted:
-- it is refused the same way and there is nothing to log.
select is(
  identity.before_user_created('{"user":{"phone":"+15555550100"}}'),
  '{"error":{"http_code":403,"message":"This pilot is invite-only"}}'::jsonb,
  'a sign-up without an email is refused');
select is(
  identity.before_user_created('{"user":{"email":""}}')
    #>> '{error,message}',
  'This pilot is invite-only', 'a blank email is refused');
select is(
  identity.before_user_created('{"user":{"email":null}}')
    #>> '{error,message}',
  'This pilot is invite-only', 'a null email is refused');
select is(
  identity.before_user_created('{}'::jsonb) #>> '{error,message}',
  'This pilot is invite-only', 'an event without a user is refused');
select is(
  identity.before_user_created(null) #>> '{error,message}',
  'This pilot is invite-only', 'a null event is refused');
select is((select count(*)::int from identity.signup_rejections), 2,
  'sign-ups without an email add nothing to the rejection log');

-- ---------------------------------------------------------------------------
-- Clients: no reads, no hook
-- ---------------------------------------------------------------------------
select tests.authenticate_as(tests.create_user('hook-client@pawpin.test'));
select throws_ok($$ select * from identity.pilot_allowlist $$, '42501', null,
  'authenticated cannot read the pilot allowlist');
select throws_ok($$ select * from identity.signup_rejections $$, '42501', null,
  'authenticated cannot read the rejection log');
select throws_ok(
  $$ insert into identity.signup_rejections (email) values ('forged@example.com') $$,
  '42501', null, 'authenticated cannot write to the rejection log');
select throws_ok(
  $$ select identity.before_user_created('{"user":{"email":"owner@pawpin.test"}}') $$,
  '42501', null, 'authenticated cannot call the hook');

select * from finish();
rollback;
