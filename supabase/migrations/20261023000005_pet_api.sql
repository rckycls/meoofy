-- Pets: the client-callable write paths (api.create_pet, api.update_pet, api.delete_pet) and the
-- views clients read their pets and plan usage through (spec §6, Ruling 13).
--
-- Same conventions as 20261023000004_profile_api.sql: every api.* function is security definer
-- with an empty search_path, so each name is schema-qualified. Each one checks, in order: the
-- caller is signed in, owns the subject, and sent valid input; then it does its work and writes
-- one audit event. Audit metadata holds enum values and counts only, never a pet name or a
-- storage path.

-- ---------------------------------------------------------------------------
-- Validation shared by create_pet and update_pet
-- ---------------------------------------------------------------------------
-- These mirror petInputSchema in packages/core exactly: trim what String.prototype.trim trims
-- (internal.trim_ws), count characters rather than bytes (char_length, so 40 emoji are 40), and
-- take the bounds from the generated registry.limits(). Each returns the value to store or raises
-- MEOOFY:VALIDATION. The detail never echoes the input.

-- The trimmed name, which must be 1 to petNameMax characters.
create function registry.clean_pet_name(name text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  name_max constant integer := (registry.limits() ->> 'petNameMax')::integer;
  trimmed constant text := internal.trim_ws(clean_pet_name.name);
begin
  if trimmed is null or pg_catalog.char_length(trimmed) not between 1 and name_max then
    perform internal.fail('VALIDATION', 'name must be 1 to ' || name_max || ' characters');
  end if;
  return trimmed;
end
$$;

-- The trimmed breed, at most breedMax characters. Null or empty after trimming is stored as null
-- (the table allows 1 to breedMax characters or null).
create function registry.clean_pet_breed(breed text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  breed_max constant integer := (registry.limits() ->> 'breedMax')::integer;
  trimmed constant text := nullif(internal.trim_ws(clean_pet_breed.breed), '');
begin
  if pg_catalog.char_length(trimmed) > breed_max then
    perform internal.fail('VALIDATION', 'breed must be at most ' || breed_max || ' characters');
  end if;
  return trimmed;
end
$$;

-- The age in whole months, 0 to ageMonthsMax, or null when unknown.
create function registry.clean_pet_age(age_months integer)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  age_max constant integer := (registry.limits() ->> 'ageMonthsMax')::integer;
begin
  if clean_pet_age.age_months not between 0 and age_max then
    perform internal.fail('VALIDATION', 'age_months must be 0 to ' || age_max);
  end if;
  return clean_pet_age.age_months;
end
$$;

-- ---------------------------------------------------------------------------
-- api.create_pet
-- ---------------------------------------------------------------------------
-- Creates a private pet for the caller. Ids are client-generated, so a retried call is
-- idempotent: if the id already belongs to the caller, the stored row comes back unchanged and no
-- event is written. An id that belongs to another owner raises NOT_OWNER.
--
-- The order makes concurrent calls safe. The caller's entitlements.accounts row is locked first,
-- so every create for one owner runs one at a time; the existence check and the pet count that
-- follow (each a new snapshot under read committed) then see every pet an earlier create
-- committed. Two simultaneous creates can't both take the last slot, and a retry that raced the
-- original finds its row. The retry check comes before validation and the limit, so a retry still
-- succeeds once the owner is at the limit.
create function api.create_pet(
  id uuid,
  name text,
  species registry.species,
  breed text,
  age_months integer
)
returns registry.pets
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid constant uuid := auth.uid();
  account_tier entitlements.tier;
  tier_limit integer;
  new_name text;
  new_breed text;
  new_age integer;
  pet registry.pets;
begin
  if uid is null then
    perform internal.fail('UNAUTHENTICATED');
  end if;

  if create_pet.id is null then
    perform internal.fail('VALIDATION', 'id is required');
  end if;

  select a.tier
    into account_tier
    from entitlements.accounts a
   where a.owner_id = uid
     for update;
  -- A valid token whose user (and so account) is gone: the session is no longer usable.
  if not found then
    perform internal.fail('UNAUTHENTICATED');
  end if;

  select p.*
    into pet
    from registry.pets p
   where p.id = create_pet.id;
  if found then
    if pet.owner_id <> uid then
      perform internal.fail('NOT_OWNER');
    end if;
    return pet;
  end if;

  new_name := registry.clean_pet_name(create_pet.name);
  if create_pet.species is null then
    perform internal.fail('VALIDATION', 'species is required');
  end if;
  new_breed := registry.clean_pet_breed(create_pet.breed);
  new_age := registry.clean_pet_age(create_pet.age_months);

  -- Only private pets count: archiving a pet frees its slot. A null limit means unlimited.
  tier_limit := entitlements.pet_limit(account_tier);
  if tier_limit is not null and (
    select pg_catalog.count(*)
      from registry.pets p
     where p.owner_id = uid
       and p.registration_state = 'private'
  ) >= tier_limit then
    perform internal.fail('PET_LIMIT_REACHED');
  end if;

  insert into registry.pets (id, owner_id, name, species, breed, age_months)
  values (create_pet.id, uid, new_name, create_pet.species, new_breed, new_age)
  on conflict do nothing
  returning * into pet;
  -- Another owner inserted this id after the check above. It can't be the caller's own row:
  -- the account lock serialises the caller's creates.
  if not found then
    perform internal.fail('NOT_OWNER');
  end if;

  perform audit.record(
    'pet.created', 'pet', pet.id,
    pg_catalog.jsonb_build_object('species', pet.species)
  );
  return pet;
end
$$;

-- ---------------------------------------------------------------------------
-- api.update_pet
-- ---------------------------------------------------------------------------
-- Changes the given fields of one of the caller's pets. A null argument leaves that field
-- unchanged. Breed and age are cleared with clear_breed / clear_age (the client maps a null in its
-- patch to these), and a clear flag together with a new value for the same field is ambiguous, so
-- it is rejected. A breed that is empty after trimming also clears it, as in the client schema.
-- A missing pet and someone else's pet both raise NOT_OWNER, so other owners' ids can't be probed.
create function api.update_pet(
  id uuid,
  name text default null,
  species registry.species default null,
  breed text default null,
  age_months integer default null,
  clear_breed boolean default false,
  clear_age boolean default false
)
returns registry.pets
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid constant uuid := auth.uid();
  clearing_breed constant boolean := coalesce(update_pet.clear_breed, false);
  clearing_age constant boolean := coalesce(update_pet.clear_age, false);
  new_name text;
  new_breed text;
  new_age integer;
  pet registry.pets;
begin
  if uid is null then
    perform internal.fail('UNAUTHENTICATED');
  end if;

  if update_pet.id is null then
    perform internal.fail('VALIDATION', 'id is required');
  end if;

  perform 1
     from registry.pets p
    where p.id = update_pet.id
      and p.owner_id = uid
      for update;
  if not found then
    perform internal.fail('NOT_OWNER');
  end if;

  if clearing_breed and update_pet.breed is not null then
    perform internal.fail('VALIDATION', 'breed and clear_breed cannot both be set');
  end if;
  if clearing_age and update_pet.age_months is not null then
    perform internal.fail('VALIDATION', 'age_months and clear_age cannot both be set');
  end if;
  if update_pet.name is not null then
    new_name := registry.clean_pet_name(update_pet.name);
  end if;
  new_breed := registry.clean_pet_breed(update_pet.breed);
  new_age := registry.clean_pet_age(update_pet.age_months);

  update registry.pets p
     set name = coalesce(new_name, p.name),
         species = coalesce(update_pet.species, p.species),
         breed = case
                   when clearing_breed then null
                   when update_pet.breed is not null then new_breed
                   else p.breed
                 end,
         age_months = case
                        when clearing_age then null
                        when update_pet.age_months is not null then new_age
                        else p.age_months
                      end
   where p.id = update_pet.id
  returning p.* into pet;

  perform audit.record('pet.updated', 'pet', pet.id);
  return pet;
end
$$;

-- ---------------------------------------------------------------------------
-- api.delete_pet
-- ---------------------------------------------------------------------------
-- Deletes one of the caller's pets. Every stored object of the pet (ready, pending or rejected
-- photos) is queued in registry.storage_deletions for the cleanup job first, then the pet row is
-- deleted and its photo rows cascade. The pet row is locked: inserting a photo takes a key-share
-- lock on its pet through the foreign key, so a concurrent photo request waits and then fails
-- instead of adding a path after the queue was written. The event records how many photos were
-- queued, not their paths.
create function api.delete_pet(id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid constant uuid := auth.uid();
  photo_count integer;
begin
  if uid is null then
    perform internal.fail('UNAUTHENTICATED');
  end if;

  if delete_pet.id is null then
    perform internal.fail('VALIDATION', 'id is required');
  end if;

  perform 1
     from registry.pets p
    where p.id = delete_pet.id
      and p.owner_id = uid
      for update;
  if not found then
    perform internal.fail('NOT_OWNER');
  end if;

  insert into registry.storage_deletions (storage_path)
  select ph.storage_path
    from registry.pet_photos ph
   where ph.pet_id = delete_pet.id;
  get diagnostics photo_count = row_count;

  delete from registry.pets p where p.id = delete_pet.id;

  perform audit.record(
    'pet.deleted', 'pet', delete_pet.id,
    pg_catalog.jsonb_build_object('photo_count', photo_count)
  );
end
$$;

-- ---------------------------------------------------------------------------
-- Reads: the caller's pets and plan usage
-- ---------------------------------------------------------------------------
-- Only `api` is exposed to PostgREST. security_invoker makes each view run with the caller's
-- rights, so row-level security on the base tables filters it to the caller's rows, and anon (no
-- grant) sees nothing.
create view api.pets
with (security_invoker = true)
as
select id, name, species, breed, age_months, registration_state, discovery_enabled, created_at,
       updated_at
from registry.pets;

-- Most private pets a tier may own, or null when unlimited. api.my_entitlement needs it, but the
-- view runs with the caller's rights and clients may not execute entitlements.pet_limit, so this
-- wrapper is their only way to it. The numbers are public plan facts.
create function api.pet_limit(tier entitlements.tier)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select entitlements.pet_limit(pet_limit.tier)
$$;

-- One row for the caller: their tier, its pet limit and how many private pets they have (what
-- create_pet counts against the limit).
create view api.my_entitlement
with (security_invoker = true)
as
select a.tier,
       api.pet_limit(a.tier) as pet_limit,
       (select count(*)::integer
          from registry.pets p
         where p.owner_id = a.owner_id
           and p.registration_state = 'private') as active_pets
from entitlements.accounts a;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Postgres lets PUBLIC execute every new function. The validation helpers are reached only by the
-- api.* functions, as their owner; the api.* functions are for signed-in users.
revoke all on function
  registry.clean_pet_name(text),
  registry.clean_pet_breed(text),
  registry.clean_pet_age(integer),
  api.create_pet(uuid, text, registry.species, text, integer),
  api.update_pet(uuid, text, registry.species, text, integer, boolean, boolean),
  api.delete_pet(uuid),
  api.pet_limit(entitlements.tier)
from public;

grant execute on function
  api.create_pet(uuid, text, registry.species, text, integer),
  api.update_pet(uuid, text, registry.species, text, integer, boolean, boolean),
  api.delete_pet(uuid),
  api.pet_limit(entitlements.tier)
to authenticated;

grant select on api.pets, api.my_entitlement to authenticated;
