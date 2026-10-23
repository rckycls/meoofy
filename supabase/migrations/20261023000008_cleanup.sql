-- Storage cleanup and account deletion support (spec §5, §6, §7; Rulings 16 and 20).
--
-- Files in the pet-photos bucket are removed only with the service role, by two Edge Functions:
--   * storage-cleanup (supabase/functions/storage-cleanup) drains registry.storage_deletions. The
--     api functions queue a path whenever a photo row goes away (api.delete_photo, api.delete_pet,
--     a retake in api.confirm_photo); registry.enqueue_stale_photos below adds abandoned uploads and
--     files that have no row. The cron job at the end of this file calls it every 5 minutes.
--   * delete-account (supabase/functions/delete-account) removes every file under {owner_id}/,
--     records account.deleted through api.record_account_deleted, then deletes the auth user (the
--     rows cascade).
--
-- supabase-js reaches only the exposed `api` schema, so each function the Edge Functions need has
-- a thin security-definer wrapper in `api` that only service_role may execute (Ruling 16). The
-- registry functions do the work; clients can execute none of them.

-- ---------------------------------------------------------------------------
-- registry.enqueue_stale_photos
-- ---------------------------------------------------------------------------
-- Queues two kinds of files for removal and returns how many paths it queued:
--   1. Abandoned uploads: pending photos created more than pendingPhotoTtlHours ago. The row is
--      deleted (freeing its slot in the per-pet limit) and its path queued, whether or not a file
--      was ever uploaded. Rows another transaction holds (a confirm or delete in progress) are
--      skipped and looked at again on the next run, so this never waits on, or deadlocks with,
--      the api functions.
--   2. Orphans: files in pet-photos whose path no photo row references and that aren't queued yet,
--      for example the files of a user deleted outside the delete-account function. An upload
--      always has a pending row first (the bucket's insert policy), so a live file is never an
--      orphan.
create function registry.enqueue_stale_photos()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  ttl_hours constant integer := (registry.limits() ->> 'pendingPhotoTtlHours')::integer;
  expired_count integer;
  orphan_count integer;
begin
  with stale as (
    select ph.id
      from registry.pet_photos ph
     where ph.status = 'pending'
       and ph.created_at < pg_catalog.now() - pg_catalog.make_interval(hours => ttl_hours)
       for update skip locked
  ),
  expired as (
    delete from registry.pet_photos ph
     using stale s
     where ph.id = s.id
    returning ph.storage_path
  )
  insert into registry.storage_deletions (storage_path)
  select e.storage_path from expired e;
  get diagnostics expired_count = row_count;

  insert into registry.storage_deletions (storage_path)
  select o.name
    from storage.objects o
   where o.bucket_id = 'pet-photos'
     and not exists (select 1 from registry.pet_photos ph where ph.storage_path = o.name)
     and not exists (select 1 from registry.storage_deletions d where d.storage_path = o.name);
  get diagnostics orphan_count = row_count;

  return expired_count + orphan_count;
end
$$;

-- ---------------------------------------------------------------------------
-- registry.claim_storage_deletions
-- ---------------------------------------------------------------------------
-- Hands out up to `max` queued rows for removal, least-tried first (so a file that keeps failing
-- can't starve the rest), and counts the attempt. Rows another session holds are skipped, so two
-- runs never wait for each other. A claimed row stays queued until complete_storage_deletions
-- removes it, so a run that dies midway leaves its rows for the next one.
--
-- Ruling 20: a queued path that a photo row references again is never handed out. Photo ids are
-- client-generated, so a photo deleted and then requested again with the same id gets the same
-- path, and its new file sits where the queued one was. Such queue rows are dropped instead: the
-- path is live again, and if that photo is deleted later its path is queued anew.
create function registry.claim_storage_deletions(max integer)
returns setof registry.storage_deletions
language plpgsql
set search_path = ''
as $$
begin
  if claim_storage_deletions.max is null or claim_storage_deletions.max < 1 then
    raise exception 'registry.claim_storage_deletions: max must be at least 1'
      using errcode = 'invalid_parameter_value';
  end if;

  delete from registry.storage_deletions d
   where d.id in (
     select q.id
       from registry.storage_deletions q
      where exists (select 1 from registry.pet_photos ph where ph.storage_path = q.storage_path)
        for update of q skip locked
   );

  return query
  update registry.storage_deletions d
     set attempts = d.attempts + 1
   where d.id in (
     select q.id
       from registry.storage_deletions q
      where not exists (
              select 1 from registry.pet_photos ph where ph.storage_path = q.storage_path)
      order by q.attempts, q.requested_at, q.id
      limit claim_storage_deletions.max
        for update of q skip locked
   )
  returning d.*;
end
$$;

-- ---------------------------------------------------------------------------
-- registry.complete_storage_deletions
-- ---------------------------------------------------------------------------
-- Records the outcome of a run: the rows in `done` (files removed, or already gone) leave the
-- queue; each entry of `failed`, a JSON array of {"id": <row id>, "error": <text>}, keeps its row
-- for the next run with the error noted. Either may be null or empty.
create function registry.complete_storage_deletions(done bigint[], failed jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if complete_storage_deletions.failed is not null
     and pg_catalog.jsonb_typeof(complete_storage_deletions.failed) <> 'array' then
    raise exception 'registry.complete_storage_deletions: failed must be a JSON array'
      using errcode = 'invalid_parameter_value';
  end if;

  delete from registry.storage_deletions d
   where d.id = any (coalesce(complete_storage_deletions.done, '{}'::bigint[]));

  update registry.storage_deletions d
     set last_error = pg_catalog.left(coalesce(f.error, 'unknown error'), 1000)
    from pg_catalog.jsonb_to_recordset(coalesce(complete_storage_deletions.failed, '[]'::jsonb))
         as f(id bigint, error text)
   where d.id = f.id;
end
$$;

-- ---------------------------------------------------------------------------
-- api wrappers for the Edge Functions (service_role only)
-- ---------------------------------------------------------------------------
-- Records that an account was deleted. The event carries no identity at all: no actor, no
-- subject id and empty metadata, so the audit log keeps only the action and the time.
create function api.record_account_deleted()
returns void
language sql
security definer
set search_path = ''
as $$
  select audit.record_system('account.deleted', 'user', null, '{}'::jsonb)
$$;

create function api.enqueue_stale_photos()
returns integer
language sql
security definer
set search_path = ''
as $$
  select registry.enqueue_stale_photos()
$$;

-- Returns only what the cleanup function needs: the row id and the path to remove.
create function api.claim_storage_deletions(max integer)
returns table (id bigint, storage_path text)
language sql
security definer
set search_path = ''
as $$
  select d.id, d.storage_path
    from registry.claim_storage_deletions(claim_storage_deletions.max) d
$$;

create function api.complete_storage_deletions(done bigint[], failed jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  select registry.complete_storage_deletions(
    complete_storage_deletions.done, complete_storage_deletions.failed)
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Postgres lets PUBLIC execute every new function, and these must never be reachable by a client.
revoke all on function
  registry.enqueue_stale_photos(),
  registry.claim_storage_deletions(integer),
  registry.complete_storage_deletions(bigint[], jsonb),
  api.record_account_deleted(),
  api.enqueue_stale_photos(),
  api.claim_storage_deletions(integer),
  api.complete_storage_deletions(bigint[], jsonb)
from public, anon, authenticated;

-- service_role needs the schema to resolve the registry functions; it gets no table privileges.
grant usage on schema registry to service_role;
grant execute on function
  registry.enqueue_stale_photos(),
  registry.claim_storage_deletions(integer),
  registry.complete_storage_deletions(bigint[], jsonb),
  api.record_account_deleted(),
  api.enqueue_stale_photos(),
  api.claim_storage_deletions(integer),
  api.complete_storage_deletions(bigint[], jsonb)
to service_role;

-- ---------------------------------------------------------------------------
-- The storage-cleanup cron job
-- ---------------------------------------------------------------------------
-- Every 5 minutes pg_cron POSTs to the storage-cleanup Edge Function through pg_net, with the
-- project URL and the service role key read from Supabase Vault. The function answers 401 unless
-- the bearer token is its own SUPABASE_SERVICE_ROLE_KEY.
--
-- The secrets are created once per database, outside migrations (they must never be committed):
--
--   Hosted project (SQL editor; the key is the service_role key from Project Settings > API, the
--   value the function sees as SUPABASE_SERVICE_ROLE_KEY):
--     select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--     select vault.create_secret('<service role key>', 'service_role_key');
--
--   Local stack (optional; `supabase db reset` wipes them). The database container reaches the
--   API gateway as http://kong:8000; the key is SERVICE_ROLE_KEY from `supabase status`:
--     select vault.create_secret('http://kong:8000', 'project_url');
--     select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');
--
-- To rotate a value: select vault.update_secret(id, '<new value>') with the id from
-- vault.secrets. Until both secrets exist the job selects no row and sends nothing, so a fresh
-- local database runs it harmlessly. Runs and their outcome are in cron.job_run_details; the
-- function's answers are in net._http_response.
--
-- Enabling pg_net lets Supabase grant its http functions to anon and authenticated (the grant is
-- made by supabase_admin, so migrations can't revoke it). Clients still can't call them: only the
-- `api` schema is exposed and no api function runs caller-supplied SQL.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'storage-cleanup',
  '*/5 * * * *',
  $job$
    select net.http_post(
      url := pg_catalog.rtrim(s.project_url, '/') || '/functions/v1/storage-cleanup',
      headers := pg_catalog.jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || s.service_role_key
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    )
      from (
        select (select ds.decrypted_secret from vault.decrypted_secrets ds
                 where ds.name = 'project_url') as project_url,
               (select ds.decrypted_secret from vault.decrypted_secrets ds
                 where ds.name = 'service_role_key') as service_role_key
      ) s
     where s.project_url is not null
       and s.service_role_key is not null
  $job$
);
