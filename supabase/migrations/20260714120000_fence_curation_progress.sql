create or replace function public.persist_curation_job_target_progress(
  p_job_id uuid,
  p_worker_token uuid,
  p_updates jsonb,
  p_current_target_id uuid default null,
  p_current_phase text default null
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_job_id uuid;
begin
  select id
    into v_job_id
  from public.curation_jobs
  where id = p_job_id
    and status = 'running'
    and worker_token = p_worker_token
  for update;

  if not found then
    return false;
  end if;

  with progress_update as (
    select *
    from jsonb_to_recordset(coalesce(p_updates, '[]'::jsonb)) as update_row(
      target_id uuid,
      status text,
      current_phase text,
      phase_results jsonb,
      changed_fields text[],
      error text,
      completed_at timestamptz,
      duration_ms integer
    )
  )
  update public.curation_job_targets as target
  set status = progress_update.status,
      current_phase = progress_update.current_phase,
      phase_results = coalesce(progress_update.phase_results, target.phase_results),
      changed_fields = coalesce(progress_update.changed_fields, target.changed_fields),
      error = coalesce(progress_update.error, target.error),
      started_at = coalesce(target.started_at, now()),
      completed_at = coalesce(progress_update.completed_at, target.completed_at),
      duration_ms = coalesce(progress_update.duration_ms, target.duration_ms)
  from progress_update
  where target.job_id = p_job_id
    and target.target_id = progress_update.target_id;

  with target_counts as (
    select
      count(*)::integer as target_total,
      count(*) filter (where status = 'succeeded')::integer as succeeded_count,
      count(*) filter (where status = 'skipped')::integer as skipped_count,
      count(*) filter (where status = 'failed')::integer as failed_count
    from public.curation_job_targets
    where job_id = p_job_id
  )
  update public.curation_jobs as job
  set heartbeat_at = now(),
      current_target_id = p_current_target_id,
      current_phase = p_current_phase,
      target_total = target_counts.target_total,
      succeeded_count = target_counts.succeeded_count,
      skipped_count = target_counts.skipped_count,
      failed_count = target_counts.failed_count,
      progress = jsonb_build_object(
        'processed', target_counts.succeeded_count
          + target_counts.skipped_count
          + target_counts.failed_count,
        'total', target_counts.target_total,
        'succeeded', target_counts.succeeded_count,
        'skipped', target_counts.skipped_count,
        'failed', target_counts.failed_count
      )
  from target_counts
  where job.id = v_job_id;

  return true;
end;
$$;

create or replace function public.mark_unreported_curation_job_targets_skipped(
  p_job_id uuid,
  p_worker_token uuid
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_job_id uuid;
begin
  select id
    into v_job_id
  from public.curation_jobs
  where id = p_job_id
    and status = 'running'
    and worker_token = p_worker_token
  for update;

  if not found then
    return false;
  end if;

  update public.curation_job_targets
  set status = 'skipped',
      current_phase = null,
      error = 'Target is no longer pending or requires no enrichment',
      started_at = coalesce(started_at, now()),
      completed_at = now()
  where job_id = p_job_id
    and status in ('pending', 'running');

  with target_counts as (
    select
      count(*)::integer as target_total,
      count(*) filter (where status = 'succeeded')::integer as succeeded_count,
      count(*) filter (where status = 'skipped')::integer as skipped_count,
      count(*) filter (where status = 'failed')::integer as failed_count
    from public.curation_job_targets
    where job_id = p_job_id
  )
  update public.curation_jobs as job
  set heartbeat_at = now(),
      current_target_id = null,
      current_phase = null,
      target_total = target_counts.target_total,
      succeeded_count = target_counts.succeeded_count,
      skipped_count = target_counts.skipped_count,
      failed_count = target_counts.failed_count,
      progress = jsonb_build_object(
        'processed', target_counts.succeeded_count
          + target_counts.skipped_count
          + target_counts.failed_count,
        'total', target_counts.target_total,
        'succeeded', target_counts.succeeded_count,
        'skipped', target_counts.skipped_count,
        'failed', target_counts.failed_count
      )
  from target_counts
  where job.id = v_job_id;

  return true;
end;
$$;

revoke all on function public.persist_curation_job_target_progress(
  uuid, uuid, jsonb, uuid, text
) from public, anon, authenticated;
revoke all on function public.mark_unreported_curation_job_targets_skipped(
  uuid, uuid
) from public, anon, authenticated;

grant execute on function public.persist_curation_job_target_progress(
  uuid, uuid, jsonb, uuid, text
) to service_role;
grant execute on function public.mark_unreported_curation_job_targets_skipped(
  uuid, uuid
) to service_role;
