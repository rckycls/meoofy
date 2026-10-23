-- Deleting an auth user strips their id from the audit trail (20261023000009_audit_identity_strip.sql,
-- spec §10, Ruling 24): the AFTER DELETE trigger on auth.users nulls actor_id and subject_id wherever
-- they hold the deleted user's id, keeps everything else, and leaves audit.events append-only for
-- clients. Uses tests.create_user / tests.authenticate_as / tests.clear_auth from 000_helpers.sql.
--
-- U is deleted; K is kept. U acts (profile, onboarding, a pet), K acts on their own profile, K
-- appears as the actor of an event about U, and the system records account.deleted.
begin;
select plan(18);

do $$
begin
  perform set_config('pawpin.u', tests.create_user('strip-u@pawpin.test')::text, true);
  perform set_config('pawpin.k', tests.create_user('strip-k@pawpin.test')::text, true);
  perform set_config('pawpin.last_event', coalesce(max(id), 0)::text, true) from audit.events;
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
select tests.authenticate_as(current_setting('pawpin.u')::uuid);
select lives_ok($$ select api.update_profile('Uma') $$, 'U updates their profile (U is actor and subject)');
select lives_ok($$ select api.complete_onboarding('owner') $$,
  'U completes onboarding (U is actor and subject)');
select lives_ok(
  $$ select api.create_pet('a7000000-0000-4000-8000-000000000001', 'Milo', 'dog', null, null) $$,
  'U creates a pet (U is actor, the pet is the subject)');
select tests.authenticate_as(current_setting('pawpin.k')::uuid);
select lives_ok($$ select api.update_profile('Kai') $$, 'K updates their own profile');
select tests.clear_auth();

-- An event by K about U, and the system's account.deleted (no actor, no subject).
insert into audit.events (actor_id, action, subject_type, subject_id)
values (current_setting('pawpin.k')::uuid, 'user.reported', 'user', current_setting('pawpin.u')::uuid);
set local role service_role;
select api.record_account_deleted();
reset role;

select is(
  (select count(*)::int from audit.events
    where current_setting('pawpin.u')::uuid in (actor_id, subject_id)),
  4, 'before the delete, four events reference U');

create temp table before_delete as
select id, action, subject_type, metadata, created_at
  from audit.events where id > current_setting('pawpin.last_event')::bigint;

-- ---------------------------------------------------------------------------
-- Delete U
-- ---------------------------------------------------------------------------
select lives_ok($$ delete from auth.users where id = current_setting('pawpin.u')::uuid $$,
  'deleting U as postgres (the dashboard / SQL path) succeeds');

select is(
  (select count(*)::int from audit.events
    where current_setting('pawpin.u')::uuid in (actor_id, subject_id)),
  0, 'no event references U in actor_id or subject_id any more');
select results_eq(
  $$ select id, action, subject_type, metadata, created_at from audit.events
      where id > current_setting('pawpin.last_event')::bigint order by id $$,
  $$ select id, action, subject_type, metadata, created_at from before_delete order by id $$,
  'every event survives with its action, subject type, metadata and time'
);
select results_eq(
  $$ select action, actor_id, subject_id from audit.events
      where id > current_setting('pawpin.last_event')::bigint order by id $$,
  $$ values ('profile.updated', null::uuid, null::uuid),
            ('onboarding.completed', null, null),
            ('pet.created', null, 'a7000000-0000-4000-8000-000000000001'::uuid),
            ('profile.updated', current_setting('pawpin.k')::uuid, current_setting('pawpin.k')::uuid),
            ('user.reported', current_setting('pawpin.k')::uuid, null),
            ('account.deleted', null, null) $$,
  'only U''s id is stripped: other users and other subjects keep theirs'
);
select results_eq(
  $$ select actor_id, subject_id, metadata from audit.events
      where action = 'account.deleted' and id > current_setting('pawpin.last_event')::bigint $$,
  $$ values (null::uuid, null::uuid, '{}'::jsonb) $$,
  'the account.deleted event still has no actor, no subject and empty metadata'
);

-- One statement deleting several users strips each of them.
do $$
declare
  v uuid := tests.create_user('strip-v@pawpin.test');
  w uuid := tests.create_user('strip-w@pawpin.test');
begin
  perform set_config('pawpin.v', v::text, true);
  perform set_config('pawpin.w', w::text, true);
  insert into audit.events (actor_id, action, subject_type, subject_id)
  values (v, 'profile.updated', 'profile', v), (w, 'profile.updated', 'profile', w),
         (v, 'user.reported', 'user', w);
end
$$;
delete from auth.users
 where id in (current_setting('pawpin.v')::uuid, current_setting('pawpin.w')::uuid);
select is(
  (select count(*)::int from audit.events
    where current_setting('pawpin.v')::uuid in (actor_id, subject_id)
       or current_setting('pawpin.w')::uuid in (actor_id, subject_id)),
  0, 'a statement deleting two users strips both');

-- ---------------------------------------------------------------------------
-- audit.events stays append-only for clients
-- ---------------------------------------------------------------------------
select tests.authenticate_as(current_setting('pawpin.k')::uuid);
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
