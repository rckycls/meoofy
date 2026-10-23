-- Schema shape, grants, row-level security, the auth-user trigger, limits and shared helpers.
-- Uses tests.create_user / tests.authenticate_as / tests.clear_auth from 000_helpers.sql.
begin;
select plan(105);

-- ---------------------------------------------------------------------------
-- Schemas, tables, columns and enums (spec §5)
-- ---------------------------------------------------------------------------
select has_schema('api');
select has_schema('identity');
select has_schema('registry');
select has_schema('entitlements');
select has_schema('audit');
select has_schema('internal');

select has_table('identity', 'profiles', 'identity.profiles exists');
select has_table('identity', 'pilot_allowlist', 'identity.pilot_allowlist exists');
select has_table('registry', 'pets', 'registry.pets exists');
select has_table('registry', 'pet_photos', 'registry.pet_photos exists');
select has_table('registry', 'storage_deletions', 'registry.storage_deletions exists');
select has_table('entitlements', 'accounts', 'entitlements.accounts exists');
select has_table('audit', 'events', 'audit.events exists');

select columns_are('identity', 'profiles',
  array['id', 'display_name', 'onboarding_path', 'onboarding_completed_at', 'created_at']);
select columns_are('identity', 'pilot_allowlist', array['email', 'invited_at']);
select columns_are('registry', 'pets',
  array['id', 'owner_id', 'name', 'species', 'breed', 'age_months', 'registration_state',
        'discovery_enabled', 'created_at', 'updated_at']);
select columns_are('registry', 'pet_photos',
  array['id', 'pet_id', 'owner_id', 'view', 'storage_path', 'width', 'height', 'bytes',
        'blur_score', 'brightness', 'status', 'created_at', 'confirmed_at']);
select columns_are('registry', 'storage_deletions',
  array['id', 'storage_path', 'requested_at', 'attempts', 'last_error']);
select columns_are('entitlements', 'accounts', array['owner_id', 'tier', 'updated_at']);
select columns_are('audit', 'events',
  array['id', 'actor_id', 'action', 'subject_type', 'subject_id', 'metadata', 'created_at']);

select enum_has_labels('identity', 'onboarding_path', array['owner', 'finder']);
select enum_has_labels('registry', 'species', array['dog', 'cat']);
select enum_has_labels('registry', 'registration_state', array['private', 'archived']);
select enum_has_labels('registry', 'photo_view', array['front', 'side', 'markings', 'extra']);
select enum_has_labels('registry', 'photo_status', array['pending', 'ready', 'rejected']);
select enum_has_labels('entitlements', 'tier', array['free', 'pro', 'max']);

select col_default_is('registry', 'pets', 'registration_state', 'private'::text,
  'pets start private');
select col_default_is('registry', 'pets', 'discovery_enabled', 'false'::text,
  'discovery starts off');
select col_default_is('entitlements', 'accounts', 'tier', 'free'::text,
  'accounts start on the free tier');

-- ---------------------------------------------------------------------------
-- Grants: authenticated reads its own rows, nobody else gets anything
-- ---------------------------------------------------------------------------
select table_privs_are('identity', 'profiles', 'authenticated', array['SELECT']);
select table_privs_are('registry', 'pets', 'authenticated', array['SELECT']);
select table_privs_are('registry', 'pet_photos', 'authenticated', array['SELECT']);
select table_privs_are('entitlements', 'accounts', 'authenticated', array['SELECT']);
select table_privs_are('audit', 'events', 'authenticated', array['SELECT']);
select table_privs_are('identity', 'pilot_allowlist', 'authenticated', array[]::text[]);
select table_privs_are('registry', 'storage_deletions', 'authenticated', array[]::text[]);

select is_empty(
  $$ select format('%I.%I', n.nspname, c.relname)
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('api', 'identity', 'registry', 'entitlements', 'audit', 'internal')
        and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and has_any_column_privilege('anon', c.oid, 'SELECT') $$,
  'anon cannot read any table'
);

select is_empty(
  $$ select format('%I.%I %s %s', n.nspname, c.relname, r.role, p.priv)
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      cross join (values ('anon'), ('authenticated')) r(role)
      cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'),
                         ('TRIGGER'), ('MAINTAIN')) p(priv)
      where n.nspname in ('api', 'identity', 'registry', 'entitlements', 'audit', 'internal')
        and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and case when p.priv in ('INSERT', 'UPDATE', 'REFERENCES')
                 then has_any_column_privilege(r.role, c.oid, p.priv)
                 else has_table_privilege(r.role, c.oid, p.priv) end $$,
  'clients have no write privilege on any table'
);

select is_empty(
  $$ select format('%I.%I %s', n.nspname, c.relname, r.role)
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      cross join (values ('anon'), ('authenticated')) r(role)
      where n.nspname in ('api', 'identity', 'registry', 'entitlements', 'audit', 'internal')
        and c.relkind = 'S'
        and (has_sequence_privilege(r.role, c.oid, 'USAGE')
             or has_sequence_privilege(r.role, c.oid, 'SELECT')
             or has_sequence_privilege(r.role, c.oid, 'UPDATE')) $$,
  'clients cannot draw from any sequence'
);

select is_empty(
  $$ select format('%s %s', p.oid::regprocedure, r.role)
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      cross join (values ('anon'), ('authenticated')) r(role)
      where n.nspname in ('identity', 'registry', 'entitlements', 'audit', 'internal')
        and has_function_privilege(r.role, p.oid, 'EXECUTE') $$,
  'clients cannot execute module functions'
);

select schema_privs_are('api', 'authenticated', array['USAGE']);
select schema_privs_are('api', 'anon', array[]::text[]);
select schema_privs_are('internal', 'authenticated', array[]::text[]);
select schema_privs_are('internal', 'anon', array[]::text[]);

-- ---------------------------------------------------------------------------
-- Row-level security: enabled everywhere, select-only owner policies
-- ---------------------------------------------------------------------------
select is_empty(
  $$ select format('%I.%I', n.nspname, c.relname)
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('identity', 'registry', 'entitlements', 'audit', 'internal')
        and c.relkind in ('r', 'p')
        and not c.relrowsecurity $$,
  'row-level security is enabled on every table'
);

select is_empty(
  $$ select format('%I.%I %s', schemaname, tablename, policyname)
       from pg_policies
      where schemaname in ('identity', 'registry', 'entitlements', 'audit', 'internal')
        and (cmd <> 'SELECT' or roles <> array['authenticated']::name[]) $$,
  'every policy is a select policy for authenticated only'
);

select policies_are('identity', 'profiles', array['profiles_select_own']);
select policies_are('registry', 'pets', array['pets_select_own']);
select policies_are('registry', 'pet_photos', array['pet_photos_select_own']);
select policies_are('entitlements', 'accounts', array['accounts_select_own']);
select policies_are('audit', 'events', array['events_select_own']);
select policies_are('identity', 'pilot_allowlist', array[]::name[]);
select policies_are('registry', 'storage_deletions', array[]::name[]);

-- ---------------------------------------------------------------------------
-- Auth-user trigger: one profile and one free account per new user
-- ---------------------------------------------------------------------------
do $$
begin
  perform set_config('pawpin.a', tests.create_user('a@pawpin.test',
    '{"given_name": "  Alex  ", "full_name": "Alex Rivera"}')::text, true);
  perform set_config('pawpin.b', tests.create_user('b@pawpin.test')::text, true);
  perform tests.create_user('name-1@pawpin.test', '{"full_name": " Sam Lee "}');
  perform tests.create_user('name-2@pawpin.test', '{"given_name": "   ", "full_name": "Jo"}');
  perform tests.create_user('name-3@pawpin.test',
    jsonb_build_object('given_name', repeat('🐶', 45)));
  perform tests.create_user('name-4@pawpin.test',
    jsonb_build_object('given_name', repeat('a', 39) || ' bcd'));
end
$$;

select results_eq(
  $$ select (select count(*) from identity.profiles where id = current_setting('pawpin.b')::uuid)::int,
            (select count(*) from entitlements.accounts
              where owner_id = current_setting('pawpin.b')::uuid and tier = 'free')::int $$,
  $$ values (1, 1) $$,
  'a new auth user gets one profile row and one free account row'
);

select results_eq(
  $$ select p.display_name from identity.profiles p join auth.users u on u.id = p.id
      where u.email in ('a@pawpin.test', 'b@pawpin.test') order by u.email $$,
  $$ values ('Alex'), ('') $$,
  'display name prefers given_name (trimmed) and falls back to an empty string'
);

select results_eq(
  $$ select p.display_name from identity.profiles p join auth.users u on u.id = p.id
      where u.email like 'name-%@pawpin.test' order by u.email $$,
  $$ values ('Sam Lee'), ('Jo'), (repeat('🐶', 40)), (repeat('a', 39)) $$,
  'display name falls back to full_name and is trimmed to 40 code points'
);

-- ---------------------------------------------------------------------------
-- Owner isolation (fixture rows inserted as postgres)
-- ---------------------------------------------------------------------------
do $$
declare
  a uuid := current_setting('pawpin.a')::uuid;
  b uuid := current_setting('pawpin.b')::uuid;
begin
  insert into registry.pets (id, owner_id, name, species)
  values ('a0000000-0000-4000-8000-000000000001', a, 'Milo', 'dog'),
         ('b0000000-0000-4000-8000-000000000001', b, 'Rex', 'cat');
  insert into registry.pet_photos (id, pet_id, owner_id, view, storage_path, bytes)
  values ('a0000000-0000-4000-8000-0000000000f1', 'a0000000-0000-4000-8000-000000000001', a,
          'front', a || '/a0000000-0000-4000-8000-000000000001/a0000000-0000-4000-8000-0000000000f1.jpg',
          1000);
  insert into audit.events (actor_id, action, subject_type, subject_id)
  values (a, 'pet.created', 'pet', 'a0000000-0000-4000-8000-000000000001');
end
$$;

select tests.authenticate_as(current_setting('pawpin.b')::uuid);

select is(
  (select count(*)::int from registry.pets where owner_id = current_setting('pawpin.a')::uuid),
  0, 'user B sees none of user A''s pets');
select results_eq($$ select name from registry.pets $$, $$ values ('Rex') $$,
  'user B sees only their own pets');
select is_empty($$ select 1 from registry.pet_photos $$, 'user B sees none of user A''s photos');
select results_eq($$ select id from identity.profiles $$,
  $$ values (current_setting('pawpin.b')::uuid) $$, 'user B sees only their own profile');
select results_eq($$ select owner_id from entitlements.accounts $$,
  $$ values (current_setting('pawpin.b')::uuid) $$, 'user B sees only their own account');
select is_empty($$ select 1 from audit.events $$, 'user B sees none of user A''s audit events');

select tests.authenticate_as(current_setting('pawpin.a')::uuid);

select results_eq($$ select name from registry.pets $$, $$ values ('Milo') $$,
  'user A sees their own pet');
select is((select count(*)::int from registry.pet_photos), 1, 'user A sees their own photo');
select is((select count(*)::int from audit.events), 1, 'user A sees their own audit event');

select throws_ok(
  $$ insert into registry.pets (id, owner_id, name, species)
     values (gen_random_uuid(), current_setting('pawpin.a')::uuid, 'Nope', 'cat') $$,
  '42501', null, 'authenticated cannot insert into registry.pets');
select throws_ok($$ update registry.pets set name = 'Hacked' $$, '42501', null,
  'authenticated cannot update registry.pets');
select throws_ok($$ delete from registry.pets $$, '42501', null,
  'authenticated cannot delete from registry.pets');
select throws_ok($$ update entitlements.accounts set tier = 'max' $$, '42501', null,
  'authenticated cannot raise their own tier');
select throws_ok($$ update identity.profiles set display_name = 'x' $$, '42501', null,
  'authenticated cannot update profiles directly');
select throws_ok($$ insert into audit.events (action, subject_type) values ('x', 'y') $$,
  '42501', null, 'authenticated cannot write audit events');
select throws_ok($$ select * from identity.pilot_allowlist $$, '42501', null,
  'authenticated cannot read the pilot allowlist');
select throws_ok($$ select * from registry.storage_deletions $$, '42501', null,
  'authenticated cannot read the storage deletion queue');

select tests.clear_auth();

select is(current_user::text, 'postgres', 'tests.clear_auth() returns to the session role');
select is(auth.uid(), null, 'tests.clear_auth() clears the JWT claims');

-- ---------------------------------------------------------------------------
-- Limits: generated registry.limits(), pet_limit, and table checks that agree with them
-- ---------------------------------------------------------------------------
select is(entitlements.pet_limit('free'), 3, 'free tier allows 3 pets');
select is(entitlements.pet_limit('pro'), 10, 'pro tier allows 10 pets');
select ok(entitlements.pet_limit('max') is null, 'max tier is unlimited (null)');
select is(registry.limits() -> 'tierLimits', '{"free": 3, "pro": 10, "max": null}'::jsonb,
  'registry.limits() carries the tier limits');
select is((select provolatile from pg_proc where oid = 'registry.limits()'::regprocedure),
  'i'::"char", 'registry.limits() is immutable');

select lives_ok(
  format($$ insert into registry.pets (id, owner_id, name, species, breed, age_months)
            values (gen_random_uuid(), %L, repeat('🐶', %s), 'dog', repeat('b', %s), %s) $$,
         current_setting('pawpin.b'), registry.limits() ->> 'petNameMax',
         registry.limits() ->> 'breedMax', registry.limits() ->> 'ageMonthsMax'),
  'pets accept a name, breed and age exactly at the limits');
select throws_ok(
  format($$ insert into registry.pets (id, owner_id, name, species)
            values (gen_random_uuid(), %L, repeat('🐶', %s + 1), 'dog') $$,
         current_setting('pawpin.b'), registry.limits() ->> 'petNameMax'),
  '23514', null, 'a pet name over the limit violates a check');
select throws_ok(
  format($$ insert into registry.pets (id, owner_id, name, species)
            values (gen_random_uuid(), %L, '', 'dog') $$, current_setting('pawpin.b')),
  '23514', null, 'an empty pet name violates a check');
select throws_ok(
  format($$ insert into registry.pets (id, owner_id, name, species, breed)
            values (gen_random_uuid(), %L, 'Pip', 'dog', repeat('b', %s + 1)) $$,
         current_setting('pawpin.b'), registry.limits() ->> 'breedMax'),
  '23514', null, 'a breed over the limit violates a check');
select throws_ok(
  format($$ insert into registry.pets (id, owner_id, name, species, age_months)
            values (gen_random_uuid(), %L, 'Pip', 'dog', %s + 1) $$,
         current_setting('pawpin.b'), registry.limits() ->> 'ageMonthsMax'),
  '23514', null, 'an age over the limit violates a check');
select throws_ok(
  format($$ insert into registry.pets (id, owner_id, name, species, age_months)
            values (gen_random_uuid(), %L, 'Pip', 'dog', -1) $$, current_setting('pawpin.b')),
  '23514', null, 'a negative age violates a check');
select throws_ok(
  format($$ update identity.profiles set display_name = repeat('n', %s + 1) where id = %L $$,
         registry.limits() ->> 'displayNameMax', current_setting('pawpin.b')),
  '23514', null, 'a display name over the limit violates a check');
select throws_ok(
  format($$ insert into registry.pet_photos (id, pet_id, owner_id, view, storage_path, bytes)
            values (gen_random_uuid(), 'b0000000-0000-4000-8000-000000000001', %L, 'side',
                    'too-big.jpg', %s + 1) $$,
         current_setting('pawpin.b'), registry.limits() ->> 'photoMaxBytes'),
  '23514', null, 'a photo over the byte limit violates a check');

-- ---------------------------------------------------------------------------
-- Integrity constraints
-- ---------------------------------------------------------------------------
select throws_ok(
  format($$ insert into registry.pet_photos (id, pet_id, owner_id, view, storage_path, bytes)
            values (gen_random_uuid(), 'a0000000-0000-4000-8000-000000000001', %L, 'side',
                    'mismatch.jpg', 1000) $$, current_setting('pawpin.b')),
  '23503', null, 'a photo cannot belong to a different owner than its pet');

select lives_ok(
  $$ insert into registry.pet_photos (id, pet_id, owner_id, view, storage_path, bytes, width,
                                      height, status, confirmed_at)
     select gen_random_uuid(), 'b0000000-0000-4000-8000-000000000001',
            current_setting('pawpin.b')::uuid, v, 'ready-' || v || '-' || n || '.jpg', 1000, 1600,
            1200, 'ready', now()
       from (values ('front'::registry.photo_view, 1), ('extra', 1), ('extra', 2)) s(v, n) $$,
  'one ready photo per required view, and several ready extras, are allowed');
select throws_ok(
  format($$ insert into registry.pet_photos (id, pet_id, owner_id, view, storage_path, bytes,
                                             width, height, status, confirmed_at)
            values (gen_random_uuid(), 'b0000000-0000-4000-8000-000000000001', %L, 'front',
                    'ready-front-2.jpg', 1000, 1600, 1200, 'ready', now()) $$,
         current_setting('pawpin.b')),
  '23505', null, 'a second ready photo for a required view is rejected');

select throws_ok(
  $$ insert into identity.pilot_allowlist (email) values ('Dup@Pawpin.test'), ('dup@pawpin.test') $$,
  '23505', null, 'allowlist emails are unique regardless of case');

select throws_ok(
  $$ insert into audit.events (action, subject_type, metadata) values ('x', 'y', '[]') $$,
  '23514', null, 'audit metadata must be a JSON object');

update registry.pets set updated_at = '2000-01-01' where id = 'b0000000-0000-4000-8000-000000000001';
select is((select updated_at from registry.pets where id = 'b0000000-0000-4000-8000-000000000001'),
  now(), 'updating a pet sets updated_at');
update entitlements.accounts set updated_at = '2000-01-01'
 where owner_id = current_setting('pawpin.b')::uuid;
select is((select updated_at from entitlements.accounts
            where owner_id = current_setting('pawpin.b')::uuid),
  now(), 'updating an account sets updated_at');

delete from auth.users where id = current_setting('pawpin.a')::uuid;
select results_eq(
  $$ select (select count(*) from identity.profiles where id = current_setting('pawpin.a')::uuid)::int,
            (select count(*) from entitlements.accounts
              where owner_id = current_setting('pawpin.a')::uuid)::int,
            (select count(*) from registry.pets
              where owner_id = current_setting('pawpin.a')::uuid)::int,
            (select count(*) from registry.pet_photos
              where owner_id = current_setting('pawpin.a')::uuid)::int $$,
  $$ values (0, 0, 0, 0) $$,
  'deleting an auth user cascades to their profile, account, pets and photos');
select is((select count(*)::int from audit.events where actor_id = current_setting('pawpin.a')::uuid),
  1, 'audit events outlive the user');

-- ---------------------------------------------------------------------------
-- internal.fail and internal.trim_ws
-- ---------------------------------------------------------------------------
select throws_ok($$ select internal.fail('NOT_OWNER') $$, 'P0001', 'PAWPIN:NOT_OWNER',
  'internal.fail raises PAWPIN:<code>');

create function pg_temp.fail_detail() returns text language plpgsql as $$
declare
  d text;
begin
  perform internal.fail('VALIDATION', 'breed too long');
  return null;
exception when others then
  get stacked diagnostics d = pg_exception_detail;
  return sqlerrm || ' / ' || d;
end
$$;
select is(pg_temp.fail_detail(), 'PAWPIN:VALIDATION / breed too long',
  'internal.fail passes the detail through');

select throws_ok($$ select internal.fail('NOT_A_CODE') $$, '22023', null,
  'internal.fail rejects codes the app does not know');

select is(internal.trim_ws(E'\u00A0\u00A0'), '', 'trim_ws: NBSP-only input becomes empty');
select is(internal.trim_ws(E'  Milo \u3000'), 'Milo', 'trim_ws: strips spaces and U+3000');
select is(internal.trim_ws(E'\t\n Pip  Squeak \r\uFEFF'), 'Pip  Squeak',
  'trim_ws: keeps inner whitespace');
select is(internal.trim_ws(null), null, 'trim_ws: null stays null');
select results_eq(
  $$ select cp from generate_series(1, 65535) cp
      where (cp < 55296 or cp > 57343) and internal.trim_ws(chr(cp)) = '' order by cp $$,
  $$ values (9), (10), (11), (12), (13), (32), (160), (5760), (8192), (8193), (8194), (8195),
            (8196), (8197), (8198), (8199), (8200), (8201), (8202), (8232), (8233), (8239),
            (8287), (12288), (65279) $$,
  'trim_ws strips exactly the characters JavaScript String.prototype.trim strips'
);

select * from finish();
rollback;
