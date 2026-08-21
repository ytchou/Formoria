do $$
declare
  active_job record;
begin
  for active_job in select jobid from cron.job where active loop
    perform cron.alter_job(active_job.jobid, active := false);
  end loop;
end
$$;

do $$
begin
  if exists (select 1 from cron.job where active) then
    raise exception 'staging finalization failed: cron jobs remain active';
  end if;
end
$$;
