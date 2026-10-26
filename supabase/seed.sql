-- Local development and test data, loaded by `supabase db reset` after the migrations.

-- Pilot allowlist: the accounts the app and the end-to-end tests sign in with locally.
insert into identity.pilot_allowlist (email)
values ('owner@meoofy.test'), ('e2e@meoofy.test')
on conflict do nothing;
