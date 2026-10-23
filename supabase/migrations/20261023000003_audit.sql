-- Audit log writers (spec §5, §6). audit.events is append-only: clients can read their own rows
-- and nothing else, and the only way to add one is through these two functions.
--
-- `metadata` must never hold names, emails, coordinates or storage paths. Callers pass ids,
-- counts and enum values only.

-- Records an event for the signed-in user (actor_id = auth.uid()). Called by the api.* functions,
-- which run as the function owner, never directly by a client. A caller without a subject claim
-- is refused instead of being logged as an anonymous actor: events without an actor belong to
-- audit.record_system.
create function audit.record(
  action text,
  subject_type text,
  subject_id uuid,
  metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor constant uuid := auth.uid();
begin
  if actor is null then
    perform internal.fail('UNAUTHENTICATED');
  end if;

  insert into audit.events (actor_id, action, subject_type, subject_id, metadata)
  values (
    actor,
    record.action,
    record.subject_type,
    record.subject_id,
    coalesce(record.metadata, '{}'::jsonb)
  );
end
$$;

-- Records an event with no actor, for work the server does on its own (account deletion, the
-- storage cleanup job). Only service_role may call it.
create function audit.record_system(
  action text,
  subject_type text,
  subject_id uuid default null,
  metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into audit.events (actor_id, action, subject_type, subject_id, metadata)
  values (
    null,
    record_system.action,
    record_system.subject_type,
    record_system.subject_id,
    coalesce(record_system.metadata, '{}'::jsonb)
  );
end
$$;

-- Postgres lets PUBLIC execute every new function, so take that away first. audit.record gets no
-- grant at all: the api.* functions reach it as their owner.
revoke execute on function
  audit.record(text, text, uuid, jsonb),
  audit.record_system(text, text, uuid, jsonb)
from public;

-- service_role needs the schema to resolve the function; it gets no table privileges.
grant usage on schema audit to service_role;
grant execute on function audit.record_system(text, text, uuid, jsonb) to service_role;
