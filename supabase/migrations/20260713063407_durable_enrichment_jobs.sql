alter table public.curation_jobs
  add column trigger text not null default 'admin',
  add column parent_job_id uuid references public.curation_jobs(id) on delete set null,
  add column attempt smallint not null default 1,
  add column scheduled_for timestamptz,
  add column run_after timestamptz not null default now(),
  add column dedupe_key text,
  add column heartbeat_at timestamptz,
  add column worker_token uuid,
  add column job_error text,
  add column current_target_id uuid,
  add column current_phase text,
  add column target_total integer not null default 0,
  add column succeeded_count integer not null default 0,
  add column skipped_count integer not null default 0,
  add column failed_count integer not null default 0;

alter table public.curation_jobs
  add constraint curation_jobs_trigger_check
    check (trigger in ('admin', 'cron', 'automatic_retry', 'manual_rerun')),
  add constraint curation_jobs_attempt_check
    check (attempt between 1 and 2),
  add constraint curation_jobs_counts_check
    check (
      target_total >= 0
      and succeeded_count >= 0
      and skipped_count >= 0
      and failed_count >= 0
    ),
  add constraint curation_jobs_automatic_retry_check
    check (
      trigger <> 'automatic_retry'
      or (parent_job_id is not null and attempt = 2)
    ),
  add constraint curation_jobs_dedupe_key_key unique (dedupe_key);

create table public.curation_job_targets (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.curation_jobs(id) on delete cascade,
  target_type text not null check (target_type in ('submission', 'brand')),
  target_id uuid not null,
  brand_name text not null,
  brand_slug text,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'succeeded', 'skipped', 'failed')),
  current_phase text,
  phase_results jsonb not null default '[]'::jsonb
    check (jsonb_typeof(phase_results) = 'array'),
  changed_fields text[] not null default '{}',
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  created_at timestamptz not null default now(),
  unique (job_id, target_type, target_id)
);

create index curation_jobs_pending_due_idx
  on public.curation_jobs (run_after, created_at)
  where status = 'pending';

create index curation_jobs_running_heartbeat_idx
  on public.curation_jobs (heartbeat_at)
  where status = 'running';

create index curation_jobs_parent_idx
  on public.curation_jobs (parent_job_id, created_at desc)
  where parent_job_id is not null;

create unique index curation_jobs_one_automatic_retry_idx
  on public.curation_jobs (parent_job_id)
  where trigger = 'automatic_retry';

create index curation_job_targets_job_status_idx
  on public.curation_job_targets (job_id, status, created_at);

create index curation_job_targets_target_history_idx
  on public.curation_job_targets (target_type, target_id, created_at desc);

alter table public.curation_job_targets enable row level security;

drop policy if exists service_role_select_curation_jobs on public.curation_jobs;
drop policy if exists service_role_insert_curation_jobs on public.curation_jobs;
drop policy if exists service_role_update_curation_jobs on public.curation_jobs;
drop policy if exists service_role_delete_curation_jobs on public.curation_jobs;

create policy service_role_select_curation_jobs
  on public.curation_jobs for select to service_role using (true);
create policy service_role_insert_curation_jobs
  on public.curation_jobs for insert to service_role with check (true);
create policy service_role_update_curation_jobs
  on public.curation_jobs for update to service_role using (true) with check (true);
create policy service_role_delete_curation_jobs
  on public.curation_jobs for delete to service_role using (true);

create policy service_role_select_curation_job_targets
  on public.curation_job_targets for select to service_role using (true);
create policy service_role_insert_curation_job_targets
  on public.curation_job_targets for insert to service_role with check (true);
create policy service_role_update_curation_job_targets
  on public.curation_job_targets for update to service_role using (true) with check (true);
create policy service_role_delete_curation_job_targets
  on public.curation_job_targets for delete to service_role using (true);

revoke all on public.curation_jobs from anon, authenticated;
revoke all on public.curation_job_targets from anon, authenticated;
grant select, insert, update, delete on public.curation_jobs to service_role;
grant select, insert, update, delete on public.curation_job_targets to service_role;

create or replace function public.enqueue_curation_job(
  p_operation text,
  p_params jsonb,
  p_dry_run boolean,
  p_started_by text,
  p_trigger text,
  p_parent_job_id uuid,
  p_attempt smallint,
  p_scheduled_for timestamptz,
  p_run_after timestamptz,
  p_dedupe_key text,
  p_targets jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_job_id uuid;
begin
  insert into public.curation_jobs (
    operation,
    params,
    dry_run,
    status,
    started_by,
    trigger,
    parent_job_id,
    attempt,
    scheduled_for,
    run_after,
    dedupe_key,
    target_total
  )
  values (
    p_operation,
    coalesce(p_params, '{}'::jsonb),
    p_dry_run,
    'pending',
    p_started_by,
    p_trigger,
    p_parent_job_id,
    p_attempt,
    p_scheduled_for,
    coalesce(p_run_after, now()),
    p_dedupe_key,
    jsonb_array_length(coalesce(p_targets, '[]'::jsonb))
  )
  on conflict do nothing
  returning id into v_job_id;

  if v_job_id is null then
    if p_dedupe_key is not null then
      select id into v_job_id
      from public.curation_jobs
      where dedupe_key = p_dedupe_key;
    elsif p_trigger = 'automatic_retry' and p_parent_job_id is not null then
      select id into v_job_id
      from public.curation_jobs
      where trigger = 'automatic_retry'
        and parent_job_id = p_parent_job_id;
    end if;

    if v_job_id is null then
      raise exception 'Unable to enqueue curation job';
    end if;

    return v_job_id;
  end if;

  insert into public.curation_job_targets (
    job_id,
    target_type,
    target_id,
    brand_name,
    brand_slug
  )
  select
    v_job_id,
    target.target_type,
    target.target_id,
    target.brand_name,
    target.brand_slug
  from jsonb_to_recordset(coalesce(p_targets, '[]'::jsonb)) as target(
    target_type text,
    target_id uuid,
    brand_name text,
    brand_slug text
  );

  return v_job_id;
end;
$$;

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
        job_error = null
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

create or replace function public.recover_stale_curation_jobs(p_stale_before timestamptz)
returns setof public.curation_jobs
language sql
security invoker
set search_path = public
as $$
  update public.curation_jobs
  set status = 'failed',
      completed_at = now(),
      heartbeat_at = now(),
      worker_token = null,
      current_target_id = null,
      current_phase = null,
      job_error = 'Job timed out after its worker heartbeat stopped',
      result = jsonb_build_object(
        'status', 'failed',
        'error', 'Job timed out after its worker heartbeat stopped'
      )
  where status = 'running'
    and coalesce(heartbeat_at, started_at, created_at) < p_stale_before
  returning *;
$$;

revoke all on function public.enqueue_curation_job(
  text, jsonb, boolean, text, text, uuid, smallint, timestamptz, timestamptz, text, jsonb
) from public, anon, authenticated;
revoke all on function public.claim_next_curation_job(uuid) from public, anon, authenticated;
revoke all on function public.recover_stale_curation_jobs(timestamptz) from public, anon, authenticated;

grant execute on function public.enqueue_curation_job(
  text, jsonb, boolean, text, text, uuid, smallint, timestamptz, timestamptz, text, jsonb
) to service_role;
grant execute on function public.claim_next_curation_job(uuid) to service_role;
grant execute on function public.recover_stale_curation_jobs(timestamptz) to service_role;
