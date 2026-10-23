-- Photos: the private pet-photos bucket and its storage policies, the client-callable write paths
-- (api.request_photo_upload, api.confirm_photo, api.delete_photo) and the view clients read their
-- photos through (spec §6, §7, Ruling 13).
--
-- Upload flow: request_photo_upload creates a `pending` row and returns its path
-- {owner_id}/{pet_id}/{id}.jpg; the client uploads the JPEG to that path (the insert policy below
-- admits only a path that has a pending row of the caller's); confirm_photo checks the file is
-- there and big enough, then marks the row `ready`. Clients never overwrite or remove a file: the
-- functions queue paths in registry.storage_deletions, and the cleanup job (and the delete-account
-- function, for a whole folder) removes files with the service role.
--
-- Same conventions as 20261023000005_pet_api.sql: every api.* function is security definer with an
-- empty search_path, so each name is schema-qualified. Each one checks, in order: the caller is
-- signed in, owns the subject, and sent valid input; then it does its work and writes one audit
-- event. Audit metadata holds the view and counts only, never a storage path. Error details never
-- echo the input.

-- ---------------------------------------------------------------------------
-- The bucket
-- ---------------------------------------------------------------------------
-- Private: files are reachable only through the policies below or a signed URL. Storage refuses an
-- upload that isn't declared image/jpeg or is over photoMaxBytes before it reaches the database.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pet-photos',
  'pet-photos',
  false,
  (registry.limits() ->> 'photoMaxBytes')::bigint,
  array['image/jpeg']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Storage policies
-- ---------------------------------------------------------------------------
-- Upload: only into the caller's own folder, and only at the exact path of one of the caller's
-- pending photos, so every file has a row and a slot is gone once its photo is confirmed or
-- deleted. The subquery runs with the caller's rights, so pet_photos' row-level security already
-- limits it to the caller's rows; owner_id is checked again for clarity.
create policy pet_photos_bucket_insert_pending on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'pet-photos'
    and pg_catalog.split_part(name, '/', 1) = (select auth.uid())::text
    and exists (
      select 1
        from registry.pet_photos ph
       where ph.storage_path = objects.name
         and ph.owner_id = (select auth.uid())
         and ph.status = 'pending'
    )
  );

-- Read (and so create signed URLs for): only files in the caller's own folder.
create policy pet_photos_bucket_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'pet-photos'
    and pg_catalog.split_part(name, '/', 1) = (select auth.uid())::text
  );

-- No update or delete policies: a client can neither overwrite nor remove a file.

-- ---------------------------------------------------------------------------
-- Locking a photo for a change
-- ---------------------------------------------------------------------------
-- Locks one of the owner's photos and, first, its pet: the same order api.delete_pet takes (pet,
-- then its photos through the cascade), so the two can't deadlock. Holding the pet lock makes the
-- changes to one pet's photos run one at a time; two confirms of the same view then can't both
-- find no ready photo and collide on the one-ready-per-view index. Raises NOT_OWNER when the photo
-- is missing, someone else's, or was deleted while waiting for the lock.
create function registry.lock_own_photo(photo_id uuid, owner_id uuid)
returns registry.pet_photos
language plpgsql
set search_path = ''
as $$
declare
  photo registry.pet_photos;
begin
  perform 1
     from registry.pets p
    where p.id = (select ph.pet_id
                    from registry.pet_photos ph
                   where ph.id = lock_own_photo.photo_id
                     and ph.owner_id = lock_own_photo.owner_id)
      and p.owner_id = lock_own_photo.owner_id
      for update;
  if not found then
    perform internal.fail('NOT_OWNER');
  end if;

  select ph.*
    into photo
    from registry.pet_photos ph
   where ph.id = lock_own_photo.photo_id
     and ph.owner_id = lock_own_photo.owner_id
     for update;
  if not found then
    perform internal.fail('NOT_OWNER');
  end if;

  return photo;
end
$$;

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
-- with anything else raises VALIDATION; an id that belongs to another owner raises NOT_OWNER.
--
-- The caller's entitlements.accounts row is locked first, as api.create_pet does, so every request
-- for one owner runs one at a time and the counts that follow can't be raced past a limit. The pet
-- row is locked next: a concurrent api.delete_pet finishes first and this then raises NOT_OWNER,
-- instead of adding a path after that pet's paths were queued.
create function api.request_photo_upload(
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
    uid::text || '/' || request_photo_upload.pet_id::text || '/' || request_photo_upload.id::text
      || '.jpg',
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
-- api.confirm_photo
-- ---------------------------------------------------------------------------
-- Marks one of the caller's pending photos ready once its file is in the pet-photos bucket and its
-- short side is at least photoMinShortSide pixels; blur_score and brightness (measured on the
-- device) are stored as sent. A refused confirm changes nothing, so the photo stays pending and the
-- client can retry.
--
-- A front, side or markings photo replaces the pet's ready photo of the same view: the old row is
-- deleted and its path queued in registry.storage_deletions before the new row becomes ready (the
-- one-ready-per-view index allows no overlap), so a retake never leaks the old file. Extra photos
-- replace nothing. Confirming a photo that is already ready returns it unchanged and writes no
-- event, so a retried confirm succeeds.
create function api.confirm_photo(
  id uuid,
  width integer,
  height integer,
  blur_score real,
  brightness real
)
returns registry.pet_photos
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid constant uuid := auth.uid();
  min_short_side constant integer := (registry.limits() ->> 'photoMinShortSide')::integer;
  photo registry.pet_photos;
  replaced_count integer := 0;
begin
  if uid is null then
    perform internal.fail('UNAUTHENTICATED');
  end if;

  if confirm_photo.id is null then
    perform internal.fail('VALIDATION', 'id is required');
  end if;

  photo := registry.lock_own_photo(confirm_photo.id, uid);

  if photo.status = 'ready' then
    return photo;
  end if;
  if photo.status <> 'pending' then
    perform internal.fail('PHOTO_QUALITY', 'the photo was rejected');
  end if;

  if confirm_photo.width is null or confirm_photo.height is null then
    perform internal.fail('VALIDATION', 'width and height are required');
  end if;

  perform 1
     from storage.objects o
    where o.bucket_id = 'pet-photos'
      and o.name = photo.storage_path;
  if not found then
    perform internal.fail('PHOTO_QUALITY', 'the photo has not been uploaded');
  end if;

  if least(confirm_photo.width, confirm_photo.height) < min_short_side then
    perform internal.fail(
      'PHOTO_QUALITY', 'the short side must be at least ' || min_short_side || ' pixels'
    );
  end if;

  if photo.view <> 'extra' then
    with retired as (
      delete from registry.pet_photos prev
       where prev.pet_id = photo.pet_id
         and prev.view = photo.view
         and prev.status = 'ready'
      returning prev.storage_path
    )
    insert into registry.storage_deletions (storage_path)
    select r.storage_path from retired r;
    get diagnostics replaced_count = row_count;
  end if;

  update registry.pet_photos ph
     set status = 'ready',
         width = confirm_photo.width,
         height = confirm_photo.height,
         blur_score = confirm_photo.blur_score,
         brightness = confirm_photo.brightness,
         confirmed_at = pg_catalog.now()
   where ph.id = photo.id
  returning ph.* into photo;

  perform audit.record(
    'photo.added', 'photo', photo.id,
    pg_catalog.jsonb_build_object('view', photo.view, 'replaced_count', replaced_count)
  );
  return photo;
end
$$;

-- ---------------------------------------------------------------------------
-- api.delete_photo
-- ---------------------------------------------------------------------------
-- Deletes one of the caller's photos, in any status: its path is queued for the cleanup job, then
-- the row is deleted (which also closes a pending photo's upload slot). A missing photo and someone
-- else's both raise NOT_OWNER, so other owners' ids can't be probed.
create function api.delete_photo(id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid constant uuid := auth.uid();
  photo registry.pet_photos;
begin
  if uid is null then
    perform internal.fail('UNAUTHENTICATED');
  end if;

  if delete_photo.id is null then
    perform internal.fail('VALIDATION', 'id is required');
  end if;

  photo := registry.lock_own_photo(delete_photo.id, uid);

  insert into registry.storage_deletions (storage_path) values (photo.storage_path);
  delete from registry.pet_photos ph where ph.id = photo.id;

  perform audit.record(
    'photo.deleted', 'photo', photo.id,
    pg_catalog.jsonb_build_object('view', photo.view)
  );
end
$$;

-- ---------------------------------------------------------------------------
-- Read: the caller's photos
-- ---------------------------------------------------------------------------
-- Only `api` is exposed to PostgREST. security_invoker makes the view run with the caller's rights,
-- so row-level security on registry.pet_photos filters it to the caller's rows, and anon (no grant)
-- sees nothing. storage_path is included so the client can create signed URLs for its own files.
create view api.pet_photos
with (security_invoker = true)
as
select id, pet_id, view, status, width, height, storage_path, created_at, confirmed_at
from registry.pet_photos;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Postgres lets PUBLIC execute every new function. The lock helper is reached only by the api.*
-- functions, as their owner; the api.* functions are for signed-in users.
revoke all on function
  registry.lock_own_photo(uuid, uuid),
  api.request_photo_upload(uuid, uuid, registry.photo_view, text, integer),
  api.confirm_photo(uuid, integer, integer, real, real),
  api.delete_photo(uuid)
from public;

grant execute on function
  api.request_photo_upload(uuid, uuid, registry.photo_view, text, integer),
  api.confirm_photo(uuid, integer, integer, real, real),
  api.delete_photo(uuid)
to authenticated;

grant select on api.pet_photos to authenticated;
