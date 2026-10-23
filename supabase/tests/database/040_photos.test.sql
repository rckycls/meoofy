-- Photo write paths (api.request_photo_upload, api.confirm_photo, api.delete_photo), the read view
-- api.pet_photos, the private pet-photos bucket and its storage.objects policies, the per-pet and
-- hourly limits, and the audit events. Uses tests.create_user / tests.authenticate_as /
-- tests.clear_auth from 000_helpers.sql.
--
-- Users: A owns Milo (the main photo lifecycle), Luna (the 6-photo limit) and Pip (extra photos);
-- B owns Rex and probes A's photos and files; R has six pets for the hourly limit; N loses its
-- account row. Pets are inserted as postgres, so the tier limit never interferes.
begin;
select plan(147);

do $$
declare
  a uuid := tests.create_user('photos-a@pawpin.test');
  b uuid := tests.create_user('photos-b@pawpin.test');
  r uuid := tests.create_user('photos-r@pawpin.test');
  n uuid := tests.create_user('photos-n@pawpin.test');
begin
  perform set_config('pawpin.a', a::text, true);
  perform set_config('pawpin.b', b::text, true);
  perform set_config('pawpin.r', r::text, true);
  perform set_config('pawpin.n', n::text, true);

  insert into registry.pets (id, owner_id, name, species)
  values ('a4000000-0000-4000-8000-000000000001', a, 'Milo', 'dog'),
         ('a4000000-0000-4000-8000-000000000002', a, 'Luna', 'cat'),
         ('a4000000-0000-4000-8000-000000000003', a, 'Pip', 'dog'),
         ('b4000000-0000-4000-8000-000000000001', b, 'Rex', 'cat'),
         ('d4000000-0000-4000-8000-000000000001', n, 'Ghost', 'dog');
  insert into registry.pets (id, owner_id, name, species)
  select ('c4000000-0000-4000-8000-00000000000' || i)::uuid, r, 'Pet ' || i, 'dog'
    from generate_series(1, 6) i;

  -- pawpin.path_<key>: the storage path {owner}/{pet}/{photo}.jpg of each named photo.
  perform set_config('pawpin.path_' || v.k, v.o || '/' || v.p || '/' || v.ph || '.jpg', true)
     from (values
       ('f1', a, 'a4000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-00000000f001'),
       ('f2', a, 'a4000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-00000000f002'),
       ('f3', a, 'a4000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-00000000f003'),
       ('f4', a, 'a4000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-00000000f004'),
       ('s1', a, 'a4000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-00000000f101'),
       ('m1', a, 'a4000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-00000000f201'),
       ('x1', a, 'a4000000-0000-4000-8000-000000000003', 'a4000000-0000-4000-8000-00000000f301'),
       ('x2', a, 'a4000000-0000-4000-8000-000000000003', 'a4000000-0000-4000-8000-00000000f302'),
       ('l1', a, 'a4000000-0000-4000-8000-000000000002', 'a4000000-0000-4000-8000-00000000f401'),
       ('b1', b, 'b4000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-00000000f001')
     ) v(k, o, p, ph);
end
$$;

-- Records a file at `path` in pet-photos as the current role, the way Storage does after an upload
-- (row-level security applies). Only the row is written; no bytes are stored.
create function tests.upload(path text) returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner_id)
  values ('pet-photos', upload.path, auth.uid()::text)
$$;

-- Runs a statement as the current role and returns how many rows it changed.
create function tests.row_count(statement text) returns integer language plpgsql as $$
declare
  changed integer;
begin
  execute statement;
  get diagnostics changed = row_count;
  return changed;
end
$$;

grant execute on function tests.upload(text), tests.row_count(text) to authenticated;

-- A second bucket, to prove the policies and confirm_photo only look at pet-photos.
insert into storage.buckets (id, name) values ('pawpin-test-other', 'pawpin-test-other');

-- ---------------------------------------------------------------------------
-- Shape and privileges
-- ---------------------------------------------------------------------------
select is(
  (select p.proargnames from pg_proc p
    where p.oid = to_regprocedure(
      'api.request_photo_upload(uuid, uuid, registry.photo_view, text, integer)')),
  array['id', 'pet_id', 'view', 'content_type', 'bytes'],
  'api.request_photo_upload(id, pet_id, view, content_type, bytes) exists'
);
select is(
  (select p.proargnames from pg_proc p
    where p.oid = to_regprocedure('api.confirm_photo(uuid, integer, integer, real, real)')),
  array['id', 'width', 'height', 'blur_score', 'brightness'],
  'api.confirm_photo(id, width, height, blur_score, brightness) exists'
);
select is(
  (select p.proargnames from pg_proc p where p.oid = to_regprocedure('api.delete_photo(uuid)')),
  array['id'], 'api.delete_photo(id) exists'
);
select results_eq(
  $$ select p.oid::regprocedure::text, p.prorettype::regtype::text, p.prosecdef,
            p.proconfig = array['search_path=""']
       from pg_proc p
      where p.oid in (to_regprocedure('api.request_photo_upload(uuid, uuid, registry.photo_view, text, integer)'),
                      to_regprocedure('api.confirm_photo(uuid, integer, integer, real, real)'),
                      to_regprocedure('api.delete_photo(uuid)'))
      order by 1 $$,
  $$ values ('api.confirm_photo(uuid,integer,integer,real,real)', 'registry.pet_photos', true, true),
            ('api.delete_photo(uuid)', 'void', true, true),
            ('api.request_photo_upload(uuid,uuid,registry.photo_view,text,integer)', 'text', true, true) $$,
  'request_photo_upload returns text, confirm_photo a pet_photos row, delete_photo void; all are security definer with an empty search_path'
);
select results_eq(
  $$ select has_function_privilege('authenticated', p.oid, 'EXECUTE'),
            has_function_privilege('anon', p.oid, 'EXECUTE'), count(*)::int
       from pg_proc p
      where p.oid in (to_regprocedure('api.request_photo_upload(uuid, uuid, registry.photo_view, text, integer)'),
                      to_regprocedure('api.confirm_photo(uuid, integer, integer, real, real)'),
                      to_regprocedure('api.delete_photo(uuid)'))
      group by 1, 2 $$,
  $$ values (true, false, 3) $$,
  'authenticated can execute all three photo functions and anon none'
);

select columns_are('api', 'pet_photos',
  array['id', 'pet_id', 'view', 'status', 'width', 'height', 'storage_path', 'created_at',
        'confirmed_at']);
select ok((select c.relkind = 'v' and coalesce(c.reloptions, '{}') @> array['security_invoker=true']
             from pg_class c where c.oid = to_regclass('api.pet_photos')),
  'api.pet_photos is a security_invoker view');
select table_privs_are('api', 'pet_photos', 'authenticated', array['SELECT']);
select table_privs_are('api', 'pet_photos', 'anon', array[]::text[]);

select results_eq(
  $$ select name, public, file_size_limit, allowed_mime_types
       from storage.buckets where id = 'pet-photos' $$,
  $$ values ('pet-photos', false, 4194304::bigint, array['image/jpeg']) $$,
  'pet-photos is a private bucket capped at 4194304 bytes that accepts only image/jpeg'
);
select is((select file_size_limit from storage.buckets where id = 'pet-photos'),
  (registry.limits() ->> 'photoMaxBytes')::bigint, 'the bucket size cap is photoMaxBytes');

select policies_are('storage', 'objects',
  array['pet_photos_bucket_insert_pending', 'pet_photos_bucket_select_own'],
  'storage.objects has only the pet-photos insert and select policies');
select results_eq(
  $$ select policyname::text collate "default", permissive, cmd, roles::text[] collate "default"
       from pg_policies where schemaname = 'storage' and tablename = 'objects' order by 1 $$,
  $$ values ('pet_photos_bucket_insert_pending', 'PERMISSIVE', 'INSERT', array['authenticated']),
            ('pet_photos_bucket_select_own', 'PERMISSIVE', 'SELECT', array['authenticated']) $$,
  'clients get one insert and one select policy, for authenticated only'
);
select is_empty(
  $$ select policyname from pg_policies
      where schemaname = 'storage' and cmd in ('UPDATE', 'DELETE', 'ALL') $$,
  'no storage policy lets a client update or delete a file'
);

-- ---------------------------------------------------------------------------
-- Unauthenticated callers
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select api.request_photo_upload(gen_random_uuid(), 'a4000000-0000-4000-8000-000000000001',
                                     'front', 'image/jpeg', 1000) $$,
  'P0001', 'PAWPIN:UNAUTHENTICATED', 'request_photo_upload without a JWT throws UNAUTHENTICATED');
select throws_ok($$ select api.confirm_photo(gen_random_uuid(), 1600, 1200, 200, 120) $$,
  'P0001', 'PAWPIN:UNAUTHENTICATED', 'confirm_photo without a JWT throws UNAUTHENTICATED');
select throws_ok($$ select api.delete_photo(gen_random_uuid()) $$,
  'P0001', 'PAWPIN:UNAUTHENTICATED', 'delete_photo without a JWT throws UNAUTHENTICATED');

-- The authenticated role with no usable subject claim (a token without sub).
select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', '', true);
select throws_ok(
  $$ select api.request_photo_upload(gen_random_uuid(), 'a4000000-0000-4000-8000-000000000001',
                                     'front', 'image/jpeg', 1000) $$,
  'P0001', 'PAWPIN:UNAUTHENTICATED',
  'request_photo_upload with no subject claim throws UNAUTHENTICATED');
select throws_ok($$ select api.confirm_photo(gen_random_uuid(), 1600, 1200, 200, 120) $$,
  'P0001', 'PAWPIN:UNAUTHENTICATED', 'confirm_photo with no subject claim throws UNAUTHENTICATED');
select throws_ok($$ select api.delete_photo(gen_random_uuid()) $$,
  'P0001', 'PAWPIN:UNAUTHENTICATED', 'delete_photo with no subject claim throws UNAUTHENTICATED');

-- The anon role cannot reach any of it.
select set_config('role', 'anon', true);
select throws_ok(
  $$ select api.request_photo_upload(gen_random_uuid(), 'a4000000-0000-4000-8000-000000000001',
                                     'front', 'image/jpeg', 1000) $$,
  '42501', null, 'anon cannot call request_photo_upload');
select throws_ok($$ select api.confirm_photo(gen_random_uuid(), 1600, 1200, 200, 120) $$,
  '42501', null, 'anon cannot call confirm_photo');
select throws_ok($$ select api.delete_photo(gen_random_uuid()) $$,
  '42501', null, 'anon cannot call delete_photo');
select throws_ok($$ select * from api.pet_photos $$, '42501', null, 'anon cannot read api.pet_photos');
reset role;

-- ---------------------------------------------------------------------------
-- request_photo_upload (user A)
-- ---------------------------------------------------------------------------
select tests.authenticate_as(current_setting('pawpin.a')::uuid);

select is(
  api.request_photo_upload('a4000000-0000-4000-8000-00000000f001',
                           'a4000000-0000-4000-8000-000000000001', 'front', 'image/jpeg', 350000),
  current_setting('pawpin.a')
    || '/a4000000-0000-4000-8000-000000000001/a4000000-0000-4000-8000-00000000f001.jpg',
  'request_photo_upload returns the path <owner>/<pet>/<photo>.jpg'
);
select results_eq(
  $$ select pet_id, owner_id = auth.uid(), view::text, storage_path, bytes, status::text, width,
            height, blur_score, brightness, confirmed_at
       from registry.pet_photos where id = 'a4000000-0000-4000-8000-00000000f001' $$,
  $$ values ('a4000000-0000-4000-8000-000000000001'::uuid, true, 'front',
             current_setting('pawpin.path_f1'), 350000, 'pending', null::integer, null::integer,
             null::real, null::real, null::timestamptz) $$,
  'request_photo_upload creates a pending row at that path, with no measurements yet'
);
select results_eq(
  $$ select id, pet_id, view::text, status::text, storage_path from api.pet_photos $$,
  $$ values ('a4000000-0000-4000-8000-00000000f001'::uuid,
             'a4000000-0000-4000-8000-000000000001'::uuid, 'front', 'pending',
             current_setting('pawpin.path_f1')) $$,
  'the pending photo is readable through api.pet_photos'
);
select results_eq(
  $$ select actor_id = auth.uid(), subject_type, subject_id, metadata
       from audit.events where action = 'photo.upload_requested' $$,
  $$ values (true, 'photo', 'a4000000-0000-4000-8000-00000000f001'::uuid,
             '{"view": "front"}'::jsonb) $$,
  'request_photo_upload writes one photo.upload_requested event with the view and no path'
);

-- Idempotent retries: the client generates the id, so a retried request gets the same slot.
select is(
  api.request_photo_upload('a4000000-0000-4000-8000-00000000f001',
                           'a4000000-0000-4000-8000-000000000001', 'front', 'image/jpeg', 350000),
  current_setting('pawpin.path_f1'),
  'repeating request_photo_upload with the same id returns the same path'
);
select results_eq(
  $$ select (select count(*)::int from registry.pet_photos), (select count(*)::int from audit.events) $$,
  $$ values (1, 1) $$,
  'the repeated request added no row and no event'
);
select throws_ok(
  $$ select api.request_photo_upload('a4000000-0000-4000-8000-00000000f001',
                                     'a4000000-0000-4000-8000-000000000003', 'front', 'image/jpeg', 1000) $$,
  'P0001', 'PAWPIN:VALIDATION', 'reusing a photo id for another pet throws VALIDATION');
select throws_ok(
  $$ select api.request_photo_upload('a4000000-0000-4000-8000-00000000f001',
                                     'a4000000-0000-4000-8000-000000000001', 'side', 'image/jpeg', 1000) $$,
  'P0001', 'PAWPIN:VALIDATION', 'reusing a photo id for another view throws VALIDATION');

select is(
  api.request_photo_upload('a4000000-0000-4000-8000-00000000f101',
                           'a4000000-0000-4000-8000-000000000001', 'side', 'image/jpeg', 4194304),
  current_setting('pawpin.path_s1'), 'exactly 4194304 bytes is accepted'
);
select is(
  api.request_photo_upload('a4000000-0000-4000-8000-00000000f201',
                           'a4000000-0000-4000-8000-000000000001', 'markings', 'image/jpeg', 1),
  current_setting('pawpin.path_m1'), 'a single byte is accepted'
);

select throws_ok(
  $$ select api.request_photo_upload(gen_random_uuid(), 'a4000000-0000-4000-8000-000000000001',
                                     'front', 'image/png', 1000) $$,
  'P0001', 'PAWPIN:VALIDATION', 'content_type image/png throws VALIDATION');
select throws_ok(
  $$ select api.request_photo_upload(gen_random_uuid(), 'a4000000-0000-4000-8000-000000000001',
                                     'front', 'IMAGE/JPEG', 1000) $$,
  'P0001', 'PAWPIN:VALIDATION', 'content_type must be exactly image/jpeg');
select throws_ok(
  $$ select api.request_photo_upload(gen_random_uuid(), 'a4000000-0000-4000-8000-000000000001',
                                     'front', null, 1000) $$,
  'P0001', 'PAWPIN:VALIDATION', 'a null content_type throws VALIDATION');
select throws_ok(
  $$ select api.request_photo_upload(gen_random_uuid(), 'a4000000-0000-4000-8000-000000000001',
                                     'front', 'image/jpeg', 4194305) $$,
  'P0001', 'PAWPIN:VALIDATION', 'bytes 4194305 throws VALIDATION');
select throws_ok(
  $$ select api.request_photo_upload(gen_random_uuid(), 'a4000000-0000-4000-8000-000000000001',
                                     'front', 'image/jpeg', 0) $$,
  'P0001', 'PAWPIN:VALIDATION', 'bytes 0 throws VALIDATION');
select throws_ok(
  $$ select api.request_photo_upload(gen_random_uuid(), 'a4000000-0000-4000-8000-000000000001',
                                     'front', 'image/jpeg', -1) $$,
  'P0001', 'PAWPIN:VALIDATION', 'negative bytes throw VALIDATION');
select throws_ok(
  $$ select api.request_photo_upload(gen_random_uuid(), 'a4000000-0000-4000-8000-000000000001',
                                     'front', 'image/jpeg', null) $$,
  'P0001', 'PAWPIN:VALIDATION', 'null bytes throw VALIDATION');
select throws_ok(
  $$ select api.request_photo_upload(gen_random_uuid(), 'a4000000-0000-4000-8000-000000000001',
                                     null, 'image/jpeg', 1000) $$,
  'P0001', 'PAWPIN:VALIDATION', 'a null view throws VALIDATION');
select throws_ok(
  $$ select api.request_photo_upload(null, 'a4000000-0000-4000-8000-000000000001', 'front',
                                     'image/jpeg', 1000) $$,
  'P0001', 'PAWPIN:VALIDATION', 'a null id throws VALIDATION');
select throws_ok(
  $$ select api.request_photo_upload(gen_random_uuid(), null, 'front', 'image/jpeg', 1000) $$,
  'P0001', 'PAWPIN:VALIDATION', 'a null pet_id throws VALIDATION');
select results_eq(
  $$ select (select count(*)::int from registry.pet_photos), (select count(*)::int from audit.events) $$,
  $$ values (3, 3) $$,
  'rejected requests added no rows and no events'
);

-- At most photosPerPet (6) non-rejected photos per pet (Luna).
select lives_ok(
  $$ select api.request_photo_upload(('a4000000-0000-4000-8000-00000000f40' || n)::uuid,
                                     'a4000000-0000-4000-8000-000000000002',
                                     (array['front', 'side', 'markings', 'extra', 'extra', 'extra'])[n]::registry.photo_view,
                                     'image/jpeg', 1000)
       from generate_series(1, 6) n $$,
  'a pet may have 6 photos');
select throws_ok(
  $$ select api.request_photo_upload('a4000000-0000-4000-8000-00000000f407',
                                     'a4000000-0000-4000-8000-000000000002', 'extra', 'image/jpeg', 1000) $$,
  'P0001', 'PAWPIN:VALIDATION', 'a 7th non-rejected photo throws VALIDATION');

select tests.clear_auth();
update registry.pet_photos set status = 'rejected' where id = 'a4000000-0000-4000-8000-00000000f401';
select tests.authenticate_as(current_setting('pawpin.a')::uuid);

select lives_ok(
  $$ select api.request_photo_upload('a4000000-0000-4000-8000-00000000f407',
                                     'a4000000-0000-4000-8000-000000000002', 'extra', 'image/jpeg', 1000) $$,
  'rejected photos don''t count toward the 6');
select results_eq(
  $$ select status::text, count(*)::int from api.pet_photos
      where pet_id = 'a4000000-0000-4000-8000-000000000002' group by 1 order by 1 $$,
  $$ values ('pending', 6), ('rejected', 1) $$,
  'Luna has 6 non-rejected photos and 1 rejected one'
);

-- ---------------------------------------------------------------------------
-- Owner isolation (user B)
-- ---------------------------------------------------------------------------
select tests.authenticate_as(current_setting('pawpin.b')::uuid);

select throws_ok(
  $$ select api.request_photo_upload(gen_random_uuid(), 'a4000000-0000-4000-8000-000000000001',
                                     'front', 'image/jpeg', 1000) $$,
  'P0001', 'PAWPIN:NOT_OWNER', 'B requesting an upload for A''s pet throws NOT_OWNER');
select throws_ok(
  $$ select api.request_photo_upload(gen_random_uuid(), 'a4000000-0000-4000-8000-000000000001',
                                     'front', 'image/png', 1000) $$,
  'P0001', 'PAWPIN:NOT_OWNER', 'ownership is checked before validation');
select throws_ok(
  $$ select api.request_photo_upload(gen_random_uuid(), gen_random_uuid(), 'front', 'image/jpeg', 1000) $$,
  'P0001', 'PAWPIN:NOT_OWNER', 'requesting an upload for a pet that does not exist throws NOT_OWNER');
select throws_ok(
  $$ select api.request_photo_upload('a4000000-0000-4000-8000-00000000f001',
                                     'b4000000-0000-4000-8000-000000000001', 'front', 'image/jpeg', 1000) $$,
  'P0001', 'PAWPIN:NOT_OWNER', 'reusing another owner''s photo id throws NOT_OWNER');
select throws_ok(
  $$ select api.confirm_photo('a4000000-0000-4000-8000-00000000f001', 1600, 1200, 200, 120) $$,
  'P0001', 'PAWPIN:NOT_OWNER', 'B confirming A''s photo throws NOT_OWNER');
select throws_ok($$ select api.delete_photo('a4000000-0000-4000-8000-00000000f001') $$,
  'P0001', 'PAWPIN:NOT_OWNER', 'B deleting A''s photo throws NOT_OWNER');
select throws_ok($$ select api.confirm_photo(gen_random_uuid(), 1600, 1200, 200, 120) $$,
  'P0001', 'PAWPIN:NOT_OWNER', 'confirming a photo that does not exist throws NOT_OWNER');
select throws_ok($$ select api.delete_photo(gen_random_uuid()) $$,
  'P0001', 'PAWPIN:NOT_OWNER', 'deleting a photo that does not exist throws NOT_OWNER');
select is_empty($$ select 1 from api.pet_photos $$, 'B sees none of A''s photos in api.pet_photos');
select is_empty($$ select 1 from audit.events $$, 'B''s rejected calls wrote no events');

select is(
  api.request_photo_upload('b4000000-0000-4000-8000-00000000f001',
                           'b4000000-0000-4000-8000-000000000001', 'front', 'image/jpeg', 1000),
  current_setting('pawpin.path_b1'), 'B requests an upload for their own pet'
);
select results_eq($$ select id from api.pet_photos $$,
  $$ values ('b4000000-0000-4000-8000-00000000f001'::uuid) $$,
  'B sees only their own photo in api.pet_photos');

select tests.clear_auth();
select results_eq(
  $$ select status::text, count(*)::int from registry.pet_photos
      where owner_id = current_setting('pawpin.a')::uuid group by 1 order by 1 $$,
  $$ values ('pending', 9), ('rejected', 1) $$,
  'A''s photos are untouched by B''s attempts'
);

-- ---------------------------------------------------------------------------
-- confirm_photo needs the uploaded file
-- ---------------------------------------------------------------------------
select tests.authenticate_as(current_setting('pawpin.a')::uuid);
select throws_ok(
  $$ select api.confirm_photo('a4000000-0000-4000-8000-00000000f001', 1600, 1200, 200, 120) $$,
  'P0001', 'PAWPIN:PHOTO_QUALITY',
  'confirm_photo without a storage.objects row throws PHOTO_QUALITY');

select tests.clear_auth();
insert into storage.objects (bucket_id, name, owner_id)
values ('pawpin-test-other', current_setting('pawpin.path_f1'), current_setting('pawpin.a'));
select tests.authenticate_as(current_setting('pawpin.a')::uuid);

select throws_ok(
  $$ select api.confirm_photo('a4000000-0000-4000-8000-00000000f001', 1600, 1200, 200, 120) $$,
  'P0001', 'PAWPIN:PHOTO_QUALITY', 'a file at the same path in another bucket does not count');
select results_eq(
  $$ select status::text from api.pet_photos where id = 'a4000000-0000-4000-8000-00000000f001' $$,
  $$ values ('pending') $$, 'the photo stays pending after a refused confirm');

-- ---------------------------------------------------------------------------
-- Storage policies on storage.objects (user A, then B and anon)
-- ---------------------------------------------------------------------------
select throws_ok($$ select tests.upload(current_setting('pawpin.path_b1')) $$, '42501', null,
  'A cannot upload into B''s folder, even at B''s pending path');
select throws_ok(
  $$ select tests.upload(current_setting('pawpin.b') || '/b4000000-0000-4000-8000-000000000001/'
                         || gen_random_uuid() || '.jpg') $$,
  '42501', null, 'A cannot upload anywhere under <B>/');
select throws_ok(
  $$ select tests.upload(current_setting('pawpin.a') || '/a4000000-0000-4000-8000-000000000001/'
                         || gen_random_uuid() || '.jpg') $$,
  '42501', null, 'A cannot upload to a path in their own folder that no pending photo has');
select throws_ok($$ select tests.upload(current_setting('pawpin.path_l1')) $$, '42501', null,
  'A cannot upload to the path of a photo that is not pending');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('pawpin-test-other', current_setting('pawpin.path_s1'), auth.uid()::text) $$,
  '42501', null, 'a pending path opens the pet-photos bucket only');
select lives_ok($$ select tests.upload(current_setting('pawpin.path_f1')) $$,
  'A uploads to their own pending photo''s path');

select tests.authenticate_as(current_setting('pawpin.b')::uuid);
select lives_ok($$ select tests.upload(current_setting('pawpin.path_b1')) $$,
  'B uploads to their own pending photo''s path');
select results_eq($$ select name from storage.objects $$,
  $$ values (current_setting('pawpin.path_b1')) $$, 'B sees only their own file');

select tests.authenticate_as(current_setting('pawpin.a')::uuid);
select is_empty(
  $$ select 1 from storage.objects where name like current_setting('pawpin.b') || '/%' $$,
  'A selecting B''s objects returns 0 rows');
select results_eq($$ select bucket_id, name from storage.objects $$,
  $$ values ('pet-photos', current_setting('pawpin.path_f1')) $$,
  'A sees only their own file in pet-photos, and nothing in other buckets');

select is(tests.row_count($$ update storage.objects set metadata = '{"tampered": true}' $$), 0,
  'A cannot update even their own files');
-- Storage blocks direct deletes with a statement trigger unless this is set; set it so the
-- assertion below is about the missing delete policy, not that trigger.
select set_config('storage.allow_delete_query', 'true', true);
select is(tests.row_count($$ delete from storage.objects $$), 0,
  'A cannot delete even their own files');
select set_config('storage.allow_delete_query', 'false', true);

select set_config('role', 'anon', true);
select set_config('request.jwt.claims', '', true);
select is_empty($$ select 1 from storage.objects $$, 'anon sees no files');
select throws_ok($$ select tests.upload(current_setting('pawpin.path_s1')) $$, '42501', null,
  'anon cannot upload, even to a pending path');
reset role;

select results_eq(
  $$ select name, metadata from storage.objects where bucket_id = 'pet-photos' order by name $$,
  format($$ select * from (values (%L, null::jsonb), (%L, null::jsonb)) v order by 1 $$,
         current_setting('pawpin.path_f1'), current_setting('pawpin.path_b1')),
  'both uploaded files are still there, unchanged'
);

-- ---------------------------------------------------------------------------
-- confirm_photo: quality and success (user A)
-- ---------------------------------------------------------------------------
select tests.authenticate_as(current_setting('pawpin.a')::uuid);

select throws_ok(
  $$ select api.confirm_photo('a4000000-0000-4000-8000-00000000f001', null, 1200, 200, 120) $$,
  'P0001', 'PAWPIN:VALIDATION', 'confirm_photo without a width throws VALIDATION');
select throws_ok(
  $$ select api.confirm_photo('a4000000-0000-4000-8000-00000000f001', 1600, null, 200, 120) $$,
  'P0001', 'PAWPIN:VALIDATION', 'confirm_photo without a height throws VALIDATION');
select throws_ok($$ select api.confirm_photo(null, 1600, 1200, 200, 120) $$,
  'P0001', 'PAWPIN:VALIDATION', 'confirm_photo with a null id throws VALIDATION');
select throws_ok(
  $$ select api.confirm_photo('a4000000-0000-4000-8000-00000000f001', 1600, 719, 200, 120) $$,
  'P0001', 'PAWPIN:PHOTO_QUALITY', 'with the file uploaded, height 719 throws PHOTO_QUALITY');
select throws_ok(
  $$ select api.confirm_photo('a4000000-0000-4000-8000-00000000f001', 719, 1600, 200, 120) $$,
  'P0001', 'PAWPIN:PHOTO_QUALITY', 'the short side is checked in either orientation');
select throws_ok(
  $$ select api.confirm_photo('a4000000-0000-4000-8000-00000000f001', 0, 1200, 200, 120) $$,
  'P0001', 'PAWPIN:PHOTO_QUALITY', 'a zero width throws PHOTO_QUALITY');
select throws_ok(
  $$ select api.confirm_photo('a4000000-0000-4000-8000-00000000f401', 1600, 1200, 200, 120) $$,
  'P0001', 'PAWPIN:PHOTO_QUALITY', 'a rejected photo cannot be confirmed');

select results_eq(
  $$ select id, status::text, width, height, blur_score, brightness, confirmed_at = now()
       from api.confirm_photo('a4000000-0000-4000-8000-00000000f001', 1600, 1200, 212.5, 118.25) $$,
  $$ values ('a4000000-0000-4000-8000-00000000f001'::uuid, 'ready', 1600, 1200, 212.5::real,
             118.25::real, true) $$,
  'a valid confirm marks the photo ready with confirmed_at set and its measurements stored'
);
select results_eq(
  $$ select status::text, width, height, confirmed_at = now()
       from api.pet_photos where id = 'a4000000-0000-4000-8000-00000000f001' $$,
  $$ values ('ready', 1600, 1200, true) $$,
  'the ready photo is readable through api.pet_photos'
);
select results_eq(
  $$ select actor_id = auth.uid(), subject_type, subject_id, metadata
       from audit.events where action = 'photo.added' $$,
  $$ values (true, 'photo', 'a4000000-0000-4000-8000-00000000f001'::uuid,
             '{"view": "front", "replaced_count": 0}'::jsonb) $$,
  'confirm_photo writes one photo.added event with the view and no path'
);

select results_eq(
  $$ select id, status::text, width, height
       from api.confirm_photo('a4000000-0000-4000-8000-00000000f001', 2000, 1500, 1, 1) $$,
  $$ values ('a4000000-0000-4000-8000-00000000f001'::uuid, 'ready', 1600, 1200) $$,
  'confirming a ready photo again returns it unchanged'
);
select is((select count(*)::int from audit.events where action = 'photo.added'), 1,
  'the repeated confirm wrote no event');

select lives_ok($$ select tests.upload(current_setting('pawpin.path_s1')) $$,
  'A uploads the side photo');
select results_eq(
  $$ select status::text, width, height
       from api.confirm_photo('a4000000-0000-4000-8000-00000000f101', 1280, 720, 150, 100) $$,
  $$ values ('ready', 1280, 720) $$,
  'a short side of exactly 720 is accepted'
);
select results_eq(
  $$ select view::text, id from api.pet_photos
      where pet_id = 'a4000000-0000-4000-8000-000000000001' and status = 'ready' order by view $$,
  $$ values ('front', 'a4000000-0000-4000-8000-00000000f001'::uuid),
            ('side', 'a4000000-0000-4000-8000-00000000f101'::uuid) $$,
  'confirming the side photo leaves the front photo alone'
);

-- ---------------------------------------------------------------------------
-- confirm_photo replaces same view (user A)
-- ---------------------------------------------------------------------------
select is(
  api.request_photo_upload('a4000000-0000-4000-8000-00000000f002',
                           'a4000000-0000-4000-8000-000000000001', 'front', 'image/jpeg', 300000),
  current_setting('pawpin.path_f2'), 'A requests a new front photo for Milo'
);
select lives_ok($$ select tests.upload(current_setting('pawpin.path_f2')) $$,
  'A uploads the new front photo');
select results_eq(
  $$ select id, status::text
       from api.confirm_photo('a4000000-0000-4000-8000-00000000f002', 1600, 1200, 190, 130) $$,
  $$ values ('a4000000-0000-4000-8000-00000000f002'::uuid, 'ready') $$,
  'confirming a second front photo succeeds'
);
select results_eq(
  $$ select id from api.pet_photos
      where pet_id = 'a4000000-0000-4000-8000-000000000001' and view = 'front' and status = 'ready' $$,
  $$ values ('a4000000-0000-4000-8000-00000000f002'::uuid) $$,
  'confirm_photo replaces same view: exactly one ready front photo remains, the new one'
);
select is_empty($$ select 1 from api.pet_photos where id = 'a4000000-0000-4000-8000-00000000f001' $$,
  'the replaced photo''s row is removed');
select results_eq(
  $$ select metadata from audit.events
      where action = 'photo.added' and subject_id = 'a4000000-0000-4000-8000-00000000f002' $$,
  $$ values ('{"view": "front", "replaced_count": 1}'::jsonb) $$,
  'the photo.added event counts the replaced photo'
);

select tests.clear_auth();
select results_eq(
  $$ select storage_path, attempts, last_error from registry.storage_deletions
      where storage_path like current_setting('pawpin.a') || '/%' $$,
  $$ values (current_setting('pawpin.path_f1'), 0, null::text) $$,
  'the replaced photo''s path is queued in registry.storage_deletions, and the new one is not'
);
select results_eq(
  $$ select count(*)::int from storage.objects
      where bucket_id = 'pet-photos' and name = current_setting('pawpin.path_f1') $$,
  $$ values (1) $$,
  'the replaced file stays in storage until the cleanup job removes it'
);
select tests.authenticate_as(current_setting('pawpin.a')::uuid);

-- A retake that fails the quality check keeps the previous good photo.
select is(
  api.request_photo_upload('a4000000-0000-4000-8000-00000000f003',
                           'a4000000-0000-4000-8000-000000000001', 'front', 'image/jpeg', 300000),
  current_setting('pawpin.path_f3'), 'A requests a retake of the front photo'
);
select lives_ok($$ select tests.upload(current_setting('pawpin.path_f3')) $$,
  'A uploads the retake');
select throws_ok(
  $$ select api.confirm_photo('a4000000-0000-4000-8000-00000000f003', 1600, 600, 190, 130) $$,
  'P0001', 'PAWPIN:PHOTO_QUALITY', 'a retake with a short side of 600 throws PHOTO_QUALITY');
select results_eq(
  $$ select id, status::text from api.pet_photos
      where pet_id = 'a4000000-0000-4000-8000-000000000001' and view = 'front' order by status $$,
  $$ values ('a4000000-0000-4000-8000-00000000f003'::uuid, 'pending'),
            ('a4000000-0000-4000-8000-00000000f002'::uuid, 'ready') $$,
  'the failed retake stays pending and the previous front photo stays ready'
);

-- Extra photos are never replaced (Pip).
select lives_ok(
  $$ select api.request_photo_upload('a4000000-0000-4000-8000-00000000f301',
                                     'a4000000-0000-4000-8000-000000000003', 'extra', 'image/jpeg', 1000),
            api.request_photo_upload('a4000000-0000-4000-8000-00000000f302',
                                     'a4000000-0000-4000-8000-000000000003', 'extra', 'image/jpeg', 1000) $$,
  'A requests two extra photos for Pip');
select lives_ok(
  $$ select tests.upload(current_setting('pawpin.path_x1')),
            tests.upload(current_setting('pawpin.path_x2')) $$,
  'A uploads both extra photos');
select lives_ok(
  $$ select api.confirm_photo('a4000000-0000-4000-8000-00000000f301', 1600, 1200, 150, 120) $$,
  'A confirms the first extra photo');
select lives_ok(
  $$ select api.confirm_photo('a4000000-0000-4000-8000-00000000f302', 1600, 1200, 150, 120) $$,
  'A confirms the second extra photo');
select results_eq(
  $$ select id from api.pet_photos
      where pet_id = 'a4000000-0000-4000-8000-000000000003' and status = 'ready' order by id $$,
  $$ values ('a4000000-0000-4000-8000-00000000f301'::uuid),
            ('a4000000-0000-4000-8000-00000000f302'::uuid) $$,
  'both extra photos stay ready'
);

select tests.clear_auth();
select is(
  (select count(*)::int from registry.storage_deletions
    where storage_path like current_setting('pawpin.a') || '/%'),
  1, 'the failed retake and the extra photos queued nothing'
);

-- ---------------------------------------------------------------------------
-- delete_photo (user A)
-- ---------------------------------------------------------------------------
select tests.authenticate_as(current_setting('pawpin.a')::uuid);

select lives_ok($$ select api.delete_photo('a4000000-0000-4000-8000-00000000f003') $$,
  'A deletes the pending retake');
select is_empty($$ select 1 from api.pet_photos where id = 'a4000000-0000-4000-8000-00000000f003' $$,
  'delete_photo removes the row');
select results_eq(
  $$ select actor_id = auth.uid(), subject_type, subject_id, metadata
       from audit.events where action = 'photo.deleted' $$,
  $$ values (true, 'photo', 'a4000000-0000-4000-8000-00000000f003'::uuid,
             '{"view": "front"}'::jsonb) $$,
  'delete_photo writes one photo.deleted event with the view and no path'
);
select lives_ok($$ select api.delete_photo('a4000000-0000-4000-8000-00000000f101') $$,
  'A deletes the ready side photo');

select tests.clear_auth();
select results_eq(
  $$ select storage_path from registry.storage_deletions
      where storage_path like current_setting('pawpin.a') || '/%' order by id $$,
  $$ values (current_setting('pawpin.path_f1')), (current_setting('pawpin.path_f3')),
            (current_setting('pawpin.path_s1')) $$,
  'delete_photo queues the path of each deleted photo, pending or ready'
);
select tests.authenticate_as(current_setting('pawpin.a')::uuid);

select throws_ok($$ select api.delete_photo('a4000000-0000-4000-8000-00000000f003') $$,
  'P0001', 'PAWPIN:NOT_OWNER', 'deleting an already deleted photo throws NOT_OWNER');
select throws_ok(
  $$ select api.confirm_photo('a4000000-0000-4000-8000-00000000f003', 1600, 1200, 190, 130) $$,
  'P0001', 'PAWPIN:NOT_OWNER', 'confirming a deleted photo throws NOT_OWNER');
select throws_ok($$ select api.delete_photo(null) $$,
  'P0001', 'PAWPIN:VALIDATION', 'delete_photo with a null id throws VALIDATION');

-- A deleted slot no longer accepts an upload.
select is(
  api.request_photo_upload('a4000000-0000-4000-8000-00000000f004',
                           'a4000000-0000-4000-8000-000000000001', 'front', 'image/jpeg', 1000),
  current_setting('pawpin.path_f4'), 'A requests another front photo'
);
select lives_ok($$ select api.delete_photo('a4000000-0000-4000-8000-00000000f004') $$,
  'A deletes it before uploading');
select throws_ok($$ select tests.upload(current_setting('pawpin.path_f4')) $$, '42501', null,
  'once its pending photo is deleted, the path no longer accepts an upload');
select results_eq(
  $$ select view::text, id, status::text from api.pet_photos
      where pet_id = 'a4000000-0000-4000-8000-000000000001' order by view $$,
  $$ values ('front', 'a4000000-0000-4000-8000-00000000f002'::uuid, 'ready'),
            ('markings', 'a4000000-0000-4000-8000-00000000f201'::uuid, 'pending') $$,
  'Milo keeps its ready front photo and its pending markings photo'
);

-- ---------------------------------------------------------------------------
-- The hourly upload limit (user R, six pets)
-- ---------------------------------------------------------------------------
select tests.authenticate_as(current_setting('pawpin.r')::uuid);

select lives_ok(
  $$ select api.request_photo_upload(gen_random_uuid(),
                                     ('c4000000-0000-4000-8000-00000000000' || (1 + (n - 1) / 6))::uuid,
                                     'extra', 'image/jpeg', 1000)
       from generate_series(1, 30) n $$,
  '30 upload requests within an hour succeed');
select throws_ok(
  $$ select api.request_photo_upload('c4000000-0000-4000-8000-00000000f001',
                                     'c4000000-0000-4000-8000-000000000006', 'front', 'image/jpeg', 1000) $$,
  'P0001', 'PAWPIN:RATE_LIMITED', 'the 31st request within an hour throws RATE_LIMITED');
select results_eq(
  $$ select (select count(*)::int from api.pet_photos),
            (select count(*)::int from audit.events where action = 'photo.upload_requested') $$,
  $$ values (30, 30) $$,
  'the refused request added no row and no event'
);

select tests.clear_auth();
update audit.events set created_at = now() - interval '61 minutes'
 where id = (select min(id) from audit.events
              where actor_id = current_setting('pawpin.r')::uuid
                and action = 'photo.upload_requested');
select tests.authenticate_as(current_setting('pawpin.r')::uuid);

select is(
  api.request_photo_upload('c4000000-0000-4000-8000-00000000f001',
                           'c4000000-0000-4000-8000-000000000006', 'front', 'image/jpeg', 1000),
  current_setting('pawpin.r')
    || '/c4000000-0000-4000-8000-000000000006/c4000000-0000-4000-8000-00000000f001.jpg',
  'a request from more than an hour ago no longer counts'
);
select is(
  api.request_photo_upload('c4000000-0000-4000-8000-00000000f001',
                           'c4000000-0000-4000-8000-000000000006', 'front', 'image/jpeg', 1000),
  current_setting('pawpin.r')
    || '/c4000000-0000-4000-8000-000000000006/c4000000-0000-4000-8000-00000000f001.jpg',
  'a retry of an accepted request still succeeds at the limit'
);
select throws_ok(
  $$ select api.request_photo_upload(gen_random_uuid(), 'c4000000-0000-4000-8000-000000000006',
                                     'side', 'image/jpeg', 1000) $$,
  'P0001', 'PAWPIN:RATE_LIMITED', 'the hour rolls: 30 requests in the last hour throw RATE_LIMITED again');

select tests.clear_auth();
update audit.events set created_at = now() - interval '59 minutes'
 where id = (select min(id) from audit.events
              where actor_id = current_setting('pawpin.r')::uuid
                and action = 'photo.upload_requested'
                and created_at = now());
select tests.authenticate_as(current_setting('pawpin.r')::uuid);

select throws_ok(
  $$ select api.request_photo_upload(gen_random_uuid(), 'c4000000-0000-4000-8000-000000000006',
                                     'side', 'image/jpeg', 1000) $$,
  'P0001', 'PAWPIN:RATE_LIMITED', 'a request from 59 minutes ago still counts');

-- ---------------------------------------------------------------------------
-- A caller whose account row no longer exists (deleted account, token still valid)
-- ---------------------------------------------------------------------------
select tests.clear_auth();
delete from entitlements.accounts where owner_id = current_setting('pawpin.n')::uuid;
select tests.authenticate_as(current_setting('pawpin.n')::uuid);

select throws_ok(
  $$ select api.request_photo_upload(gen_random_uuid(), 'd4000000-0000-4000-8000-000000000001',
                                     'front', 'image/jpeg', 1000) $$,
  'P0001', 'PAWPIN:UNAUTHENTICATED',
  'request_photo_upload without an account row throws UNAUTHENTICATED');

-- ---------------------------------------------------------------------------
-- Audit: one event per success, never a path
-- ---------------------------------------------------------------------------
select tests.clear_auth();

select results_eq(
  $$ select action, count(*)::int from audit.events
      where actor_id = current_setting('pawpin.a')::uuid group by action order by action $$,
  $$ values ('photo.added', 5), ('photo.deleted', 3), ('photo.upload_requested', 15) $$,
  'each of A''s successful calls wrote exactly one event, and refused calls and retries wrote none'
);
select results_eq(
  $$ select actor_id, count(*)::int from audit.events
      where actor_id in (current_setting('pawpin.b')::uuid, current_setting('pawpin.r')::uuid,
                         current_setting('pawpin.n')::uuid)
      group by actor_id order by count(*) $$,
  format($$ values (%L::uuid, 1), (%L::uuid, 31) $$,
         current_setting('pawpin.b'), current_setting('pawpin.r')),
  'B has one event for their own request, R one per accepted request, N none'
);
select is_empty(
  $$ select id from audit.events
      where action like 'photo.%'
        and not (subject_type = 'photo'
                 and metadata - 'view' - 'replaced_count' = '{}'::jsonb
                 and metadata ->> 'view' in ('front', 'side', 'markings', 'extra')
                 and (not metadata ? 'replaced_count'
                      or jsonb_typeof(metadata -> 'replaced_count') = 'number')) $$,
  'photo event metadata holds only a view and a replaced count'
);
select is_empty(
  $$ select id from audit.events
      where action like 'photo.%' and (metadata::text like '%/%' or metadata::text like '%.jpg%') $$,
  'no photo event mentions a storage path'
);

-- ---------------------------------------------------------------------------
-- Concurrent calls: two real sessions through dblink
-- ---------------------------------------------------------------------------
-- As in 030_pets.test.sql: the two sessions (s1, s2) can't see this transaction's uncommitted rows,
-- so a third (setup) commits user C with two pets, two pending front photos of the first with their
-- files and 29 upload requests in the last hour, and removes all of it at the end. Race users left behind by an
-- aborted run are removed first, so reruns are safe. dblink needs password authentication for a
-- non-superuser, so the sessions connect back over TCP with the local Supabase default credentials.
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

-- True once the waiter's backend is blocked by the holder's (polls for up to 10 seconds).
create function pg_temp.blocked_by(waiter text, holder text) returns boolean
language plpgsql as $$
begin
  for i in 1..200 loop
    if current_setting('pawpin.pid_' || holder)::int
       = any (pg_blocking_pids(current_setting('pawpin.pid_' || waiter)::int)) then
      return true;
    end if;
    perform pg_sleep(0.05);
  end loop;
  return false;
end
$$;

-- Removes every race user with their events, queued deletions and files (rows only: Storage keeps
-- no bytes for files written straight into storage.objects). Direct deletes from storage.objects
-- are blocked unless storage.allow_delete_query is set.
create function pg_temp.remove_race_users() returns void language plpgsql as $$
begin
  perform extensions.dblink_exec('setup', $q$
    set storage.allow_delete_query = 'true';
    delete from audit.events
     where actor_id in (select id from auth.users where email like 'photos-race-%@pawpin.test');
    delete from registry.storage_deletions
     where split_part(storage_path, '/', 1)
           in (select id::text from auth.users where email like 'photos-race-%@pawpin.test');
    delete from storage.objects
     where bucket_id = 'pet-photos'
       and split_part(name, '/', 1)
           in (select id::text from auth.users where email like 'photos-race-%@pawpin.test');
    delete from auth.users where email like 'photos-race-%@pawpin.test';
    reset storage.allow_delete_query;
  $q$);
end
$$;

do $$
declare
  conn text;
  c uuid;
  pet uuid := gen_random_uuid();
  pet2 uuid := gen_random_uuid();
  p1 uuid := gen_random_uuid();
  p2 uuid := gen_random_uuid();
begin
  foreach conn in array array['setup', 's1', 's2'] loop
    perform extensions.dblink_connect(conn, pg_temp.connection_string());
    perform set_config('pawpin.pid_' || conn,
      (select pid::text from extensions.dblink(conn, 'select pg_backend_pid()') as t(pid int)), true);
  end loop;
  perform pg_temp.remove_race_users();

  select uid into c from extensions.dblink('setup',
    format('select tests.create_user(%L)', 'photos-race-' || gen_random_uuid() || '@pawpin.test'))
    as t(uid uuid);
  perform set_config('pawpin.c', c::text, true);
  perform set_config('pawpin.c_pet', pet::text, true);
  perform set_config('pawpin.c_pet2', pet2::text, true);
  perform set_config('pawpin.c_p1', p1::text, true);
  perform set_config('pawpin.c_p2', p2::text, true);
  perform set_config('pawpin.c_path1', c || '/' || pet || '/' || p1 || '.jpg', true);
  perform set_config('pawpin.c_path2', c || '/' || pet || '/' || p2 || '.jpg', true);

  perform extensions.dblink_exec('setup', format(
    $q$ insert into registry.pets (id, owner_id, name, species)
        values (%1$L, %2$L, 'Race', 'dog'), (%7$L, %2$L, 'Dash', 'cat');
        insert into registry.pet_photos (id, pet_id, owner_id, view, storage_path, bytes)
        values (%3$L, %1$L, %2$L, 'front', %5$L, 1000), (%4$L, %1$L, %2$L, 'front', %6$L, 1000);
        insert into storage.objects (bucket_id, name, owner_id)
        values ('pet-photos', %5$L, %2$L), ('pet-photos', %6$L, %2$L);
        insert into audit.events (actor_id, action, subject_type, subject_id, metadata)
        select %2$L, 'photo.upload_requested', 'photo', gen_random_uuid(), '{"view": "extra"}'
          from generate_series(1, 29) $q$,
    pet, c, p1, p2, current_setting('pawpin.c_path1'), current_setting('pawpin.c_path2'), pet2));
end
$$;

-- 1. Two pending front photos of one pet are confirmed at once.
select pg_temp.begin_as('s1', current_setting('pawpin.c')::uuid);
select pg_temp.begin_as('s2', current_setting('pawpin.c')::uuid);
select is(
  (select id from extensions.dblink('s1',
     format('select id from api.confirm_photo(%L, 1600, 1200, 200, 120)', current_setting('pawpin.c_p1')))
     as t(id uuid)),
  current_setting('pawpin.c_p1')::uuid, 'the first confirm marks its front photo ready');
select extensions.dblink_send_query('s2',
  format('select id from api.confirm_photo(%L, 1600, 1200, 200, 120)', current_setting('pawpin.c_p2')));
select ok(pg_temp.blocked_by('s2', 's1'),
  'a second confirm for the same pet waits for the first to finish');
select extensions.dblink_exec('s1', 'commit');
select results_eq($$ select * from extensions.dblink_get_result('s2') as t(id uuid) $$,
  $$ values (current_setting('pawpin.c_p2')::uuid) $$,
  'the waiting confirm of the same view succeeds instead of colliding on the one-ready-per-view index');
select * from extensions.dblink_get_result('s2') as t(id uuid);
select extensions.dblink_exec('s2', 'commit');
select results_eq(
  $$ select id, status::text from registry.pet_photos where pet_id = current_setting('pawpin.c_pet')::uuid $$,
  $$ values (current_setting('pawpin.c_p2')::uuid, 'ready') $$,
  'concurrent confirms leave exactly one ready front photo, the later one'
);
select results_eq(
  $$ select storage_path from registry.storage_deletions
      where split_part(storage_path, '/', 1) = current_setting('pawpin.c') $$,
  $$ values (current_setting('pawpin.c_path1')) $$,
  'the front photo replaced by the concurrent confirm is queued for deletion'
);

-- 2. Two requests for different pets race for the last request of the hour (C has 29 in the last
-- hour). Different pets, so only the account lock can make the second one wait.
select pg_temp.begin_as('s1', current_setting('pawpin.c')::uuid);
select pg_temp.begin_as('s2', current_setting('pawpin.c')::uuid);
select is(
  (select path from extensions.dblink('s1',
     format('select api.request_photo_upload(gen_random_uuid(), %L, %L, %L, 1000)',
            current_setting('pawpin.c_pet'), 'side', 'image/jpeg'))
     as t(path text)) like current_setting('pawpin.c') || '/%',
  true, 'the 30th request of the hour succeeds');
select extensions.dblink_send_query('s2',
  format('select api.request_photo_upload(gen_random_uuid(), %L, %L, %L, 1000)',
         current_setting('pawpin.c_pet2'), 'front', 'image/jpeg'));
select ok(pg_temp.blocked_by('s2', 's1'),
  'a concurrent request by the same owner waits for the first to finish');
select extensions.dblink_exec('s1', 'commit');
select throws_ok($$ select * from extensions.dblink_get_result('s2') as t(path text) $$,
  'P0001', 'PAWPIN:RATE_LIMITED',
  'concurrent requests never exceed the hourly limit: the waiting 31st request is refused');
select * from extensions.dblink_get_result('s2') as t(path text);
select extensions.dblink_exec('s2', 'rollback');
select is(
  (select count(*)::int from audit.events
    where actor_id = current_setting('pawpin.c')::uuid and action = 'photo.upload_requested'
      and created_at > now() - interval '1 hour'),
  30, 'the owner ends with exactly 30 upload requests in the hour'
);

-- Remove the committed fixtures.
select pg_temp.remove_race_users();
select extensions.dblink_disconnect(conn) from unnest(array['setup', 's1', 's2']) conn;
select results_eq(
  $$ select (select count(*)::int from auth.users where id = current_setting('pawpin.c')::uuid),
            (select count(*)::int from storage.objects
              where split_part(name, '/', 1) = current_setting('pawpin.c')),
            (select count(*)::int from registry.storage_deletions
              where split_part(storage_path, '/', 1) = current_setting('pawpin.c')) $$,
  $$ values (0, 0, 0) $$,
  'the concurrency fixtures are removed'
);

select * from finish();
rollback;
