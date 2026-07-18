alter table public.curation_jobs
  add column cancelled_count integer not null default 0;

alter table public.curation_jobs
  drop constraint curation_jobs_counts_check,
  add constraint curation_jobs_counts_check check (
    target_total >= 0
    and succeeded_count >= 0
    and skipped_count >= 0
    and failed_count >= 0
    and cancelled_count >= 0
  );

alter table public.curation_job_targets
  drop constraint curation_job_targets_status_check,
  add constraint curation_job_targets_status_check
    check (status in ('pending', 'running', 'succeeded', 'skipped', 'failed', 'cancelled'));

create index curation_jobs_created_id_idx
  on public.curation_jobs (created_at desc, id desc);

drop index if exists public.curation_jobs_dispatch_attention_idx;

update public.curation_jobs
set status = 'failed',
    completed_at = coalesce(completed_at, now()),
    job_error = coalesce(job_error, dispatch_error, 'Dispatch failed'),
    result = jsonb_build_object('status', 'failed', 'reason', 'dispatch_failed')
where status = 'pending'
  and dispatch_status = 'failed';

update public.curation_jobs
set status = 'cancelled',
    job_error = 'Job timed out after its worker heartbeat stopped',
    result = jsonb_build_object(
      'status', 'cancelled',
      'reason', 'Job timed out after its worker heartbeat stopped'
    )
where status = 'failed'
  and job_error = 'Job timed out after its worker heartbeat stopped';

update public.curation_job_targets as target
set status = 'cancelled',
    current_phase = null,
    error = coalesce(target.error, job.job_error, 'Job cancelled'),
    started_at = coalesce(target.started_at, job.started_at, job.created_at),
    completed_at = coalesce(target.completed_at, job.completed_at, now())
from public.curation_jobs as job
where target.job_id = job.id
  and job.status = 'cancelled'
  and target.status in ('pending', 'running');

with counts as (
  select
    job_id,
    count(*)::integer as target_total,
    count(*) filter (where status = 'succeeded')::integer as succeeded_count,
    count(*) filter (where status = 'skipped')::integer as skipped_count,
    count(*) filter (where status = 'failed')::integer as failed_count,
    count(*) filter (where status = 'cancelled')::integer as cancelled_count
  from public.curation_job_targets
  group by job_id
)
update public.curation_jobs as job
set target_total = counts.target_total,
    succeeded_count = counts.succeeded_count,
    skipped_count = counts.skipped_count,
    failed_count = counts.failed_count,
    cancelled_count = counts.cancelled_count,
    progress = jsonb_build_object(
      'processed', counts.succeeded_count + counts.skipped_count + counts.failed_count + counts.cancelled_count,
      'total', counts.target_total,
      'succeeded', counts.succeeded_count,
      'skipped', counts.skipped_count,
      'failed', counts.failed_count,
      'cancelled', counts.cancelled_count
    )
from counts
where job.id = counts.job_id;

create or replace function public.cancel_curation_job(
  p_job_id uuid,
  p_reason text
)
returns setof public.curation_jobs
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job_id uuid;
begin
  select id into v_job_id
  from public.curation_jobs
  where id = p_job_id
    and status in ('pending', 'running')
  for update;

  if not found then
    return;
  end if;

  update public.curation_job_targets
  set status = 'cancelled',
      current_phase = null,
      error = coalesce(error, p_reason),
      started_at = coalesce(started_at, now()),
      completed_at = now()
  where job_id = v_job_id
    and status in ('pending', 'running');

  return query
  with counts as (
    select
      count(*)::integer as target_total,
      count(*) filter (where status = 'succeeded')::integer as succeeded_count,
      count(*) filter (where status = 'skipped')::integer as skipped_count,
      count(*) filter (where status = 'failed')::integer as failed_count,
      count(*) filter (where status = 'cancelled')::integer as cancelled_count
    from public.curation_job_targets
    where job_id = v_job_id
  )
  update public.curation_jobs as job
  set status = 'cancelled',
      completed_at = now(),
      heartbeat_at = now(),
      worker_token = null,
      current_target_id = null,
      current_phase = null,
      job_error = p_reason,
      target_total = counts.target_total,
      succeeded_count = counts.succeeded_count,
      skipped_count = counts.skipped_count,
      failed_count = counts.failed_count,
      cancelled_count = counts.cancelled_count,
      progress = jsonb_build_object(
        'processed', counts.succeeded_count + counts.skipped_count + counts.failed_count + counts.cancelled_count,
        'total', counts.target_total,
        'succeeded', counts.succeeded_count,
        'skipped', counts.skipped_count,
        'failed', counts.failed_count,
        'cancelled', counts.cancelled_count
      ),
      result = jsonb_build_object('status', 'cancelled', 'reason', p_reason)
  from counts
  where job.id = v_job_id
  returning job.*;
end;
$$;

create or replace function public.recover_stale_curation_jobs(p_stale_before timestamptz)
returns setof public.curation_jobs
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job_id uuid;
begin
  for v_job_id in
    select id
    from public.curation_jobs
    where status = 'running'
      and coalesce(heartbeat_at, started_at, created_at) < p_stale_before
    order by created_at, id
  loop
    return query
    select * from public.cancel_curation_job(
      v_job_id,
      'Job timed out after its worker heartbeat stopped'
    );
  end loop;
end;
$$;

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
set search_path = ''
as $$
declare
  v_job_id uuid;
begin
  select id into v_job_id
  from public.curation_jobs
  where id = p_job_id and status = 'running' and worker_token = p_worker_token
  for update;
  if not found then return false; end if;

  with progress_update as (
    select * from jsonb_to_recordset(coalesce(p_updates, '[]'::jsonb)) as update_row(
      target_id uuid, status text, current_phase text, phase_results jsonb,
      changed_fields text[], error text, completed_at timestamptz, duration_ms integer
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
  where target.job_id = p_job_id and target.target_id = progress_update.target_id;

  with counts as (
    select count(*)::integer as target_total,
      count(*) filter (where status = 'succeeded')::integer as succeeded_count,
      count(*) filter (where status = 'skipped')::integer as skipped_count,
      count(*) filter (where status = 'failed')::integer as failed_count,
      count(*) filter (where status = 'cancelled')::integer as cancelled_count
    from public.curation_job_targets where job_id = p_job_id
  )
  update public.curation_jobs as job
  set heartbeat_at = now(), current_target_id = p_current_target_id, current_phase = p_current_phase,
      target_total = counts.target_total, succeeded_count = counts.succeeded_count,
      skipped_count = counts.skipped_count, failed_count = counts.failed_count,
      cancelled_count = counts.cancelled_count,
      progress = jsonb_build_object(
        'processed', counts.succeeded_count + counts.skipped_count + counts.failed_count + counts.cancelled_count,
        'total', counts.target_total, 'succeeded', counts.succeeded_count,
        'skipped', counts.skipped_count, 'failed', counts.failed_count,
        'cancelled', counts.cancelled_count
      )
  from counts where job.id = v_job_id;
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
set search_path = ''
as $$
declare
  v_job_id uuid;
begin
  select id into v_job_id
  from public.curation_jobs
  where id = p_job_id and status = 'running' and worker_token = p_worker_token
  for update;
  if not found then return false; end if;

  update public.curation_job_targets
  set status = 'skipped', current_phase = null,
      error = 'Target is no longer pending or requires no enrichment',
      started_at = coalesce(started_at, now()), completed_at = now()
  where job_id = p_job_id and status in ('pending', 'running');

  with counts as (
    select count(*)::integer as target_total,
      count(*) filter (where status = 'succeeded')::integer as succeeded_count,
      count(*) filter (where status = 'skipped')::integer as skipped_count,
      count(*) filter (where status = 'failed')::integer as failed_count,
      count(*) filter (where status = 'cancelled')::integer as cancelled_count
    from public.curation_job_targets where job_id = p_job_id
  )
  update public.curation_jobs as job
  set heartbeat_at = now(), current_target_id = null, current_phase = null,
      target_total = counts.target_total, succeeded_count = counts.succeeded_count,
      skipped_count = counts.skipped_count, failed_count = counts.failed_count,
      cancelled_count = counts.cancelled_count,
      progress = jsonb_build_object(
        'processed', counts.succeeded_count + counts.skipped_count + counts.failed_count + counts.cancelled_count,
        'total', counts.target_total, 'succeeded', counts.succeeded_count,
        'skipped', counts.skipped_count, 'failed', counts.failed_count,
        'cancelled', counts.cancelled_count
      )
  from counts where job.id = v_job_id;
  return true;
end;
$$;

create or replace function public.apply_submission_enrichment_result(
  p_submission_id uuid,
  p_enriched_data jsonb,
  p_job_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1 from public.curation_jobs
  where id = p_job_id and status = 'running'
  for share;
  if not found then return false; end if;

  update public.brand_submissions
  set enriched_data = p_enriched_data
  where id = p_submission_id and status = 'pending';
  return found;
end;
$$;

create or replace function public.apply_brand_patch(
  p_brand_id uuid,
  p_patch jsonb,
  p_source text,
  p_actor uuid,
  p_job_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  patch_entry record;
  v_old_value jsonb;
  v_old_slug text;
  v_new_slug text;
begin
  if p_source = 'enriched' and p_job_id is not null then
    perform 1 from public.curation_jobs
    where id = p_job_id and status = 'running'
    for share;
    if not found then
      raise exception 'Curation job is no longer running' using errcode = '55000';
    end if;
  end if;

  select slug into v_old_slug
  from public.brands where id = p_brand_id for update;
  if not found then raise exception 'Brand not found' using errcode = 'P0002'; end if;

  for patch_entry in select key, value from jsonb_each(p_patch)
  loop
    execute format('select to_jsonb(%I) from public.brands where id = $1', patch_entry.key)
      into v_old_value using p_brand_id;
    execute format(
      'update public.brands set %1$I = (jsonb_populate_record(null::public.brands, jsonb_build_object($1, $2))).%1$I where id = $3',
      patch_entry.key
    ) using patch_entry.key, patch_entry.value, p_brand_id;
    insert into public.brand_field_state (brand_id, field, source, updated_by, updated_at)
    values (p_brand_id, patch_entry.key, p_source, p_actor, now())
    on conflict (brand_id, field) do update
      set source = excluded.source, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
    insert into public.brand_field_events (brand_id, field, old_value, new_value, source, actor, job_id)
    values (p_brand_id, patch_entry.key, v_old_value, patch_entry.value, p_source, p_actor, p_job_id);
  end loop;

  select slug into v_new_slug from public.brands where id = p_brand_id;
  if v_new_slug is distinct from v_old_slug then
    insert into public.brand_slug_redirects (old_slug, new_slug)
    values (v_old_slug, v_new_slug)
    on conflict (old_slug) do update set new_slug = excluded.new_slug;
  end if;
end;
$$;

drop policy if exists "Service role full access on newsletter_subscribers"
  on public.newsletter_subscribers;
drop policy if exists service_role_all_newsletter_subscribers
  on public.newsletter_subscribers;
create policy service_role_all_newsletter_subscribers
  on public.newsletter_subscribers for all to service_role
  using (true) with check (true);

revoke all on public.newsletter_subscribers from anon, authenticated;
grant select, update on public.newsletter_subscribers to service_role;

create index newsletter_subscribers_status_created_idx
  on public.newsletter_subscribers (subscribed_at desc, id desc);
create index newsletter_subscribers_interests_idx
  on public.newsletter_subscribers using gin (interests);
create extension if not exists pg_trgm with schema extensions;
create index newsletter_subscribers_email_trgm_idx
  on public.newsletter_subscribers using gin (email extensions.gin_trgm_ops);
create index newsletter_subscribers_name_trgm_idx
  on public.newsletter_subscribers using gin (name extensions.gin_trgm_ops);

create or replace function public.admin_list_newsletter_subscribers(
  p_query text default null,
  p_status text default null,
  p_interest text default null,
  p_cursor_at timestamptz default null,
  p_cursor_id uuid default null,
  p_direction text default 'next',
  p_limit integer default 50
)
returns table (
  id uuid, email text, name text, interests text[], locale text,
  subscribed_at timestamptz, confirmed_at timestamptz, unsubscribed_at timestamptz,
  consent_source text, consent_version text, consent_recorded_at timestamptz,
  subscriber_status text, total_count bigint
)
language sql
security invoker
set search_path = ''
as $$
  with filtered as (
    select subscriber.*,
      case
        when subscriber.unsubscribed_at is not null then 'unsubscribed'
        when subscriber.confirmed_at is not null then 'active'
        else 'pending'
      end as subscriber_status
    from public.newsletter_subscribers as subscriber
    where (p_query is null or p_query = '' or subscriber.email ilike '%' || p_query || '%' or coalesce(subscriber.name, '') ilike '%' || p_query || '%')
      and (p_interest is null or p_interest = any(subscriber.interests))
  ), matched as (
    select filtered.*, count(*) over () as total_count
    from filtered
    where (p_status is null or p_status = subscriber_status)
      and (
        p_cursor_at is null
        or (p_direction = 'previous' and (subscribed_at, id) > (p_cursor_at, p_cursor_id))
        or (p_direction <> 'previous' and (subscribed_at, id) < (p_cursor_at, p_cursor_id))
      )
    order by
      case when p_direction = 'previous' then subscribed_at end asc,
      case when p_direction = 'previous' then id end asc,
      case when p_direction <> 'previous' then subscribed_at end desc,
      case when p_direction <> 'previous' then id end desc
    limit least(greatest(p_limit, 1), 101)
  )
  select id, email, name, interests, locale, subscribed_at, confirmed_at,
    unsubscribed_at, consent_source, consent_version, consent_recorded_at,
    subscriber_status, total_count
  from matched;
$$;

create or replace function public.admin_export_newsletter_subscribers(
  p_query text default null,
  p_status text default null,
  p_interest text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(result) order by result.subscribed_at desc, result.id desc), '[]'::jsonb)
  from public.admin_list_newsletter_subscribers(
    p_query, p_status, p_interest, null, null, 'next', 1000000
  ) as result;
$$;

revoke execute on function public.cancel_curation_job(uuid, text) from public, anon, authenticated;
revoke execute on function public.recover_stale_curation_jobs(timestamptz) from public, anon, authenticated;
revoke execute on function public.persist_curation_job_target_progress(uuid, uuid, jsonb, uuid, text) from public, anon, authenticated;
revoke execute on function public.mark_unreported_curation_job_targets_skipped(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.apply_submission_enrichment_result(uuid, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.apply_brand_patch(uuid, jsonb, text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.admin_list_newsletter_subscribers(text, text, text, timestamptz, uuid, text, integer) from public, anon, authenticated;
revoke execute on function public.admin_export_newsletter_subscribers(text, text, text) from public, anon, authenticated;

grant execute on function public.cancel_curation_job(uuid, text) to service_role;
grant execute on function public.recover_stale_curation_jobs(timestamptz) to service_role;
grant execute on function public.persist_curation_job_target_progress(uuid, uuid, jsonb, uuid, text) to service_role;
grant execute on function public.mark_unreported_curation_job_targets_skipped(uuid, uuid) to service_role;
grant execute on function public.apply_submission_enrichment_result(uuid, jsonb, uuid) to service_role;
grant execute on function public.apply_brand_patch(uuid, jsonb, text, uuid, uuid) to service_role;
grant execute on function public.admin_list_newsletter_subscribers(text, text, text, timestamptz, uuid, text, integer) to service_role;
grant execute on function public.admin_export_newsletter_subscribers(text, text, text) to service_role;
