-- Deleting an auth user strips their identity from the audit trail and purges their rejected
-- sign-ups (spec §10: "The audit trail keeps only the action and the time"; Ruling 24, and M1/M2
-- of the final review): the AFTER DELETE trigger on auth.users (20261023000009_audit_identity_strip.sql,
-- as 20261023000010_photo_reuse_and_cap.sql redefines it) clears the actor, subject and metadata of
-- every event the user acted in, clears the subject and metadata of every event about the user or
-- about anything the user acted on (their profile, pets and photos), keeps other users' ids, and
-- deletes the identity.signup_rejections rows for the user's email. audit.events stays append-only
-- for clients. Uses tests.create_user / tests.authenticate_as / tests.clear_auth from 000_helpers.sql.
--
-- U is deleted; K is kept. U acts (profile, onboarding, a pet, a photo), K acts on their own
-- profile and pet, K appears as the actor of an event about U, the system records an event about
-- U's photo and account.deleted, and both have rejected sign-ups logged.
begin;
select plan(22);

do $$
begin
  perform set_config('meoofy.u', tests.create_user('strip-u@meoofy.test')::text, true);
  perform set_config('meoofy.k', tests.create_user('strip-k@meoofy.test')::text, true);
  perform set_config('meoofy.last_event', coalesce(max(id), 0)::text, true) from audit.events;
end
$$;

-- ---------------------------------------------------------------------------
-- Shape, privileges and the trigger
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select pg_get_function_result(p.oid), p.prosecdef,
            coalesce(p.proconfig = array['search_path=""'], false)
       from pg_proc p where p.oid = to_regprocedure('audit.strip_user_identity()') $$,
  $$ values ('trigger', true, true) $$,
  'audit.strip_user_identity() is a security definer trigger function with an empty search_path'
);
select results_eq(
  $$ select has_function_privilege('anon', p.oid, 'EXECUTE'),
            has_function_privilege('authenticated', p.oid, 'EXECUTE'),
            has_function_privilege('service_role', p.oid, 'EXECUTE'),
            p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
       from pg_proc p where p.oid = to_regprocedure('audit.strip_user_identity()') $$,
  $$ values (false, false, false, false) $$,
  'no client role and not PUBLIC may execute it; only the trigger runs it'
);
select results_eq(
  $$ select pg_get_triggerdef(t.oid), t.tgenabled::text
       from pg_trigger t
      where t.tgrelid = 'auth.users'::regclass and t.tgname = 'on_auth_user_deleted' $$,
  $$ values ('CREATE TRIGGER on_auth_user_deleted AFTER DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION audit.strip_user_identity()', 'O') $$,
  'an enabled AFTER DELETE row trigger on auth.users runs it for every deleted user'
);

-- ---------------------------------------------------------------------------
-- Events that reference U as actor and as subject
-- ---------------------------------------------------------------------------
select tests.authenticate_as(current_setting('meoofy.u')::uuid);
select lives_ok($$ select api.update_profile('Uma') $$, 'U updates their profile (U is actor and subject)');
select lives_ok($$ select api.complete_onboarding('owner') $$,
  'U completes onboarding (U is actor and subject)');
select lives_ok(
  $$ select api.create_pet('a7000000-0000-4000-8000-000000000001', 'Milo', 'dog', null, null) $$,
  'U creates a pet (U is actor, the pet is the subject)');
select lives_ok(
  $$ select api.request_photo_upload('a7000000-0000-4000-8000-00000000f001',
       'a7000000-0000-4000-8000-000000000001', 'front', 'image/jpeg', 1000) $$,
  'U opens a photo upload (U is actor, the photo is the subject)');
select tests.authenticate_as(current_setting('meoofy.k')::uuid);
select lives_ok($$ select api.update_profile('Kai') $$, 'K updates their own profile');
select lives_ok(
  $$ select api.create_pet('a7000000-0000-4000-8000-000000000002', 'Kit', 'cat', null, null) $$,
  'K creates a pet of their own');
select tests.clear_auth();

-- An event by K about U, a system event about U's photo, and the system's account.deleted (no
-- actor, no subject).
insert into audit.events (actor_id, action, subject_type, subject_id, metadata)
values (current_setting('meoofy.k')::uuid, 'user.reported', 'user', current_setting('meoofy.u')::uuid,
        '{"reason": "spam"}'),
       (null, 'photo.expired', 'photo', 'a7000000-0000-4000-8000-00000000f001', '{"view": "front"}');
set local role service_role;
do $$ begin perform api.record_account_deleted(); end $$;
reset role;

-- Rejected sign-ups: U's address (logged before U was invited, in another case) and K's.
insert into identity.signup_rejections (email)
values ('Strip-U@Meoofy.test'), ('strip-u@meoofy.test'), ('strip-k@meoofy.test');

select is(
  (select count(*)::int from audit.events
    where current_setting('meoofy.u')::uuid in (actor_id, subject_id)),
  5, 'before the delete, five events reference U');

create temp table before_delete as
select id, action, subject_type, created_at
  from audit.events where id > current_setting('meoofy.last_event')::bigint;

-- ---------------------------------------------------------------------------
-- Delete U
-- ---------------------------------------------------------------------------
select lives_ok($$ delete from auth.users where id = current_setting('meoofy.u')::uuid $$,
  'deleting U as postgres (the dashboard / SQL path) succeeds');

select is(
  (select count(*)::int from audit.events
    where current_setting('meoofy.u')::uuid in (actor_id, subject_id)),
  0, 'no event references U in actor_id or subject_id any more');
select is(
  (select count(*)::int from audit.events
    where subject_id in ('a7000000-0000-4000-8000-000000000001',
                         'a7000000-0000-4000-8000-00000000f001')),
  0, 'no event references U''s pet or photo any more');
select results_eq(
  $$ select id, action, subject_type, created_at from audit.events
      where id > current_setting('meoofy.last_event')::bigint order by id $$,
  $$ select id, action, subject_type, created_at from before_delete order by id $$,
  'every event survives with its action, subject type and time'
);
select results_eq(
  $$ select action, actor_id, subject_id, metadata from audit.events
      where id > current_setting('meoofy.last_event')::bigint order by id $$,
  $$ values ('profile.updated', null::uuid, null::uuid, '{}'::jsonb),
            ('onboarding.completed', null, null, '{}'),
            ('pet.created', null, null, '{}'),
            ('photo.upload_requested', null, null, '{}'),
            ('profile.updated', current_setting('meoofy.k')::uuid, current_setting('meoofy.k')::uuid, '{}'),
            ('pet.created', current_setting('meoofy.k')::uuid,
             'a7000000-0000-4000-8000-000000000002'::uuid, '{"species": "cat"}'),
            ('user.reported', current_setting('meoofy.k')::uuid, null, '{}'),
            ('photo.expired', null, null, '{}'),
            ('account.deleted', null, null, '{}') $$,
  'U''s events keep only the action and the time; events about U lose their subject and metadata; K keeps everything of theirs'
);
select results_eq(
  $$ select email::text from identity.signup_rejections
      where email::text ilike 'strip-%@meoofy.test' order by 1 $$,
  $$ values ('strip-k@meoofy.test') $$,
  'U''s rejected sign-ups are deleted, whatever their case; K''s stay'
);
select results_eq(
  $$ select actor_id, subject_id, metadata from audit.events
      where action = 'account.deleted' and id > current_setting('meoofy.last_event')::bigint $$,
  $$ values (null::uuid, null::uuid, '{}'::jsonb) $$,
  'the account.deleted event still has no actor, no subject and empty metadata'
);

-- One statement deleting several users strips each of them.
do $$
declare
  v uuid := tests.create_user('strip-v@meoofy.test');
  w uuid := tests.create_user('strip-w@meoofy.test');
begin
  perform set_config('meoofy.v', v::text, true);
  perform set_config('meoofy.w', w::text, true);
  insert into audit.events (actor_id, action, subject_type, subject_id)
  values (v, 'profile.updated', 'profile', v), (w, 'profile.updated', 'profile', w),
         (v, 'user.reported', 'user', w);
end
$$;
delete from auth.users
 where id in (current_setting('meoofy.v')::uuid, current_setting('meoofy.w')::uuid);
select is(
  (select count(*)::int from audit.events
    where current_setting('meoofy.v')::uuid in (actor_id, subject_id)
       or current_setting('meoofy.w')::uuid in (actor_id, subject_id)),
  0, 'a statement deleting two users strips both');

-- ---------------------------------------------------------------------------
-- audit.events stays append-only for clients
-- ---------------------------------------------------------------------------
select tests.authenticate_as(current_setting('meoofy.k')::uuid);
select throws_ok($$ update audit.events set actor_id = null $$, '42501', null,
  'authenticated cannot update audit events');
select throws_ok($$ delete from audit.events $$, '42501', null,
  'authenticated cannot delete audit events');
select tests.clear_auth();

set local role anon;
select throws_ok($$ update audit.events set actor_id = null $$, '42501', null,
  'anon cannot update audit events');
select throws_ok($$ delete from audit.events $$, '42501', null,
  'anon cannot delete audit events');
reset role;

select * from finish();
rollback;
