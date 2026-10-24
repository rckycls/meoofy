-- Photo id reuse, the photo limit, the cleanup claim and account-deletion residue (final review
-- fixes; Rulings 26 and 54, spec §6, §7, §10).
--
-- Ruling 54: these changes go in this new migration, never in edits to 0006, 0008 or 0009, so a
-- database that already ran those (a local stack today, a hosted one later) upgrades with
-- `supabase migration up`. Each function is redeclared whole with `create or replace`, which keeps
-- its grants and its trigger; `security definer` and the empty search_path are part of a
-- definition, so they are stated again, and the grants are re-asserted at the end anyway.
--
--   * api.request_photo_upload (from 20261023000006_photo_api.sql):
--       - Ruling 26: refuses (VALIDATION) a photo id whose path is still queued in
--         registry.storage_deletions. Ids are client-generated, so a photo deleted and requested
--         again with the same id gets the same path; confirmed in the gap between a cleanup run's
--         claim and its removal, it would pass against the old file, which cleanup then deletes
--         from under a ready photo. Once cleanup has completed the queue row, the id is free.
--       - Ruling 54: a request first retires the caller's other pending photos of the same pet
--         and view: their rows are deleted and their paths queued, as a retake's confirm does for
--         the ready photo it replaces. Pending photos that failed or were given up on therefore
--         can't fill the photo limit and leave the pet unable to take a new photo until cleanup
--         expires them a day later. The request's own id is never retired: the same id is the
--         idempotent retry (Ruling 22), answered before this point. For extra photos this means
--         one pending extra at a time; ready extras are never replaced.
--   * registry.claim_storage_deletions (from 20261023000008_cleanup.sql): claims at most `max`
--     rows whatever plan the planner picks. With statistics that say the queue is (nearly) empty,
--     which a quiet database ends up with, the planner rescanned the `limit ... for update skip
--     locked` subquery once per queue row; each rescan skipped the rows the update had just
--     changed, so one claim handed out every row. The subquery is now a materialized CTE,
--     evaluated once.
--   * audit.strip_user_identity (from 20261023000009_audit_identity_strip.sql): deleting a user
--     now leaves only the action and the time (spec §10) of everything they did, and strips the
--     subject and metadata from every event about them or about anything they acted on (their
--     profile, pets and photos, whoever recorded the event). Other users' ids stay. It also
--     deletes the user's rejected sign-ups (identity.signup_rejections) by email. The allowlist
--     and Supabase Auth's own logs are the owner's retention decision and are left alone.

-- ---------------------------------------------------------------------------
-- Queue lookups by path
-- ---------------------------------------------------------------------------
-- request_photo_upload now looks up one path on every request, and the orphan scan in
-- registry.enqueue_stale_photos and the claim's referenced-path check look paths up too.
create index storage_deletions_storage_path_idx on registry.storage_deletions (storage_path);

-- ---------------------------------------------------------------------------
-- api.request_photo_upload
-- ---------------------------------------------------------------------------
-- Opens an upload slot for one of the caller's pets: a pending row whose path is returned. Only a
-- JPEG of 1 to photoMaxBytes bytes, at most photosPerPet non-rejected photos per pet, and at most
-- uploadsPerHour requests per caller in any rolling hour (counted from the caller's
-- photo.upload_requested events, so refused requests don't count).
--
-- Ids are client-generated, so a retried request is idempotent: the same id for the same pet and
-- view, still pending, returns the same path and writes no event, even at a limit. The same id
-- with anything else raises VALIDATION; an id that belongs to another owner raises NOT_OWNER. A
-- new id whose path is still queued for deletion raises VALIDATION too (Ruling 26).
--
-- A new photo replaces the caller's pending photos of the same pet and view (Ruling 54): they are
-- deleted and their paths queued before the limit is counted. Retiring writes no event of its
-- own, as cleanup's expiry of a pending photo doesn't; the request's photo.upload_requested event
-- is the trace. A refused request (limit, rate limit) raises, so nothing is retired.
--
-- Locks are taken in the order the other photo functions use (account, pet, photo): the caller's
-- entitlements.accounts row first, as api.create_pet does, so every request for one owner runs one
-- at a time and the counts that follow can't be raced past a limit; then the pet row, so a
-- concurrent api.delete_pet finishes first and this raises NOT_OWNER instead of adding a path
-- after that pet's paths were queued, and a concurrent confirm of a pending photo finishes before
-- this decides whether that photo is still pending.
create or replace function api.request_photo_upload(
  id uuid,
  pet_id uuid,
  view registry.photo_view,
  content_type text,
  bytes integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid constant uuid := auth.uid();
  photos_per_pet constant integer := (registry.limits() ->> 'photosPerPet')::integer;
  max_bytes constant integer := (registry.limits() ->> 'photoMaxBytes')::integer;
  uploads_per_hour constant integer := (registry.limits() ->> 'uploadsPerHour')::integer;
  existing registry.pet_photos;
  path text;
begin
  if uid is null then
    perform internal.fail('UNAUTHENTICATED');
  end if;

  if request_photo_upload.id is null then
    perform internal.fail('VALIDATION', 'id is required');
  end if;
  if request_photo_upload.pet_id is null then
    perform internal.fail('VALIDATION', 'pet_id is required');
  end if;

  perform 1
     from entitlements.accounts a
    where a.owner_id = uid
      for update;
  -- A valid token whose user (and so account) is gone: the session is no longer usable.
  if not found then
    perform internal.fail('UNAUTHENTICATED');
  end if;

  perform 1
     from registry.pets p
    where p.id = request_photo_upload.pet_id
      and p.owner_id = uid
      for update;
  if not found then
    perform internal.fail('NOT_OWNER');
  end if;

  if request_photo_upload.view is null then
    perform internal.fail('VALIDATION', 'view is required');
  end if;
  if request_photo_upload.content_type is distinct from 'image/jpeg' then
    perform internal.fail('VALIDATION', 'content_type must be image/jpeg');
  end if;
  if request_photo_upload.bytes is null
     or request_photo_upload.bytes not between 1 and max_bytes then
    perform internal.fail('VALIDATION', 'bytes must be 1 to ' || max_bytes);
  end if;

  select ph.*
    into existing
    from registry.pet_photos ph
   where ph.id = request_photo_upload.id;
  if found then
    if existing.owner_id <> uid then
      perform internal.fail('NOT_OWNER');
    end if;
    if existing.pet_id = request_photo_upload.pet_id
       and existing.view = request_photo_upload.view
       and existing.status = 'pending' then
      return existing.storage_path;
    end if;
    perform internal.fail('VALIDATION', 'id is already used by another photo');
  end if;

  path := uid::text || '/' || request_photo_upload.pet_id::text || '/'
          || request_photo_upload.id::text || '.jpg';

  -- Ruling 26: the path of a deleted photo stays refused until cleanup has removed its file.
  if exists (select 1 from registry.storage_deletions d where d.storage_path = path) then
    perform internal.fail('VALIDATION', 'id is already used by another photo');
  end if;

  -- Ruling 54: this photo replaces the caller's pending photos of the same pet and view.
  with retired as (
    delete from registry.pet_photos ph
     where ph.pet_id = request_photo_upload.pet_id
       and ph.owner_id = uid
       and ph.view = request_photo_upload.view
       and ph.status = 'pending'
       and ph.id <> request_photo_upload.id
    returning ph.storage_path
  )
  insert into registry.storage_deletions (storage_path)
  select r.storage_path from retired r;

  if (
    select pg_catalog.count(*)
      from registry.pet_photos ph
     where ph.pet_id = request_photo_upload.pet_id
       and ph.status <> 'rejected'
  ) >= photos_per_pet then
    perform internal.fail('VALIDATION', 'a pet can have at most ' || photos_per_pet || ' photos');
  end if;

  if (
    select pg_catalog.count(*)
      from audit.events e
     where e.actor_id = uid
       and e.action = 'photo.upload_requested'
       and e.created_at > pg_catalog.now() - interval '1 hour'
  ) >= uploads_per_hour then
    perform internal.fail('RATE_LIMITED');
  end if;

  insert into registry.pet_photos (id, pet_id, owner_id, view, storage_path, bytes)
  values (
    request_photo_upload.id,
    request_photo_upload.pet_id,
    uid,
    request_photo_upload.view,
    path,
    request_photo_upload.bytes
  )
  on conflict do nothing
  returning storage_path into path;
  -- Another owner inserted this id after the check above. It can't be the caller's own row: the
  -- account lock serialises the caller's requests.
  if not found then
    perform internal.fail('NOT_OWNER');
  end if;

  perform audit.record(
    'photo.upload_requested', 'photo', request_photo_upload.id,
    pg_catalog.jsonb_build_object('view', request_photo_upload.view)
  );
  return path;
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
-- Ruling 20: a queued path that a photo row references again is never handed out; such queue rows
-- are dropped instead, since the path is live again. request_photo_upload no longer lets a queued
-- path be referenced again (Ruling 26), but a row queued before that rule, or by hand, still can.
--
-- The rows to claim are picked in a materialized CTE, which runs once: as a subquery the planner
-- could rescan it per row, and every rescan picked rows the update had not reached yet.
create or replace function registry.claim_storage_deletions(max integer)
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
  with claimable as materialized (
    select q.id
      from registry.storage_deletions q
     where not exists (
             select 1 from registry.pet_photos ph where ph.storage_path = q.storage_path)
     order by q.attempts, q.requested_at, q.id
     limit claim_storage_deletions.max
       for update of q skip locked
  )
  update registry.storage_deletions d
     set attempts = d.attempts + 1
    from claimable c
   where d.id = c.id
  returning d.*;
end
$$;

-- ---------------------------------------------------------------------------
-- audit.strip_user_identity (the on_auth_user_deleted trigger on auth.users)
-- ---------------------------------------------------------------------------
-- Runs after every deletion of an auth user, whatever deleted it (the delete-account Edge Function
-- through Supabase Auth, the dashboard, plain SQL). By then the user's rows have cascaded away, so
-- the subjects that belonged to them are found through the log itself: every pet and photo event
-- is recorded with its owner as the actor (audit.record), so the subjects of the user's own events
-- are their profile, pets and photos, including ones deleted long before.
--   * Events the user acted in keep only the action, the subject type and the time.
--   * Events about the user or one of those subjects (another user's report, a system event about
--     a photo) lose their subject and metadata; another user's actor id stays, since it is theirs.
--   * The user's rejected sign-ups are deleted. The address is compared as citext, as the auth
--     hook stores and matches it; with an empty search_path the operator is spelled out.
-- Security definer: Supabase Auth deletes users as supabase_auth_admin, which has no rights on
-- audit.events or identity.signup_rejections.
create or replace function audit.strip_user_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  with subjects as (
    select old.id as subject_id
    union
    select e.subject_id
      from audit.events e
     where e.actor_id = old.id
       and e.subject_id is not null
  )
  update audit.events e
     set actor_id = nullif(e.actor_id, old.id),
         subject_id = null,
         metadata = '{}'::jsonb
   where e.actor_id = old.id
      or e.subject_id in (select s.subject_id from subjects s);

  if old.email is not null then
    delete from identity.signup_rejections r
     where r.email operator(extensions.=) old.email::extensions.citext;
  end if;

  return null;
end
$$;

-- ---------------------------------------------------------------------------
-- Grants (re-asserted)
-- ---------------------------------------------------------------------------
-- `create or replace` keeps a function's grants; they are stated again so this file shows them.
-- request_photo_upload is for signed-in users; the claim is for the cleanup Edge Function
-- (service_role, through api.claim_storage_deletions); the trigger function is run only by its
-- trigger.
revoke all on function api.request_photo_upload(uuid, uuid, registry.photo_view, text, integer)
from public;
grant execute on function api.request_photo_upload(uuid, uuid, registry.photo_view, text, integer)
to authenticated;

revoke all on function registry.claim_storage_deletions(integer) from public, anon, authenticated;
grant execute on function registry.claim_storage_deletions(integer) to service_role;

revoke all on function audit.strip_user_identity() from public, anon, authenticated;
