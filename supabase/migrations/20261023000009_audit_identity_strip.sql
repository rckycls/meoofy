-- Deleting a user strips their identity from the audit trail (spec §10: "The audit trail keeps
-- only the action and the time"; Ruling 24).
--
-- audit.events has no foreign key to auth.users, so its rows outlive the user. Without this
-- trigger they would still carry the deleted user's id as actor_id (everything they did) and as
-- subject_id (events about their profile). The trigger runs on every deletion of an auth user,
-- whatever path deleted it: the delete-account Edge Function (auth.admin.deleteUser, run by
-- Supabase Auth as supabase_auth_admin), the dashboard, or plain SQL. Each event keeps its action,
-- subject type, metadata and time; only the user's id is set to null.
--
-- audit.events stays append-only for everyone else: clients have no update or delete privilege
-- on it (see 20261023000001_schema.sql), and this function is the only place that rewrites rows.

-- Finds the events about a deleted user without scanning the whole log (actor_id already has
-- events_actor_id_created_at_idx).
create index events_subject_id_idx on audit.events (subject_id);

-- Security definer: Supabase Auth deletes users as supabase_auth_admin, which has no rights on
-- audit.events. The empty search_path means every name is schema-qualified.
create function audit.strip_user_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update audit.events e set actor_id = null where e.actor_id = old.id;
  update audit.events e set subject_id = null where e.subject_id = old.id;
  return null;
end
$$;

create trigger on_auth_user_deleted
after delete on auth.users
for each row execute function audit.strip_user_identity();

-- Postgres lets PUBLIC execute every new function. Only the trigger runs this one.
revoke all on function audit.strip_user_identity() from public, anon, authenticated;
