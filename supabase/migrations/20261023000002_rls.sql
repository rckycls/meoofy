-- Row-level security on every table (spec §6). Owners may select their own rows; there are no
-- insert, update or delete policies for any role. Tables without a policy (the pilot
-- allowlist, the storage deletion queue) are invisible to clients even if a grant slipped in.
-- `(select auth.uid())` is evaluated once per statement instead of once per row.

alter table identity.profiles enable row level security;
alter table identity.pilot_allowlist enable row level security;
alter table registry.pets enable row level security;
alter table registry.pet_photos enable row level security;
alter table registry.storage_deletions enable row level security;
alter table entitlements.accounts enable row level security;
alter table audit.events enable row level security;

create policy profiles_select_own on identity.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy pets_select_own on registry.pets
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy pet_photos_select_own on registry.pet_photos
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy accounts_select_own on entitlements.accounts
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy events_select_own on audit.events
  for select to authenticated
  using (actor_id = (select auth.uid()));
