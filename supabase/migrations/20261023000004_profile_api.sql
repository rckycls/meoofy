-- Profile and onboarding: the first client-callable api.* functions (spec §6) and the view
-- clients read their profile through.
--
-- Every api.* function is security definer with an empty search_path, so each name below is
-- schema-qualified. Each one checks, in order: the caller is signed in, the input is valid,
-- then does its work and writes one audit event.

-- ---------------------------------------------------------------------------
-- Read: the caller's own profile
-- ---------------------------------------------------------------------------
-- Only `api` is exposed to PostgREST, so clients cannot query identity.profiles directly.
-- security_invoker makes the view run with the caller's rights: row-level security on the base
-- table still filters it to the caller's row, and anon (no grant) sees nothing.
create view api.my_profile
with (security_invoker = true)
as
select id, display_name, onboarding_path, onboarding_completed_at
from identity.profiles;

grant select on api.my_profile to authenticated;

-- ---------------------------------------------------------------------------
-- api.update_profile
-- ---------------------------------------------------------------------------
-- Sets the caller's display name: 1 to displayNameMax characters after trimming. internal.trim_ws
-- trims exactly what JavaScript's String.prototype.trim does, so a name the app accepts is a name
-- this accepts. The audit event does not carry the name.
create function api.update_profile(display_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid constant uuid := auth.uid();
  name_max constant integer := (registry.limits() ->> 'displayNameMax')::integer;
  trimmed constant text := internal.trim_ws(update_profile.display_name);
begin
  if uid is null then
    perform internal.fail('UNAUTHENTICATED');
  end if;

  if trimmed is null or pg_catalog.char_length(trimmed) not between 1 and name_max then
    perform internal.fail('VALIDATION', 'display name must be 1 to ' || name_max || ' characters');
  end if;

  update identity.profiles p
     set display_name = trimmed
   where p.id = uid;
  -- A valid token whose user (and so profile) is gone: the session is no longer usable.
  if not found then
    perform internal.fail('UNAUTHENTICATED');
  end if;

  perform audit.record('profile.updated', 'profile', uid);
end
$$;

-- ---------------------------------------------------------------------------
-- api.complete_onboarding
-- ---------------------------------------------------------------------------
-- Records the path chosen during onboarding and when it was finished. Idempotent: the first call
-- sets both, and any later call, with any path, changes nothing and writes no event. The row lock
-- makes two simultaneous first calls record exactly one completion.
create function api.complete_onboarding(path identity.onboarding_path)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid constant uuid := auth.uid();
  completed_at timestamptz;
begin
  if uid is null then
    perform internal.fail('UNAUTHENTICATED');
  end if;

  if complete_onboarding.path is null then
    perform internal.fail('VALIDATION', 'path is required');
  end if;

  select p.onboarding_completed_at
    into completed_at
    from identity.profiles p
   where p.id = uid
     for update;
  -- A valid token whose user (and so profile) is gone: the session is no longer usable.
  if not found then
    perform internal.fail('UNAUTHENTICATED');
  end if;

  if completed_at is not null then
    return;
  end if;

  update identity.profiles p
     set onboarding_path = complete_onboarding.path,
         onboarding_completed_at = pg_catalog.now()
   where p.id = uid;

  perform audit.record(
    'onboarding.completed', 'profile', uid,
    pg_catalog.jsonb_build_object('path', complete_onboarding.path)
  );
end
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Postgres lets PUBLIC execute every new function; only signed-in users may call these.
revoke all on function
  api.update_profile(text),
  api.complete_onboarding(identity.onboarding_path)
from public;

grant execute on function
  api.update_profile(text),
  api.complete_onboarding(identity.onboarding_path)
to authenticated;
