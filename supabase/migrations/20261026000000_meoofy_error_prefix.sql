-- Update existing databases to the error prefix expected by the renamed client.
create or replace function internal.fail(code text, detail text default null)
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
