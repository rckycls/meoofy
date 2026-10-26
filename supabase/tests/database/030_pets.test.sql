-- Pet write paths (api.create_pet, api.update_pet, api.delete_pet), the read views api.pets and
-- api.my_entitlement, the tier limit (also under truly concurrent calls) and the audit events.
-- Uses tests.create_user / tests.authenticate_as / tests.clear_auth from 000_helpers.sql.
--
-- Users: A (free, then pro, then max) for the limit, idempotency, update and delete; B for owner
-- isolation; V (max, so the limit never interferes) for validation boundaries; N, whose account row
-- is removed. C and D are committed through dblink for the concurrency section and removed after.
begin;
select plan(119);

do $$
begin
  perform set_config('meoofy.a', tests.create_user('pets-a@meoofy.test')::text, true);
  perform set_config('meoofy.b', tests.create_user('pets-b@meoofy.test')::text, true);
  perform set_config('meoofy.v', tests.create_user('pets-v@meoofy.test')::text, true);
  perform set_config('meoofy.n', tests.create_user('pets-n@meoofy.test')::text, true);
end
$$;

update entitlements.accounts set tier = 'max' where owner_id = current_setting('meoofy.v')::uuid;

-- ---------------------------------------------------------------------------
-- Shape and privileges
-- ---------------------------------------------------------------------------
select is(
  (select p.proargnames from pg_proc p
    where p.oid = to_regprocedure('api.create_pet(uuid, text, registry.species, text, integer)')),
  array['id', 'name', 'species', 'breed', 'age_months'],
  'api.create_pet(id, name, species, breed, age_months) exists'
);
select is(
  (select p.proargnames from pg_proc p
    where p.oid = to_regprocedure(
      'api.update_pet(uuid, text, registry.species, text, integer, boolean, boolean)')),
  array['id', 'name', 'species', 'breed', 'age_months', 'clear_breed', 'clear_age'],
  'api.update_pet(id, name, species, breed, age_months, clear_breed, clear_age) exists'
);
select is(
  (select p.pronargdefaults::int from pg_proc p
    where p.oid = to_regprocedure(
      'api.update_pet(uuid, text, registry.species, text, integer, boolean, boolean)')),
  6, 'every api.update_pet argument but id has a default'
);
select is(
  (select p.proargnames from pg_proc p where p.oid = to_regprocedure('api.delete_pet(uuid)')),
  array['id'], 'api.delete_pet(id) exists'
);
select results_eq(
  $$ select p.oid::regprocedure::text, p.prorettype::regtype::text
       from pg_proc p
      where p.oid in (to_regprocedure('api.create_pet(uuid, text, registry.species, text, integer)'),
                      to_regprocedure('api.update_pet(uuid, text, registry.species, text, integer, boolean, boolean)'),
                      to_regprocedure('api.delete_pet(uuid)'))
      order by 1 $$,
  $$ values ('api.create_pet(uuid,text,registry.species,text,integer)', 'registry.pets'),
            ('api.delete_pet(uuid)', 'void'),
            ('api.update_pet(uuid,text,registry.species,text,integer,boolean,boolean)', 'registry.pets') $$,
  'create_pet and update_pet return registry.pets; delete_pet returns void'
);
select is(
  (select count(*)::int from pg_proc p
    where p.oid in (to_regprocedure('api.create_pet(uuid, text, registry.species, text, integer)'),
                    to_regprocedure('api.update_pet(uuid, text, registry.species, text, integer, boolean, boolean)'),
                    to_regprocedure('api.delete_pet(uuid)'))
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  3, 'authenticated can execute create_pet, update_pet and delete_pet'
);

select columns_are('api', 'pets',
  array['id', 'name', 'species', 'breed', 'age_months', 'registration_state', 'discovery_enabled',
        'created_at', 'updated_at']);
select columns_are('api', 'my_entitlement', array['tier', 'pet_limit', 'active_pets']);
select ok((select c.relkind = 'v' and coalesce(c.reloptions, '{}') @> array['security_invoker=true']
             from pg_class c where c.oid = to_regclass('api.pets')),
  'api.pets is a security_invoker view');
select ok((select c.relkind = 'v' and coalesce(c.reloptions, '{}') @> array['security_invoker=true']
             from pg_class c where c.oid = to_regclass('api.my_entitlement')),
  'api.my_entitlement is a security_invoker view');
select table_privs_are('api', 'pets', 'authenticated', array['SELECT']);
select table_privs_are('api', 'pets', 'anon', array[]::text[]);
select table_privs_are('api', 'my_entitlement', 'authenticated', array['SELECT']);
select table_privs_are('api', 'my_entitlement', 'anon', array[]::text[]);

-- ---------------------------------------------------------------------------
-- Unauthenticated callers
-- ---------------------------------------------------------------------------
select throws_ok($$ select api.create_pet(gen_random_uuid(), 'Milo', 'dog', null, null) $$,
  'P0001', 'MEOOFY:UNAUTHENTICATED', 'create_pet without a JWT throws UNAUTHENTICATED');
select throws_ok($$ select api.update_pet(gen_random_uuid(), name => 'Milo') $$,
  'P0001', 'MEOOFY:UNAUTHENTICATED', 'update_pet without a JWT throws UNAUTHENTICATED');
select throws_ok($$ select api.delete_pet(gen_random_uuid()) $$,
  'P0001', 'MEOOFY:UNAUTHENTICATED', 'delete_pet without a JWT throws UNAUTHENTICATED');

-- The authenticated role with no usable subject claim (a token without sub).
do $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '', true);
end
$$;
select throws_ok($$ select api.create_pet(gen_random_uuid(), 'Milo', 'dog', null, null) $$,
  'P0001', 'MEOOFY:UNAUTHENTICATED', 'create_pet with no subject claim throws UNAUTHENTICATED');
select throws_ok($$ select api.update_pet(gen_random_uuid(), name => 'Milo') $$,
  'P0001', 'MEOOFY:UNAUTHENTICATED', 'update_pet with no subject claim throws UNAUTHENTICATED');
select throws_ok($$ select api.delete_pet(gen_random_uuid()) $$,
  'P0001', 'MEOOFY:UNAUTHENTICATED', 'delete_pet with no subject claim throws UNAUTHENTICATED');
select is_empty($$ select 1 from api.pets $$, 'api.pets is empty with no subject claim');
select is_empty($$ select 1 from api.my_entitlement $$,
  'api.my_entitlement is empty with no subject claim');

-- The anon role cannot reach any of it.
do $$ begin perform set_config('role', 'anon', true); end $$;
select throws_ok($$ select api.create_pet(gen_random_uuid(), 'Milo', 'dog', null, null) $$,
  '42501', null, 'anon cannot call create_pet');
select throws_ok($$ select api.update_pet(gen_random_uuid(), name => 'Milo') $$,
  '42501', null, 'anon cannot call update_pet');
select throws_ok($$ select api.delete_pet(gen_random_uuid()) $$,
  '42501', null, 'anon cannot call delete_pet');
select throws_ok($$ select * from api.pets $$, '42501', null, 'anon cannot read api.pets');
select throws_ok($$ select * from api.my_entitlement $$, '42501', null,
  'anon cannot read api.my_entitlement');
reset role;

-- ---------------------------------------------------------------------------
-- create_pet and the Free limit (user A)
-- ---------------------------------------------------------------------------
select tests.authenticate_as(current_setting('meoofy.a')::uuid);

select results_eq(
  $$ select id, owner_id = auth.uid(), name, species::text, breed, age_months,
            registration_state::text, discovery_enabled
       from api.create_pet('a6000000-0000-4000-8000-000000000001', E'  Milo  ', 'dog',
                           '  Beagle  ', 24) $$,
  $$ values ('a6000000-0000-4000-8000-000000000001'::uuid, true, 'Milo', 'dog', 'Beagle', 24,
             'private', false) $$,
  'create_pet returns the new private pet with its name and breed trimmed'
);
select results_eq(
  $$ select name, species::text, breed, age_months, registration_state::text, discovery_enabled
       from api.pets where id = 'a6000000-0000-4000-8000-000000000001' $$,
  $$ values ('Milo', 'dog', 'Beagle', 24, 'private', false) $$,
  'the new pet is stored and readable through api.pets'
);
select results_eq(
  $$ select actor_id = auth.uid(), subject_type, subject_id, metadata
       from audit.events where action = 'pet.created' $$,
  $$ values (true, 'pet', 'a6000000-0000-4000-8000-000000000001'::uuid,
             '{"species": "dog"}'::jsonb) $$,
  'create_pet writes one pet.created event whose metadata has the species and not the name'
);

select results_eq(
  $$ select breed, age_months
       from api.create_pet('a6000000-0000-4000-8000-000000000002', 'Luna', 'cat', E' 　 ', null) $$,
  $$ values (null::text, null::integer) $$,
  'a whitespace-only breed is stored as null, and the age may be unknown'
);
select lives_ok(
  $$ select api.create_pet('a6000000-0000-4000-8000-000000000003', 'Pip', 'dog', null, 0) $$,
  'A creates a third pet (age 0 is allowed)');
select results_eq($$ select tier::text, pet_limit, active_pets from api.my_entitlement $$,
  $$ values ('free', 3, 3) $$,
  'api.my_entitlement shows the free tier, its limit of 3 and 3 active pets');

select throws_ok(
  $$ select api.create_pet('a6000000-0000-4000-8000-000000000004', 'Rex', 'dog', null, null) $$,
  'P0001', 'MEOOFY:PET_LIMIT_REACHED', 'a free owner''s 4th pet throws PET_LIMIT_REACHED');
select results_eq(
  $$ select (select count(*)::int from api.pets),
            (select count(*)::int from audit.events where action = 'pet.created') $$,
  $$ values (3, 3) $$,
  'the rejected 4th pet added no row and no event'
);

-- Idempotent retries: the client generates the id, so a retried create returns the stored pet.
select results_eq(
  $$ select r.id, r.name, r.species::text, r.breed, r.age_months, r = p
       from api.create_pet('a6000000-0000-4000-8000-000000000001', 'Other', 'cat', 'Poodle', 100) r
       join registry.pets p on p.id = r.id $$,
  $$ values ('a6000000-0000-4000-8000-000000000001'::uuid, 'Milo', 'dog', 'Beagle', 24, true) $$,
  'repeating create_pet with an existing id returns the stored row unchanged, even at the limit'
);
select results_eq(
  $$ select (select count(*)::int from api.pets),
            (select count(*)::int from audit.events where action = 'pet.created') $$,
  $$ values (3, 3) $$,
  'the repeated create added no row and no event'
);

-- Archived pets free their slot.
select tests.clear_auth();
update registry.pets set registration_state = 'archived'
 where id = 'a6000000-0000-4000-8000-000000000003';
select tests.authenticate_as(current_setting('meoofy.a')::uuid);

select results_eq($$ select active_pets from api.my_entitlement $$, $$ values (2) $$,
  'api.my_entitlement does not count archived pets as active');
select lives_ok(
  $$ select api.create_pet('a6000000-0000-4000-8000-000000000004', 'Rex', 'dog', null, null) $$,
  'with one pet archived, A can create another');
select throws_ok(
  $$ select api.create_pet('a6000000-0000-4000-8000-000000000005', 'Fig', 'cat', null, null) $$,
  'P0001', 'MEOOFY:PET_LIMIT_REACHED',
  'archived pets don''t count toward the limit, but private ones do');

-- Pro allows 10, Max is unlimited.
select tests.clear_auth();
update entitlements.accounts set tier = 'pro' where owner_id = current_setting('meoofy.a')::uuid;
select tests.authenticate_as(current_setting('meoofy.a')::uuid);

select lives_ok(
  $$ select api.create_pet('a6000000-0000-4000-8000-000000000005', 'Fig', 'cat', null, null) $$,
  'after A moves to pro, a 4th private pet is allowed');
select results_eq($$ select tier::text, pet_limit, active_pets from api.my_entitlement $$,
  $$ values ('pro', 10, 4) $$, 'api.my_entitlement shows the pro tier and its limit of 10');
select lives_ok(
  $$ select api.create_pet(gen_random_uuid(), 'Pet ' || n, 'cat', null, null)
       from generate_series(5, 10) n $$,
  'a pro owner can have 10 private pets');
select throws_ok($$ select api.create_pet(gen_random_uuid(), 'Eleven', 'dog', null, null) $$,
  'P0001', 'MEOOFY:PET_LIMIT_REACHED', 'a pro owner''s 11th private pet throws PET_LIMIT_REACHED');

select tests.clear_auth();
update entitlements.accounts set tier = 'max' where owner_id = current_setting('meoofy.a')::uuid;
select tests.authenticate_as(current_setting('meoofy.a')::uuid);

select lives_ok($$ select api.create_pet(gen_random_uuid(), 'Eleven', 'dog', null, null) $$,
  'a max owner has no pet limit');
select results_eq($$ select tier::text, pet_limit, active_pets from api.my_entitlement $$,
  $$ values ('max', null::integer, 11) $$,
  'api.my_entitlement shows max as unlimited (null) with 11 active pets');

-- ---------------------------------------------------------------------------
-- create_pet validation (user V, on max so the limit never interferes)
-- ---------------------------------------------------------------------------
select tests.authenticate_as(current_setting('meoofy.v')::uuid);

select lives_ok(
  $$ select api.create_pet('a7000000-0000-4000-8000-000000000001', repeat('🐶', 40), 'dog', null, null) $$,
  'create_pet accepts 40 emoji');
select is((select char_length(name) from api.pets where id = 'a7000000-0000-4000-8000-000000000001'),
  40, '40 emoji are stored as 40 characters');
select throws_ok($$ select api.create_pet(gen_random_uuid(), repeat('🐶', 41), 'dog', null, null) $$,
  'P0001', 'MEOOFY:VALIDATION', 'create_pet rejects 41 emoji');
select lives_ok(
  $$ select api.create_pet('a7000000-0000-4000-8000-000000000002',
                           E'　 ' || repeat('a', 40) || E'  ', 'cat',
                           ' ' || repeat('b', 80) || ' ', 360) $$,
  'a 40-character name and an 80-character breed inside whitespace are accepted, as is age 360');
select results_eq(
  $$ select name, breed, age_months from api.pets where id = 'a7000000-0000-4000-8000-000000000002' $$,
  $$ values (repeat('a', 40), repeat('b', 80), 360) $$,
  'surrounding whitespace is trimmed before the length check and before storing'
);

select throws_ok($$ select api.create_pet(gen_random_uuid(), '   ', 'dog', null, null) $$,
  'P0001', 'MEOOFY:VALIDATION', 'a blank name throws VALIDATION');
select throws_ok($$ select api.create_pet(gen_random_uuid(), E' 　', 'dog', null, null) $$,
  'P0001', 'MEOOFY:VALIDATION', 'a name of only non-ASCII whitespace throws VALIDATION');
select throws_ok($$ select api.create_pet(gen_random_uuid(), '', 'dog', null, null) $$,
  'P0001', 'MEOOFY:VALIDATION', 'an empty name throws VALIDATION');
select throws_ok($$ select api.create_pet(gen_random_uuid(), null, 'dog', null, null) $$,
  'P0001', 'MEOOFY:VALIDATION', 'a null name throws VALIDATION');
select throws_ok($$ select api.create_pet(gen_random_uuid(), 'Pip', 'dog', repeat('b', 81), null) $$,
  'P0001', 'MEOOFY:VALIDATION', 'a breed over 80 characters throws VALIDATION');
select throws_ok($$ select api.create_pet(gen_random_uuid(), 'Pip', 'dog', null, 361) $$,
  'P0001', 'MEOOFY:VALIDATION', 'age_months 361 throws VALIDATION');
select throws_ok($$ select api.create_pet(gen_random_uuid(), 'Pip', 'dog', null, -1) $$,
  'P0001', 'MEOOFY:VALIDATION', 'a negative age throws VALIDATION');
select throws_ok($$ select api.create_pet(gen_random_uuid(), 'Pip', null, null, null) $$,
  'P0001', 'MEOOFY:VALIDATION', 'a null species throws VALIDATION');
select throws_ok($$ select api.create_pet(null, 'Pip', 'dog', null, null) $$,
  'P0001', 'MEOOFY:VALIDATION', 'a null id throws VALIDATION');
select results_eq(
  $$ select (select count(*)::int from api.pets), (select count(*)::int from audit.events) $$,
  $$ values (2, 2) $$,
  'rejected creates added no rows and no events'
);

-- ---------------------------------------------------------------------------
-- Photos for A's pets (fixtures inserted as postgres; Task 7 owns the photo functions)
-- ---------------------------------------------------------------------------
select tests.clear_auth();
insert into registry.pet_photos (id, pet_id, owner_id, view, storage_path, bytes, width, height,
                                 status, confirmed_at)
values
  ('a6000000-0000-4000-8000-0000000000f1', 'a6000000-0000-4000-8000-000000000002',
   current_setting('meoofy.a')::uuid, 'front',
   current_setting('meoofy.a') || '/a6000000-0000-4000-8000-000000000002/a6000000-0000-4000-8000-0000000000f1.jpg',
   1000, 1600, 1200, 'ready', now()),
  ('a6000000-0000-4000-8000-0000000000f2', 'a6000000-0000-4000-8000-000000000002',
   current_setting('meoofy.a')::uuid, 'side',
   current_setting('meoofy.a') || '/a6000000-0000-4000-8000-000000000002/a6000000-0000-4000-8000-0000000000f2.jpg',
   1000, null, null, 'pending', null),
  ('a6000000-0000-4000-8000-0000000000f3', 'a6000000-0000-4000-8000-000000000004',
   current_setting('meoofy.a')::uuid, 'front',
   current_setting('meoofy.a') || '/a6000000-0000-4000-8000-000000000004/a6000000-0000-4000-8000-0000000000f3.jpg',
   1000, 1600, 1200, 'ready', now());

-- ---------------------------------------------------------------------------
-- Owner isolation (user B)
-- ---------------------------------------------------------------------------
select tests.authenticate_as(current_setting('meoofy.b')::uuid);

select throws_ok(
  $$ select api.create_pet('a6000000-0000-4000-8000-000000000001', 'Milo', 'dog', null, null) $$,
  'P0001', 'MEOOFY:NOT_OWNER', 'create_pet with another owner''s pet id throws NOT_OWNER');
select throws_ok(
  $$ select api.update_pet('a6000000-0000-4000-8000-000000000001', name => 'Hacked') $$,
  'P0001', 'MEOOFY:NOT_OWNER', 'B updating A''s pet throws NOT_OWNER');
select throws_ok(
  $$ select api.update_pet('a6000000-0000-4000-8000-000000000001', name => '   ') $$,
  'P0001', 'MEOOFY:NOT_OWNER', 'ownership is checked before validation');
select throws_ok($$ select api.delete_pet('a6000000-0000-4000-8000-000000000002') $$,
  'P0001', 'MEOOFY:NOT_OWNER', 'B deleting A''s pet throws NOT_OWNER');
select throws_ok($$ select api.update_pet(gen_random_uuid(), name => 'Ghost') $$,
  'P0001', 'MEOOFY:NOT_OWNER', 'updating a pet that does not exist throws NOT_OWNER');
select throws_ok($$ select api.delete_pet(gen_random_uuid()) $$,
  'P0001', 'MEOOFY:NOT_OWNER', 'deleting a pet that does not exist throws NOT_OWNER');

select is_empty($$ select 1 from api.pets $$, 'user B sees none of A''s pets in api.pets');
select results_eq($$ select tier::text, pet_limit, active_pets from api.my_entitlement $$,
  $$ values ('free', 3, 0) $$, 'user B''s api.my_entitlement is B''s own single row');
select lives_ok(
  $$ select api.create_pet('b6000000-0000-4000-8000-000000000001', 'Rex', 'cat', null, null) $$,
  'user B creates a pet of their own');
select results_eq($$ select id from api.pets $$,
  $$ values ('b6000000-0000-4000-8000-000000000001'::uuid) $$, 'user B sees only their own pet');
select results_eq($$ select active_pets from api.my_entitlement $$, $$ values (1) $$,
  'user B''s active_pets counts only B''s pets');
select results_eq($$ select action from audit.events $$, $$ values ('pet.created') $$,
  'user B''s rejected calls wrote no events');

select tests.clear_auth();
select results_eq(
  $$ select (select count(*)::int from registry.pet_photos
              where pet_id = 'a6000000-0000-4000-8000-000000000002'),
            (select count(*)::int from registry.storage_deletions
              where storage_path like current_setting('meoofy.a') || '/%') $$,
  $$ values (2, 0) $$,
  'B''s rejected delete kept A''s photos and queued nothing'
);

select tests.authenticate_as(current_setting('meoofy.a')::uuid);
select results_eq(
  $$ select name, species::text from api.pets where id = 'a6000000-0000-4000-8000-000000000001' $$,
  $$ values ('Milo', 'dog') $$, 'A''s pet is untouched by B''s attempts');
select results_eq(
  $$ select (select count(*)::int from api.pets), (select active_pets from api.my_entitlement) $$,
  $$ values (12, 11) $$,
  'A sees only their own 12 pets, and active_pets counts only A''s 11 private pets'
);

-- ---------------------------------------------------------------------------
-- update_pet (user A)
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select name, species::text, breed, age_months
       from api.update_pet('a6000000-0000-4000-8000-000000000001', name => E'  Milo II　') $$,
  $$ values ('Milo II', 'dog', 'Beagle', 24) $$,
  'update_pet trims the name and leaves the fields it was not given unchanged'
);
select results_eq(
  $$ select actor_id = auth.uid(), subject_type, subject_id, metadata
       from audit.events where action = 'pet.updated' $$,
  $$ values (true, 'pet', 'a6000000-0000-4000-8000-000000000001'::uuid, '{}'::jsonb) $$,
  'update_pet writes one pet.updated event with empty metadata'
);
select results_eq(
  $$ select name, species::text, breed, age_months
       from api.update_pet('a6000000-0000-4000-8000-000000000001', species => 'cat',
                           breed => ' Siamese ', age_months => 30) $$,
  $$ values ('Milo II', 'cat', 'Siamese', 30) $$,
  'update_pet changes species, breed and age together'
);
select results_eq(
  $$ select breed, age_months
       from api.update_pet('a6000000-0000-4000-8000-000000000001', clear_breed => true) $$,
  $$ values (null::text, 30) $$,
  'update_pet with clear_breed => true sets breed null'
);
select results_eq(
  $$ select breed, age_months
       from api.update_pet('a6000000-0000-4000-8000-000000000001', breed => 'Tabby',
                           clear_age => true) $$,
  $$ values ('Tabby', null::integer) $$,
  'update_pet with clear_age => true sets age null'
);
select results_eq(
  $$ select breed from api.update_pet('a6000000-0000-4000-8000-000000000001', breed => E'   ') $$,
  $$ values (null::text) $$,
  'a whitespace-only breed clears it, as the client''s empty breed does'
);
select results_eq(
  $$ select name, species::text, breed, age_months
       from api.update_pet('a6000000-0000-4000-8000-000000000001') $$,
  $$ values ('Milo II', 'cat', null::text, null::integer) $$,
  'update_pet with no fields returns the pet unchanged'
);

select throws_ok($$ select api.update_pet('a6000000-0000-4000-8000-000000000001', name => '   ') $$,
  'P0001', 'MEOOFY:VALIDATION', 'update_pet rejects a blank name');
select throws_ok(
  $$ select api.update_pet('a6000000-0000-4000-8000-000000000001', name => repeat('🐶', 41)) $$,
  'P0001', 'MEOOFY:VALIDATION', 'update_pet rejects 41 emoji');
select throws_ok(
  $$ select api.update_pet('a6000000-0000-4000-8000-000000000001', breed => repeat('b', 81)) $$,
  'P0001', 'MEOOFY:VALIDATION', 'update_pet rejects a breed over 80 characters');
select throws_ok(
  $$ select api.update_pet('a6000000-0000-4000-8000-000000000001', age_months => 361) $$,
  'P0001', 'MEOOFY:VALIDATION', 'update_pet rejects age_months 361');
select throws_ok(
  $$ select api.update_pet('a6000000-0000-4000-8000-000000000001', age_months => -1) $$,
  'P0001', 'MEOOFY:VALIDATION', 'update_pet rejects a negative age');
select throws_ok(
  $$ select api.update_pet('a6000000-0000-4000-8000-000000000001', breed => 'Lab',
                           clear_breed => true) $$,
  'P0001', 'MEOOFY:VALIDATION', 'update_pet rejects a breed together with clear_breed');
select throws_ok(
  $$ select api.update_pet('a6000000-0000-4000-8000-000000000001', age_months => 12,
                           clear_age => true) $$,
  'P0001', 'MEOOFY:VALIDATION', 'update_pet rejects an age together with clear_age');
select throws_ok($$ select api.update_pet(null, name => 'Pip') $$,
  'P0001', 'MEOOFY:VALIDATION', 'update_pet with a null id throws VALIDATION');
select results_eq(
  $$ select name, species::text, breed, age_months
       from api.pets where id = 'a6000000-0000-4000-8000-000000000001' $$,
  $$ values ('Milo II', 'cat', null::text, null::integer) $$,
  'rejected updates leave the pet unchanged'
);
select is((select count(*)::int from audit.events where action = 'pet.updated'), 6,
  'each successful update wrote exactly one pet.updated event and rejected ones wrote none');

-- ---------------------------------------------------------------------------
-- delete_pet (user A)
-- ---------------------------------------------------------------------------
select lives_ok($$ select api.delete_pet('a6000000-0000-4000-8000-000000000002') $$,
  'A deletes a pet that has two photos');
select is_empty($$ select 1 from api.pets where id = 'a6000000-0000-4000-8000-000000000002' $$,
  'delete_pet removes the pet');
select is_empty(
  $$ select 1 from registry.pet_photos where pet_id = 'a6000000-0000-4000-8000-000000000002' $$,
  'delete_pet cascades to the pet''s photos');
select results_eq($$ select id from registry.pet_photos $$,
  $$ values ('a6000000-0000-4000-8000-0000000000f3'::uuid) $$,
  'photos of A''s other pets are kept');
select results_eq(
  $$ select actor_id = auth.uid(), subject_type, subject_id, metadata
       from audit.events where action = 'pet.deleted' $$,
  $$ values (true, 'pet', 'a6000000-0000-4000-8000-000000000002'::uuid,
             '{"photo_count": 2}'::jsonb) $$,
  'delete_pet writes one pet.deleted event with the photo count and no paths'
);

select tests.clear_auth();
select results_eq(
  $$ select storage_path, attempts, last_error from registry.storage_deletions
      where storage_path like current_setting('meoofy.a') || '/%' order by storage_path $$,
  format(
    $$ values (%L, 0, null::text), (%L, 0, null::text) $$,
    current_setting('meoofy.a') || '/a6000000-0000-4000-8000-000000000002/a6000000-0000-4000-8000-0000000000f1.jpg',
    current_setting('meoofy.a') || '/a6000000-0000-4000-8000-000000000002/a6000000-0000-4000-8000-0000000000f2.jpg'),
  'delete_pet queues one storage deletion per photo path, ready or pending'
);
select tests.authenticate_as(current_setting('meoofy.a')::uuid);

select lives_ok($$ select api.delete_pet('a6000000-0000-4000-8000-000000000005') $$,
  'A deletes a pet without photos');
select results_eq(
  $$ select metadata from audit.events
      where action = 'pet.deleted' and subject_id = 'a6000000-0000-4000-8000-000000000005' $$,
  $$ values ('{"photo_count": 0}'::jsonb) $$,
  'deleting a pet without photos records a photo count of 0'
);
select throws_ok($$ select api.delete_pet('a6000000-0000-4000-8000-000000000002') $$,
  'P0001', 'MEOOFY:NOT_OWNER', 'deleting an already deleted pet throws NOT_OWNER');
select throws_ok($$ select api.delete_pet(null) $$,
  'P0001', 'MEOOFY:VALIDATION', 'delete_pet with a null id throws VALIDATION');
select results_eq(
  $$ select (select count(*)::int from api.pets), (select active_pets from api.my_entitlement) $$,
  $$ values (10, 9) $$,
  'deleted pets leave api.pets and stop counting as active'
);

-- ---------------------------------------------------------------------------
-- Audit: one event per success, never a name or a path
-- ---------------------------------------------------------------------------
select tests.clear_auth();

select results_eq(
  $$ select action, count(*)::int from audit.events
      where actor_id = current_setting('meoofy.a')::uuid group by action order by action $$,
  $$ values ('pet.created', 12), ('pet.deleted', 2), ('pet.updated', 6) $$,
  'each of A''s successful calls wrote exactly one event and rejected calls wrote none'
);
select results_eq(
  $$ select actor_id, count(*)::int from audit.events
      where actor_id in (current_setting('meoofy.b')::uuid, current_setting('meoofy.v')::uuid)
      group by actor_id order by count(*) $$,
  format($$ values (%L::uuid, 1), (%L::uuid, 2) $$,
         current_setting('meoofy.b'), current_setting('meoofy.v')),
  'B and V have one event per pet they created'
);
select is_empty(
  $$ select id from audit.events
      where action like 'pet.%'
        and metadata <> '{}'::jsonb
        and not (metadata - 'species' = '{}'::jsonb and metadata ->> 'species' in ('dog', 'cat'))
        and not (metadata - 'photo_count' = '{}'::jsonb
                 and jsonb_typeof(metadata -> 'photo_count') = 'number') $$,
  'pet event metadata is empty or holds only a species or a photo count, never a name or path'
);

-- ---------------------------------------------------------------------------
-- A caller whose account row no longer exists (deleted account, token still valid)
-- ---------------------------------------------------------------------------
delete from entitlements.accounts where owner_id = current_setting('meoofy.n')::uuid;
select tests.authenticate_as(current_setting('meoofy.n')::uuid);

select throws_ok($$ select api.create_pet(gen_random_uuid(), 'Ghost', 'dog', null, null) $$,
  'P0001', 'MEOOFY:UNAUTHENTICATED', 'create_pet without an account row throws UNAUTHENTICATED');
select is_empty($$ select 1 from api.my_entitlement $$,
  'api.my_entitlement is empty without an account row');
select tests.clear_auth();

-- ---------------------------------------------------------------------------
-- Concurrent calls: two real sessions through dblink
-- ---------------------------------------------------------------------------
-- The two sessions (s1, s2) cannot see this transaction's uncommitted rows, so a third (setup)
-- commits users C and D for them and removes them at the end. Emails and pet ids are new on every
-- run, and race users left behind by an aborted run are removed first, so reruns are safe. dblink
-- requires password authentication for a non-superuser, so the sessions connect back over TCP to
-- this server's address with the local Supabase default credentials (see `supabase status`).
-- lock_timeout turns a call that would block for good into an error instead of a hang. Calls whose
-- answers the assertions don't use run in DO blocks, so nothing but TAP reaches the output.
create extension if not exists dblink with schema extensions;

create function pg_temp.connection_string() returns text language sql as $$
  select format('host=%s port=%s dbname=%s user=postgres password=postgres',
                host(inet_server_addr()), current_setting('port'), current_database())
$$;

-- Opens a transaction on a session and acts as the given user in it.
create function pg_temp.begin_as(conn text, uid uuid) returns void language plpgsql as $$
begin
  perform extensions.dblink_exec(conn, 'begin');
  perform 1 from extensions.dblink(conn, format('select 1 from tests.authenticate_as(%L)', uid))
    as t(one int);
end
$$;

-- The create_pet call a session runs for this run's pet id number n (setting meoofy.race_<n>).
create function pg_temp.create_pet_sql(n int, name text) returns text language sql as $$
  select format('select id, name from api.create_pet(%L, %L, %L, null, null)',
                current_setting('meoofy.race_' || n), name, 'dog')
$$;

-- True once the waiter's backend is blocked by the holder's (polls for up to 10 seconds).
create function pg_temp.blocked_by(waiter text, holder text) returns boolean
language plpgsql as $$
begin
  for i in 1..200 loop
    if current_setting('meoofy.pid_' || holder)::int
       = any (pg_blocking_pids(current_setting('meoofy.pid_' || waiter)::int)) then
      return true;
    end if;
    perform pg_sleep(0.05);
  end loop;
  return false;
end
$$;

do $$
declare
  conn text;
  c uuid;
  d uuid;
begin
  foreach conn in array array['setup', 's1', 's2'] loop
    perform extensions.dblink_connect(conn, pg_temp.connection_string());
    perform extensions.dblink_exec(conn, $q$ set lock_timeout = '5s' $q$);
    perform set_config('meoofy.pid_' || conn,
      (select pid::text from extensions.dblink(conn, 'select pg_backend_pid()') as t(pid int)), true);
  end loop;
  for n in 1..4 loop
    perform set_config('meoofy.race_' || n, gen_random_uuid()::text, true);
  end loop;

  perform extensions.dblink_exec('setup', $q$
    delete from audit.events
     where actor_id in (select id from auth.users where email like 'pets-race-%@meoofy.test') $q$);
  perform extensions.dblink_exec('setup',
    $q$ delete from auth.users where email like 'pets-race-%@meoofy.test' $q$);

  select uid into c from extensions.dblink('setup',
    format('select tests.create_user(%L)', 'pets-race-c-' || gen_random_uuid() || '@meoofy.test'))
    as t(uid uuid);
  select uid into d from extensions.dblink('setup',
    format('select tests.create_user(%L)', 'pets-race-d-' || gen_random_uuid() || '@meoofy.test'))
    as t(uid uuid);
  perform set_config('meoofy.c', c::text, true);
  perform set_config('meoofy.d', d::text, true);

  -- C (free) starts with two pets, one below the limit.
  perform extensions.dblink_exec('setup', format(
    $q$ insert into registry.pets (id, owner_id, name, species)
        values (gen_random_uuid(), %L, 'One', 'dog'), (gen_random_uuid(), %L, 'Two', 'cat') $q$,
    c, c));
end
$$;

-- 1. Two creates for the same owner race for the last free slot.
do $$
begin
  perform pg_temp.begin_as('s1', current_setting('meoofy.c')::uuid);
  perform pg_temp.begin_as('s2', current_setting('meoofy.c')::uuid);
  perform * from extensions.dblink('s1', pg_temp.create_pet_sql(1, 'Three')) as t(id uuid, name text);
  perform extensions.dblink_send_query('s2', pg_temp.create_pet_sql(2, 'Four'));
end
$$;
select ok(pg_temp.blocked_by('s2', 's1'),
  'a second create for the same owner waits for the first to finish');
do $$ begin perform extensions.dblink_exec('s1', 'commit'); end $$;
select throws_ok($$ select * from extensions.dblink_get_result('s2') as t(id uuid, name text) $$,
  'P0001', 'MEOOFY:PET_LIMIT_REACHED',
  'concurrent creates never exceed the limit: the waiting create sees the 3rd pet and is refused');
do $$
begin
  perform * from extensions.dblink_get_result('s2') as t(id uuid, name text);
  perform extensions.dblink_exec('s2', 'rollback');
end
$$;
select is(
  (select count(*)::int from registry.pets
    where owner_id = current_setting('meoofy.c')::uuid and registration_state = 'private'),
  3, 'the owner ends with exactly 3 private pets');

-- 2. A create and its retry (same id, same owner) race.
do $$
begin
  perform extensions.dblink_exec('setup', format(
    'update entitlements.accounts set tier = %L where owner_id = %L', 'pro', current_setting('meoofy.c')));
  perform pg_temp.begin_as('s1', current_setting('meoofy.c')::uuid);
  perform pg_temp.begin_as('s2', current_setting('meoofy.c')::uuid);
  perform * from extensions.dblink('s1', pg_temp.create_pet_sql(3, 'Five')) as t(id uuid, name text);
  perform extensions.dblink_send_query('s2', pg_temp.create_pet_sql(3, 'Five'));
end
$$;
select ok(pg_temp.blocked_by('s2', 's1'), 'a retried create waits for the original to finish');
do $$ begin perform extensions.dblink_exec('s1', 'commit'); end $$;
select results_eq($$ select * from extensions.dblink_get_result('s2') as t(id uuid, name text) $$,
  $$ values (current_setting('meoofy.race_3')::uuid, 'Five') $$,
  'a concurrent retry returns the pet the original call created');
do $$
begin
  perform * from extensions.dblink_get_result('s2') as t(id uuid, name text);
  perform extensions.dblink_exec('s2', 'commit');
end
$$;
select results_eq(
  $$ select (select count(*)::int from registry.pets
              where id = current_setting('meoofy.race_3')::uuid),
            (select count(*)::int from audit.events
              where action = 'pet.created' and subject_id = current_setting('meoofy.race_3')::uuid) $$,
  $$ values (1, 1) $$,
  'the concurrent retry added no row and no event'
);

-- 3. Two owners race to create the same id.
do $$
begin
  perform pg_temp.begin_as('s1', current_setting('meoofy.c')::uuid);
  perform pg_temp.begin_as('s2', current_setting('meoofy.d')::uuid);
  perform * from extensions.dblink('s1', pg_temp.create_pet_sql(4, 'Six')) as t(id uuid, name text);
  perform extensions.dblink_send_query('s2', pg_temp.create_pet_sql(4, 'Six'));
end
$$;
select ok(pg_temp.blocked_by('s2', 's1'),
  'another owner''s create with the same id waits for the first insert');
do $$ begin perform extensions.dblink_exec('s1', 'commit'); end $$;
select throws_ok($$ select * from extensions.dblink_get_result('s2') as t(id uuid, name text) $$,
  'P0001', 'MEOOFY:NOT_OWNER',
  'a concurrent create of the same id by another owner throws NOT_OWNER, not a unique violation');
do $$
begin
  perform * from extensions.dblink_get_result('s2') as t(id uuid, name text);
  perform extensions.dblink_exec('s2', 'rollback');
end
$$;
select results_eq(
  $$ select owner_id from registry.pets where id = current_setting('meoofy.race_4')::uuid $$,
  $$ values (current_setting('meoofy.c')::uuid) $$,
  'the pet belongs to the owner whose create committed first'
);

-- Remove the committed fixtures (pets, photos, profiles and accounts cascade from auth.users).
do $$
begin
  perform extensions.dblink_exec('setup', format('delete from audit.events where actor_id in (%L, %L)',
    current_setting('meoofy.c'), current_setting('meoofy.d')));
  perform extensions.dblink_exec('setup', format('delete from auth.users where id in (%L, %L)',
    current_setting('meoofy.c'), current_setting('meoofy.d')));
  perform extensions.dblink_disconnect(conn) from unnest(array['setup', 's1', 's2']) conn;
end
$$;
select is(
  (select count(*)::int from auth.users
    where id in (current_setting('meoofy.c')::uuid, current_setting('meoofy.d')::uuid)),
  0, 'the concurrency fixtures are removed');

select * from finish();
rollback;
