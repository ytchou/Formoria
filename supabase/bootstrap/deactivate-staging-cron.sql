update cron.job set active = false where active;

do $$
begin
  if exists (select 1 from cron.job where active) then
    raise exception 'staging finalization failed: cron jobs remain active';
  end if;
end
$$;
