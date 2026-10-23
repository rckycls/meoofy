-- Audit writers (audit.record, audit.record_system), the api.my_profile view and the first
-- client-callable functions: api.update_profile and api.complete_onboarding.
-- Uses tests.create_user / tests.authenticate_as / tests.clear_auth from 000_helpers.sql.
begin;
select plan(84);

do $$
begin
  perform set_config('pawpin.a', tests.create_user('profile-a@pawpin.test')::text, true);
  perform set_config('pawpin.b', tests.create_user('profile-b@pawpin.test')::text, true);
  perform set_config('pawpin.c', tests.create_user('profile-c@pawpin.test')::text, true);
end
$$;

-- ---------------------------------------------------------------------------
-- Shape and privileges
-- ---------------------------------------------------------------------------
select ok(to_regprocedure('audit.record(text, text, uuid, jsonb)') is not null,
  'audit.record(action, subject_type, subject_id, metadata) exists');
select ok(to_regprocedure('audit.record_system(text, text, uuid, jsonb)') is not null,
  'audit.record_system(action, subject_type, subject_id, metadata) exists');
select ok(to_regprocedure('api.update_profile(text)') is not null,
  'api.update_profile(display_name) exists');
select ok(to_regprocedure('api.complete_onboarding(identity.onboarding_path)') is not null,
  'api.complete_onboarding(path) exists');

select is_empty(
  $$ select p.oid::regprocedure
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('api', 'audit')
        and (not p.prosecdef or p.proconfig is null
             or not p.proconfig @> array['search_path=""']) $$,
  'every api and audit function is security definer with an empty search_path'
);

select is_empty(
  $$ select p.oid::regprocedure
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('api', 'audit')
        and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)) $$,
  'PUBLIC cannot execute any api or audit function'
);

select is_empty(
  $$ select p.oid::regprocedure
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('api', 'audit') and has_function_privilege('anon', p.oid, 'EXECUTE') $$,
  'anon cannot execute any api or audit function'
);

select ok(has_function_privilege('authenticated', 'api.update_profile(text)', 'EXECUTE'),
  'authenticated can execute api.update_profile');
select ok(has_function_privilege('authenticated',
  'api.complete_onboarding(identity.onboarding_path)', 'EXECUTE'),
  'authenticated can execute api.complete_onboarding');
select ok(not has_function_privilege('authenticated', 'audit.record(text, text, uuid, jsonb)',
  'EXECUTE'), 'authenticated cannot execute audit.record directly');
select ok(not has_function_privilege('authenticated',
  'audit.record_system(text, text, uuid, jsonb)', 'EXECUTE'),
  'authenticated cannot execute audit.record_system');
select ok(has_function_privilege('service_role', 'audit.record_system(text, text, uuid, jsonb)',
  'EXECUTE'), 'service_role can execute audit.record_system');
select ok(not has_function_privilege('service_role', 'audit.record(text, text, uuid, jsonb)',
  'EXECUTE'), 'service_role cannot execute audit.record (it has no actor)');

select is_empty(
  $$ select r.role || ' ' || p.priv
       from (values ('anon'), ('authenticated'), ('service_role')) r(role)
      cross join (values ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(priv)
      where has_table_privilege(r.role, 'audit.events', p.priv)
         or (p.priv = 'UPDATE' and has_any_column_privilege(r.role, 'audit.events', 'UPDATE')) $$,
  'no client role can update, delete or truncate audit.events'
);

select columns_are('api', 'my_profile',
  array['id', 'display_name', 'onboarding_path', 'onboarding_completed_at']);
select ok((select c.relkind = 'v' and coalesce(c.reloptions, '{}') @> array['security_invoker=true']
             from pg_class c where c.oid = 'api.my_profile'::regclass),
  'api.my_profile is a security_invoker view');
select table_privs_are('api', 'my_profile', 'authenticated', array['SELECT']);
select table_privs_are('api', 'my_profile', 'anon', array[]::text[]);

-- ---------------------------------------------------------------------------
-- Unauthenticated callers
-- ---------------------------------------------------------------------------
select throws_ok($$ select api.update_profile('Alex') $$, 'P0001', 'PAWPIN:UNAUTHENTICATED',
  'update_profile without a JWT throws UNAUTHENTICATED');
select throws_ok($$ select api.complete_onboarding('owner') $$, 'P0001', 'PAWPIN:UNAUTHENTICATED',
  'complete_onboarding without a JWT throws UNAUTHENTICATED');
select throws_ok($$ select audit.record('test.event', 'test', null) $$, 'P0001',
  'PAWPIN:UNAUTHENTICATED', 'audit.record without an actor throws UNAUTHENTICATED');

-- The authenticated role with no usable subject claim (a token without sub).
select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', '', true);
select throws_ok($$ select api.update_profile('Alex') $$, 'P0001', 'PAWPIN:UNAUTHENTICATED',
  'update_profile with no subject claim throws UNAUTHENTICATED');
select throws_ok($$ select api.complete_onboarding('owner') $$, 'P0001', 'PAWPIN:UNAUTHENTICATED',
  'complete_onboarding with no subject claim throws UNAUTHENTICATED');
select is_empty($$ select 1 from api.my_profile $$,
  'api.my_profile returns nothing when there is no subject claim');

-- The anon role cannot reach the api schema at all.
select set_config('role', 'anon', true);
select throws_ok($$ select api.update_profile('Alex') $$, '42501', null,
  'anon cannot call update_profile');
select throws_ok($$ select api.complete_onboarding('owner') $$, '42501', null,
  'anon cannot call complete_onboarding');
select throws_ok($$ select * from api.my_profile $$, '42501', null,
  'anon cannot read api.my_profile');
reset role;

-- ---------------------------------------------------------------------------
-- api.update_profile
-- ---------------------------------------------------------------------------
select tests.authenticate_as(current_setting('pawpin.a')::uuid);

select lives_ok($$ select api.update_profile('  Alex  ') $$, 'update_profile accepts a padded name');
select results_eq($$ select display_name from api.my_profile $$, $$ values ('Alex') $$,
  'update_profile stores the trimmed name');
select results_eq(
  $$ select actor_id = auth.uid(), subject_type, subject_id = auth.uid(), metadata
       from audit.events where action = 'profile.updated' $$,
  $$ values (true, 'profile', true, '{}'::jsonb) $$,
  'update_profile writes exactly one profile.updated event for the caller'
);
select ok(not exists (select 1 from audit.events where metadata ? 'display_name'),
  'the profile.updated event has no display_name key');

select throws_ok($$ select api.update_profile('   ') $$, 'P0001', 'PAWPIN:VALIDATION',
  'a blank name throws VALIDATION');
select throws_ok($$ select api.update_profile(E' 　 ') $$, 'P0001',
  'PAWPIN:VALIDATION', 'a name of only non-ASCII whitespace throws VALIDATION');
select throws_ok($$ select api.update_profile('') $$, 'P0001', 'PAWPIN:VALIDATION',
  'an empty name throws VALIDATION');
select throws_ok($$ select api.update_profile(null) $$, 'P0001', 'PAWPIN:VALIDATION',
  'a null name throws VALIDATION');
select throws_ok($$ select api.update_profile(repeat('a', 41)) $$, 'P0001', 'PAWPIN:VALIDATION',
  'a 41-character name throws VALIDATION');
select throws_ok($$ select api.update_profile(repeat('🐶', 41)) $$, 'P0001', 'PAWPIN:VALIDATION',
  'a name is counted in characters, not bytes: 41 emoji throw VALIDATION');
select throws_ok($$ select api.update_profile(' ' || repeat('a', 41) || ' ') $$, 'P0001',
  'PAWPIN:VALIDATION', 'a name over the limit after trimming throws VALIDATION');
select results_eq($$ select display_name from api.my_profile $$, $$ values ('Alex') $$,
  'rejected names leave the stored name unchanged');
select is((select count(*)::int from audit.events), 1, 'rejected names write no audit event');

select lives_ok($$ select api.update_profile(repeat('🐶', 40)) $$,
  'a name of exactly 40 characters is accepted');
select lives_ok($$ select api.update_profile(E'  ' || repeat('b', 40) || E'　') $$,
  'a name of 40 characters plus surrounding whitespace is accepted');
select results_eq($$ select display_name from api.my_profile $$, $$ values (repeat('b', 40)) $$,
  'surrounding Unicode whitespace is trimmed');
select lives_ok($$ select api.update_profile(E'Sam　Lee') $$, 'inner whitespace is accepted');
select results_eq($$ select display_name from api.my_profile $$, $$ values (E'Sam　Lee') $$,
  'inner whitespace is kept');
select is((select count(*)::int from audit.events where action = 'profile.updated'), 4,
  'every successful update writes one profile.updated event');

-- ---------------------------------------------------------------------------
-- api.complete_onboarding
-- ---------------------------------------------------------------------------
select is_empty($$ select 1 from api.my_profile where onboarding_completed_at is not null $$,
  'onboarding starts incomplete');
select lives_ok($$ select api.complete_onboarding('owner') $$, 'complete_onboarding(owner) succeeds');
select results_eq(
  $$ select onboarding_path::text, onboarding_completed_at is not null from api.my_profile $$,
  $$ values ('owner', true) $$,
  'complete_onboarding stores the path and a completion time'
);
select results_eq(
  $$ select actor_id = auth.uid(), subject_type, subject_id = auth.uid(), metadata
       from audit.events where action = 'onboarding.completed' $$,
  $$ values (true, 'profile', true, '{"path": "owner"}'::jsonb) $$,
  'complete_onboarding writes one onboarding.completed event'
);

-- Move the completion time into the past, so "unchanged" cannot be mistaken for "same now()".
select tests.clear_auth();
update identity.profiles set onboarding_completed_at = '2000-01-01T00:00:00Z'
 where id = current_setting('pawpin.a')::uuid;
select tests.authenticate_as(current_setting('pawpin.a')::uuid);

select lives_ok($$ select api.complete_onboarding('owner') $$, 'a second identical call succeeds');
select lives_ok($$ select api.complete_onboarding('finder') $$,
  'a later call with another path succeeds');
select results_eq(
  $$ select onboarding_path::text, onboarding_completed_at from api.my_profile $$,
  $$ values ('owner', '2000-01-01T00:00:00Z'::timestamptz) $$,
  'repeat calls change neither the path nor the completion time'
);
select is((select count(*)::int from audit.events where action = 'onboarding.completed'), 1,
  'repeat calls write no further audit event');
select throws_ok($$ select api.complete_onboarding(null) $$, 'P0001', 'PAWPIN:VALIDATION',
  'a null path throws VALIDATION');

-- ---------------------------------------------------------------------------
-- Isolation: each caller only ever touches and sees their own profile and events
-- ---------------------------------------------------------------------------
select tests.authenticate_as(current_setting('pawpin.b')::uuid);

select results_eq($$ select id from api.my_profile $$,
  $$ values (current_setting('pawpin.b')::uuid) $$,
  'user B sees only their own row in api.my_profile');
select results_eq(
  $$ select display_name, onboarding_path::text, onboarding_completed_at is null
       from api.my_profile $$,
  $$ values ('', null, true) $$,
  'user A''s updates did not touch user B''s profile'
);
select is_empty($$ select 1 from audit.events $$, 'user B sees none of user A''s audit events');

select lives_ok($$ select api.update_profile('Bea') $$, 'user B updates their own name');
select lives_ok($$ select api.complete_onboarding('finder') $$, 'user B completes onboarding');
select results_eq($$ select display_name, onboarding_path::text from api.my_profile $$,
  $$ values ('Bea', 'finder') $$, 'user B''s changes land on user B''s row');
select is((select count(*)::int from audit.events), 2, 'user B sees exactly their own two events');

select tests.authenticate_as(current_setting('pawpin.a')::uuid);

select results_eq($$ select id from api.my_profile $$,
  $$ values (current_setting('pawpin.a')::uuid) $$,
  'user A sees only their own row in api.my_profile');
select results_eq($$ select display_name, onboarding_path::text from api.my_profile $$,
  $$ values (E'Sam　Lee', 'owner') $$, 'user B''s changes did not touch user A''s profile');
select is((select count(*)::int from audit.events), 5, 'user A sees exactly their own five events');

-- ---------------------------------------------------------------------------
-- A caller whose profile no longer exists (deleted account, token still valid)
-- ---------------------------------------------------------------------------
select tests.clear_auth();
delete from identity.profiles where id = current_setting('pawpin.c')::uuid;
select tests.authenticate_as(current_setting('pawpin.c')::uuid);

select throws_ok($$ select api.update_profile('Cy') $$, 'P0001', 'PAWPIN:UNAUTHENTICATED',
  'update_profile without a profile row throws UNAUTHENTICATED');
select throws_ok($$ select api.complete_onboarding('owner') $$, 'P0001', 'PAWPIN:UNAUTHENTICATED',
  'complete_onboarding without a profile row throws UNAUTHENTICATED');
select is_empty($$ select 1 from audit.events $$, 'those failed calls wrote no audit event');

-- ---------------------------------------------------------------------------
-- Audit log: append-only for clients
-- ---------------------------------------------------------------------------
select tests.authenticate_as(current_setting('pawpin.a')::uuid);

select throws_ok($$ update audit.events set action = 'forged' $$, '42501', null,
  'authenticated cannot update audit.events');
select throws_ok($$ delete from audit.events $$, '42501', null,
  'authenticated cannot delete from audit.events');
select throws_ok($$ truncate audit.events $$, '42501', null,
  'authenticated cannot truncate audit.events');
select throws_ok($$ select audit.record('forged.event', 'profile', null) $$, '42501', null,
  'authenticated cannot call audit.record directly');
select throws_ok($$ select audit.record_system('forged.event', 'profile') $$, '42501', null,
  'authenticated cannot call audit.record_system');
select is((select count(*)::int from audit.events where action = 'forged.event'), 0,
  'no forged event was written');

-- ---------------------------------------------------------------------------
-- audit.record and audit.record_system
-- ---------------------------------------------------------------------------
select tests.clear_auth();

-- audit.record takes the actor from the JWT subject claim.
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('pawpin.a'))::text, true);
select lives_ok(
  $$ select audit.record('test.recorded', 'test', 'f0000000-0000-4000-8000-000000000001',
                         '{"count": 2}') $$,
  'audit.record writes an event');
select lives_ok($$ select audit.record('test.defaults', 'test', null) $$,
  'audit.record needs no subject or metadata');
select lives_ok($$ select audit.record('test.null_metadata', 'test', null, null) $$,
  'audit.record accepts null metadata');
select set_config('request.jwt.claims', '', true);

select results_eq(
  $$ select action, actor_id, subject_type, subject_id, metadata from audit.events
      where action like 'test.%' and actor_id is not null order by id $$,
  $$ values ('test.recorded', current_setting('pawpin.a')::uuid, 'test',
             'f0000000-0000-4000-8000-000000000001'::uuid, '{"count": 2}'::jsonb),
            ('test.defaults', current_setting('pawpin.a')::uuid, 'test', null, '{}'::jsonb),
            ('test.null_metadata', current_setting('pawpin.a')::uuid, 'test', null, '{}'::jsonb) $$,
  'audit.record uses the caller as actor and defaults metadata to an empty object'
);

select lives_ok($$ select audit.record_system('test.system', 'test') $$,
  'audit.record_system writes an event');
select lives_ok(
  $$ select audit.record_system('test.system_full', 'test', 'f0000000-0000-4000-8000-000000000002',
                                '{"deleted": 3}') $$,
  'audit.record_system takes a subject and metadata');
select results_eq(
  $$ select action, subject_type, subject_id, metadata from audit.events
      where action like 'test.%' and actor_id is null order by id $$,
  $$ values ('test.system', 'test', null, '{}'::jsonb),
            ('test.system_full', 'test', 'f0000000-0000-4000-8000-000000000002'::uuid,
             '{"deleted": 3}'::jsonb) $$,
  'audit.record_system writes events with a null actor'
);

-- service_role may call record_system (and nothing else in audit).
select set_config('role', 'service_role', true);
select lives_ok($$ select audit.record_system('test.service_role', 'test') $$,
  'service_role can call audit.record_system');
select throws_ok($$ select audit.record('test.service_role', 'test', null) $$, '42501', null,
  'service_role cannot call audit.record');
reset role;
select is((select count(*)::int from audit.events
            where action = 'test.service_role' and actor_id is null), 1,
  'the service_role event was written with a null actor');

select * from finish();
rollback;
