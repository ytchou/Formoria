alter table public.curation_jobs
  add column dispatch_status text not null default 'pending',
  add column dispatch_error text,
  add column dispatched_at timestamptz;

alter table public.curation_jobs
  add constraint curation_jobs_dispatch_status_check
    check (dispatch_status in ('pending', 'dispatched', 'failed'));

create index curation_jobs_dispatch_attention_idx
  on public.curation_jobs (dispatch_status, created_at desc)
  where status = 'pending' and dispatch_status = 'failed';

create or replace function public.claim_next_curation_job(p_worker_token uuid)
returns setof public.curation_jobs
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not pg_try_advisory_xact_lock(hashtextextended('curation_jobs_single_runner', 0)) then
    return;
  end if;

  return query
  with next_job as (
    select id
    from public.curation_jobs
    where status = 'pending'
      and trigger in ('cron', 'automatic_retry')
      and dispatch_status <> 'failed'
      and run_after <= now()
    order by run_after, created_at
    limit 1
    for update skip locked
  ), claimed_job as (
    update public.curation_jobs as job
    set status = 'running',
        worker_token = p_worker_token,
        started_at = coalesce(job.started_at, now()),
        completed_at = null,
        heartbeat_at = now(),
        job_error = null,
        dispatch_status = 'dispatched',
        dispatch_error = null,
        dispatched_at = coalesce(job.dispatched_at, now())
    where job.id = (select id from next_job)
      and not exists (
        select 1
        from public.curation_jobs running_job
        where running_job.status = 'running'
      )
    returning job.*
  ), started_targets as (
    update public.curation_job_targets
    set started_at = coalesce(started_at, now())
    where job_id = (select id from claimed_job)
    returning id
  )
  select claimed_job.*
  from claimed_job;
end;
$$;

create or replace function public.claim_curation_job(
  p_job_id uuid,
  p_worker_token uuid
)
returns setof public.curation_jobs
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not pg_try_advisory_xact_lock(hashtextextended('curation_jobs_single_runner', 0)) then
    return;
  end if;

  return query
  with requested_job as (
    select id
    from public.curation_jobs
    where id = p_job_id
      and status = 'pending'
      and dispatch_status <> 'failed'
      and run_after <= now()
    limit 1
    for update skip locked
  ), claimed_job as (
    update public.curation_jobs as job
    set status = 'running',
        worker_token = p_worker_token,
        started_at = coalesce(job.started_at, now()),
        completed_at = null,
        heartbeat_at = now(),
        job_error = null,
        dispatch_status = 'dispatched',
        dispatch_error = null,
        dispatched_at = coalesce(job.dispatched_at, now())
    where job.id = (select id from requested_job)
      and not exists (
        select 1
        from public.curation_jobs running_job
        where running_job.status = 'running'
      )
    returning job.*
  ), started_targets as (
    update public.curation_job_targets
    set started_at = coalesce(started_at, now())
    where job_id = (select id from claimed_job)
    returning id
  )
  select claimed_job.*
  from claimed_job;
end;
$$;

revoke all on function public.claim_curation_job(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_curation_job(uuid, uuid) to service_role;
