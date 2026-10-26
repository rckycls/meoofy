-- Meoofy module schemas, enums, tables, triggers, shared helpers and grants (spec §5, §6).
--
-- Clients only ever read: `authenticated` gets SELECT on the owner tables (filtered by the
-- row-level security policies in 20261023000002_rls.sql) and `anon` gets nothing. Every write
-- goes through `api.*` security-definer functions (later migrations) or Edge Functions.

-- ---------------------------------------------------------------------------
-- Schemas
-- ---------------------------------------------------------------------------
-- Client-callable functions. With graphql_public, the only schema PostgREST exposes.
create schema api;
create schema identity;
create schema if not exists registry; -- the generated limits migration creates it first
create schema entitlements;
create schema audit;
-- Helpers used by the other schemas; never callable by clients.
create schema internal;

create extension if not exists citext with schema extensions;

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

-- Raises `MEOOFY:<code>`, the stable error prefix packages/core parses into an AppError.
-- Only the server codes the app knows are accepted; anything else is a programming error.
create function internal.fail(code text, detail text default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if code is null or code not in (
    'UNAUTHENTICATED', 'NOT_OWNER', 'VALIDATION', 'PET_LIMIT_REACHED', 'PHOTO_QUALITY',
    'RATE_LIMITED'
  ) then
    raise exception 'internal.fail: unknown error code %', coalesce(code, 'null')
      using errcode = 'invalid_parameter_value';
  end if;

  if fail.detail is null then
    raise exception using message = 'MEOOFY:' || code, errcode = 'P0001';
  end if;
  raise exception using message = 'MEOOFY:' || code, detail = fail.detail, errcode = 'P0001';
end
$$;

-- Strips leading and trailing whitespace exactly like JavaScript's String.prototype.trim:
-- tab, LF, VT, FF, CR, space, NBSP, U+1680, U+2000-U+200A, U+2028, U+2029, U+202F, U+205F,
-- U+3000 and the BOM U+FEFF. Server validation uses it so client and server agree on what an
-- empty name is (an NBSP-only name is empty in both). Inner whitespace is kept.
create function internal.trim_ws(input text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select pg_catalog.btrim(
    input,
    E'\t\n\u000B\f\r \u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF'
  )
$$;

-- Trigger: keeps updated_at current on every update, whatever the statement set it to.
create function internal.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type identity.onboarding_path as enum ('owner', 'finder');
create type registry.species as enum ('dog', 'cat');
create type registry.registration_state as enum ('private', 'archived');
create type registry.photo_view as enum ('front', 'side', 'markings', 'extra');
create type registry.photo_status as enum ('pending', 'ready', 'rejected');
create type entitlements.tier as enum ('free', 'pro', 'max');

-- ---------------------------------------------------------------------------
-- identity
-- ---------------------------------------------------------------------------
create table identity.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  -- Empty until the user enters a name (email sign-ups have none). api.update_profile enforces
  -- 1-40 characters after trimming; the table only caps the length.
  display_name text not null default ''
    constraint profiles_display_name_length check (char_length(display_name) <= 40),
  onboarding_path identity.onboarding_path,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Invited pilot testers. Read only by the before-user-created auth hook; no client access.
create table identity.pilot_allowlist (
  email extensions.citext primary key,
  invited_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- registry
-- ---------------------------------------------------------------------------
create table registry.pets (
  id uuid primary key, -- client-generated, so a retried create is idempotent
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null
    constraint pets_name_length check (char_length(name) between 1 and 40),
  species registry.species not null,
  -- An empty breed is stored as null.
  breed text constraint pets_breed_length check (char_length(breed) between 1 and 80),
  age_months integer constraint pets_age_months_range check (age_months between 0 and 360),
  registration_state registry.registration_state not null default 'private',
  discovery_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Target of pet_photos' (pet_id, owner_id) foreign key.
  constraint pets_id_owner_id_key unique (id, owner_id)
);

create index pets_owner_id_created_at_idx on registry.pets (owner_id, created_at);

create trigger pets_set_updated_at
before update on registry.pets
for each row execute function internal.set_updated_at();

create table registry.pet_photos (
  id uuid primary key, -- client-generated
  pet_id uuid not null,
  owner_id uuid not null,
  view registry.photo_view not null,
  storage_path text not null unique, -- {owner_id}/{pet_id}/{id}.jpg in the pet-photos bucket
  width integer constraint pet_photos_width_positive check (width > 0),
  height integer constraint pet_photos_height_positive check (height > 0),
  bytes integer not null
    constraint pet_photos_bytes_range check (bytes between 1 and 4194304),
  blur_score real,
  brightness real,
  status registry.photo_status not null default 'pending',
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  -- A photo always belongs to its pet's owner, so the owner_id policy can never expose a photo
  -- to anyone but the pet's owner.
  constraint pet_photos_pet_owner_fkey foreign key (pet_id, owner_id)
    references registry.pets (id, owner_id) on delete cascade,
  constraint pet_photos_ready_is_confirmed check (
    status <> 'ready' or (confirmed_at is not null and width is not null and height is not null)
  )
);

-- At most one ready photo per required view (front, side, markings). A photo that replaces
-- another must remove the old row first.
create unique index pet_photos_one_ready_per_required_view
  on registry.pet_photos (pet_id, view)
  where status = 'ready' and view <> 'extra';
create index pet_photos_pet_id_owner_id_idx on registry.pet_photos (pet_id, owner_id);
create index pet_photos_owner_id_idx on registry.pet_photos (owner_id);

-- Storage objects waiting to be removed by the cleanup job. No client access.
create table registry.storage_deletions (
  id bigserial primary key,
  storage_path text not null,
  requested_at timestamptz not null default now(),
  attempts integer not null default 0 constraint storage_deletions_attempts_nonnegative
    check (attempts >= 0),
  last_error text
);

-- ---------------------------------------------------------------------------
-- entitlements
-- ---------------------------------------------------------------------------
create table entitlements.accounts (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  tier entitlements.tier not null default 'free',
  updated_at timestamptz not null default now()
);

create trigger accounts_set_updated_at
before update on entitlements.accounts
for each row execute function internal.set_updated_at();

-- Most private pets a tier may own, or null when unlimited. The numbers come from the
-- generated registry.limits(), which mirrors petLimit() in packages/core. A tier without a
-- configured limit raises instead of silently meaning "unlimited". Stable, not immutable,
-- because an enum's text form (tier::text) is only stable.
create function entitlements.pet_limit(tier entitlements.tier)
returns integer
language plpgsql
stable
parallel safe
set search_path = ''
as $$
declare
  tier_limits constant jsonb := registry.limits() -> 'tierLimits';
begin
  if tier is null or not tier_limits ? tier::text then
    raise exception 'entitlements.pet_limit: no pet limit for tier %', coalesce(tier::text, 'null')
      using errcode = 'invalid_parameter_value';
  end if;
  return (tier_limits ->> tier::text)::integer;
end
$$;

-- ---------------------------------------------------------------------------
-- audit
-- ---------------------------------------------------------------------------
-- Append-only. No client role may update or delete. metadata never holds names, emails,
-- coordinates or storage paths.
create table audit.events (
  id bigserial primary key,
  -- No foreign key: the log outlives deleted users. Null for system events.
  actor_id uuid,
  action text not null,
  subject_type text not null,
  subject_id uuid,
  metadata jsonb not null default '{}'
    constraint events_metadata_is_object check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index events_actor_id_created_at_idx on audit.events (actor_id, created_at);

-- ---------------------------------------------------------------------------
-- New auth users get a profile and a free account
-- ---------------------------------------------------------------------------
-- Runs as the function owner because Supabase Auth (supabase_auth_admin) inserts auth.users
-- and has no rights on these schemas. The display name comes from the provider metadata:
-- given_name, else full_name, else '' (trimmed, at most displayNameMax code points).
create function identity.on_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  name_max constant integer := (registry.limits() ->> 'displayNameMax')::integer;
  meta constant jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into identity.profiles (id, display_name)
  values (
    new.id,
    internal.trim_ws(pg_catalog.left(coalesce(
      nullif(internal.trim_ws(meta ->> 'given_name'), ''),
      nullif(internal.trim_ws(meta ->> 'full_name'), ''),
      ''
    ), name_max))
  );
  insert into entitlements.accounts (owner_id) values (new.id);
  return new;
end
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function identity.on_auth_user_created();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Postgres lets PUBLIC execute every new function. Nothing here is for clients: api.*
-- security-definer functions call these as their owner.
revoke execute on function
  internal.fail(text, text),
  internal.trim_ws(text),
  internal.set_updated_at(),
  identity.on_auth_user_created(),
  entitlements.pet_limit(entitlements.tier),
  registry.limits()
from public;

-- api holds client-callable functions; each one grants execute explicitly.
grant usage on schema api to authenticated, service_role;

-- Owners read their own rows (row-level security filters them). No write grants, ever.
grant usage on schema identity, registry, entitlements, audit to authenticated;
grant select on
  identity.profiles,
  registry.pets,
  registry.pet_photos,
  entitlements.accounts,
  audit.events
to authenticated;
