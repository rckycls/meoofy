-- Storage cleanup and account deletion support (20261023000008_cleanup.sql):
-- registry.enqueue_stale_photos, registry.claim_storage_deletions,
-- registry.complete_storage_deletions, the service_role-only api wrappers the Edge Functions call
-- (Ruling 16) including api.record_account_deleted, the rule that a queued path a photo row
-- references again is never handed out (Ruling 20), and the storage-cleanup cron job. Uses
-- tests.create_user / tests.authenticate_as / tests.clear_auth from 000_helpers.sql.
--
-- User A owns Milo. Fixture photo rows and files are inserted as postgres (which bypasses row-level
-- security), so created_at can be set in the past.
begin;
select plan(57);

-- The queue may hold rows from manual runs against this database. Empty it inside this
-- transaction so the claims below see only this file's rows.
delete from registry.storage_deletions;

-- Records a file at `path` in pet-photos as the current role, the way Storage does after an
-- upload (row-level security applies). Only the row is written; no bytes are stored.
create function tests.upload(path text) returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner_id)
  values ('pet-photos', upload.path, auth.uid()::text)
$$;
grant execute on function tests.upload(text) to authenticated;

-- A second bucket, to prove orphans are looked for in pet-photos only.
insert into storage.buckets (id, name) values ('pawpin-test-cleanup', 'pawpin-test-cleanup');

do $$
declare
  a constant uuid := tests.create_user('cleanup-a@pawpin.test');
  pet constant uuid := 'a6000000-0000-4000-8000-000000000001';
  dir constant text := a || '/' || pet || '/';
begin
  perform set_config('pawpin.a', a::text, true);
  perform set_config('pawpin.pet', pet::text, true);
  -- pawpin.<key>: the storage path {owner}/{pet}/{photo}.jpg of each file in this test.
  perform set_config('pawpin.' || v.k, dir || 'a6000000-0000-4000-8000-00000000' || v.ph || '.jpg', true)
     from (values ('old', 'f001'),     -- pending, created 25 h ago, file uploaded
                  ('fresh', 'f002'),   -- pending, created 1 h ago
                  ('ready', 'f003'),   -- ready, created 25 h ago, file uploaded
                  ('orphan', 'f004'),  -- a file with no photo row
                  ('queued', 'f005'),  -- a file with no photo row that is already queued
                  ('other', 'f006'),   -- a file with no photo row in another bucket
                  ('reused', 'f007')   -- deleted, then the same photo id requested again
          ) v(k, ph);

  insert into registry.pets (id, owner_id, name, species) values (pet, a, 'Milo', 'dog');
  insert into registry.pet_photos (id, pet_id, owner_id, view, storage_path, bytes, status,
                                   created_at, width, height, confirmed_at)
  values ('a6000000-0000-4000-8000-00000000f001', pet, a, 'front', current_setting('pawpin.old'),
          1000, 'pending', now() - interval '25 hours', null, null, null),
         ('a6000000-0000-4000-8000-00000000f002', pet, a, 'side', current_setting('pawpin.fresh'),
          1000, 'pending', now() - interval '1 hour', null, null, null),
         ('a6000000-0000-4000-8000-00000000f003', pet, a, 'markings', current_setting('pawpin.ready'),
          1000, 'ready', now() - interval '25 hours', 1600, 1200, now() - interval '25 hours');

  insert into storage.objects (bucket_id, name, owner_id)
  values ('pet-photos', current_setting('pawpin.old'), a::text),
         ('pet-photos', current_setting('pawpin.ready'), a::text),
         ('pet-photos', current_setting('pawpin.orphan'), a::text),
         ('pet-photos', current_setting('pawpin.queued'), a::text),
         ('pawpin-test-cleanup', current_setting('pawpin.other'), a::text);

  insert into registry.storage_deletions (storage_path) values (current_setting('pawpin.queued'));
end
$$;

-- How many queue rows hold `key`'s path.
create function pg_temp.queued(key text) returns integer language sql as $$
  select count(*)::int from registry.storage_deletions
   where storage_path = current_setting('pawpin.' || key)
$$;

-- ---------------------------------------------------------------------------
-- Shape and privileges
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select p.oid::regprocedure::text, pg_get_function_result(p.oid), p.prosecdef,
            coalesce(p.proconfig = array['search_path=""'], false)
       from pg_proc p
      where p.oid in (to_regprocedure('registry.enqueue_stale_photos()'),
                      to_regprocedure('registry.claim_storage_deletions(integer)'),
                      to_regprocedure('registry.complete_storage_deletions(bigint[], jsonb)'),
                      to_regprocedure('api.record_account_deleted()'),
                      to_regprocedure('api.enqueue_stale_photos()'),
                      to_regprocedure('api.claim_storage_deletions(integer)'),
                      to_regprocedure('api.complete_storage_deletions(bigint[], jsonb)'))
      order by 1 $$,
  $$ values ('api.claim_storage_deletions(integer)', 'TABLE(id bigint, storage_path text)', true, true),
            ('api.complete_storage_deletions(bigint[],jsonb)', 'void', true, true),
            ('api.enqueue_stale_photos()', 'integer', true, true),
            ('api.record_account_deleted()', 'void', true, true),
            ('registry.claim_storage_deletions(integer)', 'SETOF registry.storage_deletions', false, true),
            ('registry.complete_storage_deletions(bigint[],jsonb)', 'void', false, true),
            ('registry.enqueue_stale_photos()', 'integer', false, true) $$,
  'the three cleanup functions and four api wrappers exist; the wrappers are security definer; all have an empty search_path'
);

select results_eq(
  $$ select p.oid::regprocedure::text, p.proargnames::text[] collate "default"
       from pg_proc p
      where p.oid in (to_regprocedure('registry.claim_storage_deletions(integer)'),
                      to_regprocedure('registry.complete_storage_deletions(bigint[], jsonb)'),
                      to_regprocedure('api.claim_storage_deletions(integer)'),
                      to_regprocedure('api.complete_storage_deletions(bigint[], jsonb)'))
      order by 1 $$,
  $$ values ('api.claim_storage_deletions(integer)', array['max', 'id', 'storage_path']),
            ('api.complete_storage_deletions(bigint[],jsonb)', array['done', 'failed']),
            ('registry.claim_storage_deletions(integer)', array['max']),
            ('registry.complete_storage_deletions(bigint[],jsonb)', array['done', 'failed']) $$,
  'claim takes (max) and complete takes (done, failed)'
);

select results_eq(
  $$ select p.oid::regprocedure::text,
            has_function_privilege('anon', p.oid, 'EXECUTE'),
            has_function_privilege('authenticated', p.oid, 'EXECUTE'),
            has_function_privilege('service_role', p.oid, 'EXECUTE'),
            p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
       from pg_proc p
      where p.oid in (to_regprocedure('registry.enqueue_stale_photos()'),
                      to_regprocedure('registry.claim_storage_deletions(integer)'),
                      to_regprocedure('registry.complete_storage_deletions(bigint[], jsonb)'),
                      to_regprocedure('api.record_account_deleted()'),
                      to_regprocedure('api.enqueue_stale_photos()'),
                      to_regprocedure('api.claim_storage_deletions(integer)'),
                      to_regprocedure('api.complete_storage_deletions(bigint[], jsonb)'))
      order by 1 $$,
  $$ values ('api.claim_storage_deletions(integer)', false, false, true, false),
            ('api.complete_storage_deletions(bigint[],jsonb)', false, false, true, false),
            ('api.enqueue_stale_photos()', false, false, true, false),
            ('api.record_account_deleted()', false, false, true, false),
            ('registry.claim_storage_deletions(integer)', false, false, true, false),
            ('registry.complete_storage_deletions(bigint[],jsonb)', false, false, true, false),
            ('registry.enqueue_stale_photos()', false, false, true, false) $$,
  'only service_role may execute them: not anon, not authenticated, not PUBLIC'
);

select tests.authenticate_as(current_setting('pawpin.a')::uuid);
select throws_ok($$ select api.record_account_deleted() $$, '42501', null,
  'authenticated cannot call api.record_account_deleted');
select throws_ok($$ select api.enqueue_stale_photos() $$, '42501', null,
  'authenticated cannot call api.enqueue_stale_photos');
select throws_ok($$ select * from api.claim_storage_deletions(10) $$, '42501', null,
  'authenticated cannot call api.claim_storage_deletions');
select throws_ok($$ select api.complete_storage_deletions('{}', '[]') $$, '42501', null,
  'authenticated cannot call api.complete_storage_deletions');
select throws_ok($$ select registry.enqueue_stale_photos() $$, '42501', null,
  'authenticated cannot call registry.enqueue_stale_photos');
select throws_ok($$ select * from registry.claim_storage_deletions(10) $$, '42501', null,
  'authenticated cannot call registry.claim_storage_deletions');
select throws_ok($$ select registry.complete_storage_deletions('{}', '[]') $$, '42501', null,
  'authenticated cannot call registry.complete_storage_deletions');
select tests.clear_auth();

set local role anon;
select throws_ok($$ select api.record_account_deleted() $$, '42501', null,
  'anon cannot call api.record_account_deleted');
select throws_ok($$ select api.enqueue_stale_photos() $$, '42501', null,
  'anon cannot call api.enqueue_stale_photos');
select throws_ok($$ select * from api.claim_storage_deletions(10) $$, '42501', null,
  'anon cannot call api.claim_storage_deletions');
select throws_ok($$ select api.complete_storage_deletions('{}', '[]') $$, '42501', null,
  'anon cannot call api.complete_storage_deletions');
reset role;

-- ---------------------------------------------------------------------------
-- enqueue_stale_photos: abandoned uploads and orphan files
-- ---------------------------------------------------------------------------
create temp table enqueued as select registry.enqueue_stale_photos() as n;

select is(pg_temp.queued('old'), 1, 'a pending photo created 25 h ago is queued');
select is(pg_temp.queued('fresh'), 0, 'a pending photo created 1 h ago is not queued');
select is(pg_temp.queued('ready'), 0, 'a ready photo is never queued, however old');
select is(pg_temp.queued('orphan'), 1, 'a file in pet-photos with no photo row is queued');
select is(pg_temp.queued('queued'), 1, 'a file that is already queued is not queued again');
select is(pg_temp.queued('other'), 0, 'files in other buckets are left alone');
select results_eq(
  $$ select id::text, status::text from registry.pet_photos
      where pet_id = current_setting('pawpin.pet')::uuid order by id $$,
  $$ values ('a6000000-0000-4000-8000-00000000f002', 'pending'),
            ('a6000000-0000-4000-8000-00000000f003', 'ready') $$,
  'the expired pending row is deleted, freeing its slot; the fresh pending and ready rows stay'
);
-- Counted against the whole queue (it started with only the pre-queued row), so leftover orphans
-- in a used development database don't break it.
select is((select n from enqueued), (select count(*)::int - 1 from registry.storage_deletions),
  'enqueue_stale_photos returns how many paths it queued');
select is(registry.enqueue_stale_photos(), 0, 'a second run finds nothing new to queue');

-- Only this file's rows from here on: a used database may hold other orphan files.
delete from registry.storage_deletions
 where storage_path not like current_setting('pawpin.a') || '/%';

-- ---------------------------------------------------------------------------
-- claim_storage_deletions
-- ---------------------------------------------------------------------------
create temp table claimed as select * from registry.claim_storage_deletions(10);

select results_eq(
  $$ select storage_path, attempts from claimed order by storage_path $$,
  $$ values (current_setting('pawpin.old'), 1), (current_setting('pawpin.orphan'), 1),
            (current_setting('pawpin.queued'), 1) $$,
  'claim_storage_deletions(10) hands out every queued row with attempts incremented'
);
select results_eq(
  $$ select storage_path, attempts from registry.storage_deletions order by storage_path $$,
  $$ values (current_setting('pawpin.old'), 1), (current_setting('pawpin.orphan'), 1),
            (current_setting('pawpin.queued'), 1) $$,
  'the queue rows stay (until completed) with attempts incremented'
);
select is((select count(*)::int from registry.claim_storage_deletions(2)), 2,
  'claim_storage_deletions hands out at most max rows');
-- old and queued now have 2 attempts, orphan 1.
select results_eq(
  $$ select storage_path, attempts from registry.claim_storage_deletions(1) $$,
  $$ values (current_setting('pawpin.orphan'), 2) $$,
  'the rows tried least are handed out first, so a failing file cannot starve the others'
);
select throws_ok($$ select * from registry.claim_storage_deletions(0) $$, '22023', null,
  'max must be at least 1');
select throws_ok($$ select * from registry.claim_storage_deletions(null) $$, '22023', null,
  'max is required');

-- ---------------------------------------------------------------------------
-- Ruling 20: a path that a photo row references again is never handed out
-- ---------------------------------------------------------------------------
select tests.authenticate_as(current_setting('pawpin.a')::uuid);
select is(
  api.request_photo_upload('a6000000-0000-4000-8000-00000000f007',
    current_setting('pawpin.pet')::uuid, 'extra', 'image/jpeg', 1000),
  current_setting('pawpin.reused'), 'A opens an upload slot');
select tests.upload(current_setting('pawpin.reused'));
select is(
  (select status::text from api.confirm_photo('a6000000-0000-4000-8000-00000000f007', 1600, 1200, 120, 120)),
  'ready', 'A confirms the photo');
select lives_ok($$ select api.delete_photo('a6000000-0000-4000-8000-00000000f007') $$,
  'A deletes the photo, which queues its path');
select is(
  api.request_photo_upload('a6000000-0000-4000-8000-00000000f007',
    current_setting('pawpin.pet')::uuid, 'extra', 'image/jpeg', 1000),
  current_setting('pawpin.reused'),
  'A reuses the same photo id, so the same path is referenced again');
select is(
  (select status::text from api.confirm_photo('a6000000-0000-4000-8000-00000000f007', 1600, 1200, 120, 120)),
  'ready', 'A confirms it against the file that is still in storage');
select tests.clear_auth();

select is(pg_temp.queued('reused'), 1, 'the queue still holds the path from the delete');

create temp table claimed_after_reuse as select * from registry.claim_storage_deletions(10);

select is((select count(*)::int from claimed_after_reuse
            where storage_path = current_setting('pawpin.reused')), 0,
  'claim_storage_deletions does not hand out a path a photo row references');
select is(pg_temp.queued('reused'), 0, 'and drops that queue row');
select results_eq(
  $$ select storage_path from claimed_after_reuse order by storage_path $$,
  $$ values (current_setting('pawpin.old')), (current_setting('pawpin.orphan')),
            (current_setting('pawpin.queued')) $$,
  'the other queued rows are still handed out'
);
select results_eq(
  $$ select status::text from registry.pet_photos
      where id = 'a6000000-0000-4000-8000-00000000f007' $$,
  $$ values ('ready') $$, 'the reused photo stays ready, its file safe');

-- ---------------------------------------------------------------------------
-- complete_storage_deletions
-- ---------------------------------------------------------------------------
do $$
begin
  perform set_config('pawpin.id_' || k, (
    select d.id::text from registry.storage_deletions d
     where d.storage_path = current_setting('pawpin.' || k)), true)
     from unnest(array['old', 'orphan', 'queued']) k;
end
$$;

select lives_ok(
  format($$ select registry.complete_storage_deletions(array[%s, %s]::bigint[], %L::jsonb) $$,
         current_setting('pawpin.id_old'), current_setting('pawpin.id_orphan'),
         jsonb_build_array(jsonb_build_object('id', current_setting('pawpin.id_queued')::bigint,
                                              'error', 'storage said no'))),
  'complete_storage_deletions takes the removed ids and the failures');
-- queued was handed out by the first claim, the claim of 2 and the claim after the reuse.
select results_eq(
  $$ select storage_path, attempts, last_error from registry.storage_deletions $$,
  $$ values (current_setting('pawpin.queued'), 3, 'storage said no') $$,
  'removed rows leave the queue; a failed row stays with its error for the next run'
);
select lives_ok($$ select registry.complete_storage_deletions(null, null) $$,
  'nothing done and nothing failed is a no-op');
select results_eq(
  $$ select storage_path, attempts, last_error from registry.storage_deletions $$,
  $$ values (current_setting('pawpin.queued'), 3, 'storage said no') $$,
  'the no-op changes nothing'
);
select throws_ok(
  $$ select registry.complete_storage_deletions('{}', '{"id": 1, "error": "x"}') $$, '22023', null,
  'failed must be a JSON array');

-- ---------------------------------------------------------------------------
-- The api wrappers, called as service_role (what the Edge Functions use)
-- ---------------------------------------------------------------------------
do $$
begin
  perform set_config('pawpin.last_event', coalesce(max(id), 0)::text, true) from audit.events;
end
$$;

set local role service_role;
select lives_ok($$ select api.record_account_deleted() $$,
  'service_role records account.deleted through api.record_account_deleted');
select lives_ok($$ select api.enqueue_stale_photos() $$,
  'service_role runs api.enqueue_stale_photos');
reset role;

-- The old and orphan files are still in storage.objects (this test never removes bytes), so with
-- their queue rows completed they are orphans again and are queued again.
select is(pg_temp.queued('old') + pg_temp.queued('orphan'), 2,
  'files still in storage after their queue rows completed are queued again');
delete from registry.storage_deletions
 where storage_path not like current_setting('pawpin.a') || '/%';

set local role service_role;
create temp table claimed_by_service as select * from api.claim_storage_deletions(10);
reset role;

select results_eq(
  $$ select storage_path from claimed_by_service order by storage_path $$,
  $$ values (current_setting('pawpin.old')), (current_setting('pawpin.orphan')),
            (current_setting('pawpin.queued')) $$,
  'service_role claims through api.claim_storage_deletions, which returns id and storage_path'
);

do $$
begin
  perform set_config('pawpin.claimed_ids', (select array_agg(id)::text from claimed_by_service), true);
end
$$;
set local role service_role;
select lives_ok(
  format($$ select api.complete_storage_deletions(%L::bigint[], '[]') $$,
         current_setting('pawpin.claimed_ids')),
  'service_role completes through api.complete_storage_deletions');
reset role;

select is((select count(*)::int from registry.storage_deletions), 0,
  'the completed rows have left the queue');

select results_eq(
  $$ select actor_id, action, subject_type, subject_id, metadata from audit.events
      where id > current_setting('pawpin.last_event')::bigint $$,
  $$ values (null::uuid, 'account.deleted', 'user', null::uuid, '{}'::jsonb) $$,
  'api.record_account_deleted writes one account.deleted event with no actor, subject or metadata'
);

-- ---------------------------------------------------------------------------
-- The storage-cleanup cron job
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select schedule, active from cron.job where jobname = 'storage-cleanup' $$,
  $$ values ('*/5 * * * *', true) $$,
  'the storage-cleanup job runs every 5 minutes'
);

-- Runs the job's command the way pg_cron does and returns how many requests it sent.
create function pg_temp.run_cleanup_job() returns integer language plpgsql as $$
declare
  sent integer;
begin
  execute (select command from cron.job where jobname = 'storage-cleanup');
  get diagnostics sent = row_count;
  return sent;
end
$$;

delete from vault.secrets where name in ('project_url', 'service_role_key');
select is(pg_temp.run_cleanup_job(), 0,
  'without the vault secrets (a local database) the job sends nothing and does not fail');

do $$
begin
  perform vault.create_secret('http://cleanup.pawpin.test', 'project_url');
  perform vault.create_secret('test-service-role-key', 'service_role_key');
end
$$;
select is(pg_temp.run_cleanup_job(), 1, 'with both secrets the job sends one request');
select results_eq(
  $$ select method::text, url, headers ->> 'Authorization', headers ->> 'Content-Type'
       from net.http_request_queue where url like 'http://cleanup.pawpin.test/%' $$,
  $$ values ('POST', 'http://cleanup.pawpin.test/functions/v1/storage-cleanup',
             'Bearer test-service-role-key', 'application/json') $$,
  'the request is a POST to the storage-cleanup function carrying the service role key'
);

-- ---------------------------------------------------------------------------
-- Concurrent claims: two real sessions through dblink
-- ---------------------------------------------------------------------------
-- The sessions cannot see this transaction's uncommitted rows, so a third (setup) commits two queue
-- rows for them and removes them at the end. Their paths are new on every run, and a row left
-- behind by an aborted run is harmless (removing a missing file succeeds). dblink requires password
-- authentication for a non-superuser, so the sessions connect back over TCP with the local Supabase
-- default credentials (see `supabase status`). lock_timeout turns a claim that would block into an
-- error instead of a hang.
create extension if not exists dblink with schema extensions;

do $$
declare
  conn text;
begin
  perform set_config('pawpin.race', 'pawpin-race-' || gen_random_uuid(), true);
  foreach conn in array array['setup', 's1', 's2'] loop
    perform extensions.dblink_connect(conn,
      format('host=%s port=%s dbname=%s user=postgres password=postgres',
             host(inet_server_addr()), current_setting('port'), current_database()));
    perform extensions.dblink_exec(conn, $q$ set lock_timeout = '5s' $q$);
  end loop;
  perform extensions.dblink_exec('setup', format(
    $q$ insert into registry.storage_deletions (storage_path) values (%L), (%L) $q$,
    current_setting('pawpin.race') || '/1.jpg', current_setting('pawpin.race') || '/2.jpg'));
end
$$;

select extensions.dblink_exec('s1', 'begin');
select is(
  (select count(*)::int from extensions.dblink('s1',
     'select storage_path from registry.claim_storage_deletions(10)') as t(storage_path text)
    where storage_path like current_setting('pawpin.race') || '/%'),
  2, 'a first session claims both committed rows and holds them until it commits');
select is(
  (select count(*)::int from extensions.dblink('s2',
     'select storage_path from registry.claim_storage_deletions(10)') as t(storage_path text)
    where storage_path like current_setting('pawpin.race') || '/%'),
  0, 'a concurrent claim skips the locked rows instead of waiting for them');
select extensions.dblink_exec('s1', 'commit');

select extensions.dblink_exec('setup', format(
  $q$ delete from registry.storage_deletions where storage_path like %L $q$,
  current_setting('pawpin.race') || '/%'));
select extensions.dblink_disconnect(conn) from unnest(array['setup', 's1', 's2']) conn;

select * from finish();
rollback;
