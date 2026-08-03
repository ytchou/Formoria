begin;

-- Permanently remove only submissions that are still waiting for their first
-- usable curation result.  Curation targets deliberately have no foreign key
-- to submissions, so their rows remain as the operational audit trail after
-- the submission and its submission-owned records are deleted.
create or replace function public.drop_needs_data_submissions(
  p_submission_ids uuid[]
)
returns text[]
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_submission public.brand_submissions%rowtype;
  v_target_status text;
  v_job_status text;
  v_dispatch_status text;
  v_stage text;
  v_storage_paths text[];
  v_locked_count integer := 0;
begin
  if p_submission_ids is null
    or cardinality(p_submission_ids) is null
    or cardinality(p_submission_ids) = 0
    or cardinality(p_submission_ids) > 100
    or exists (
      select 1
      from unnest(p_submission_ids) as selected(id)
      where selected.id is null
    )
    or (
      select count(*)
      from unnest(p_submission_ids) as selected(id)
    ) <> (
      select count(distinct selected.id)
      from unnest(p_submission_ids) as selected(id)
    )
  then
    raise exception 'Invalid submission selection'
      using errcode = '22023';
  end if;

  -- Lock every selected row in a stable order before deriving its stage.  The
  -- count is checked after locking so a concurrent delete cannot turn a
  -- partial request into a successful one.
  for v_submission in
    select submission.*
    from public.brand_submissions as submission
    where submission.id = any(p_submission_ids)
    order by submission.id
    for update
  loop
    v_locked_count := v_locked_count + 1;

    select target.status, job.status, job.dispatch_status
    into v_target_status, v_job_status, v_dispatch_status
    from public.curation_job_targets as target
    left join public.curation_jobs as job on job.id = target.job_id
    where target.target_type = 'submission'
      and target.target_id = v_submission.id
    order by target.created_at desc, target.id desc
    limit 1;

    v_stage := case
      when v_submission.status in ('approved', 'rejected')
        then v_submission.status
      when v_job_status in ('pending', 'running')
        and v_dispatch_status is distinct from 'failed'
        and v_target_status in ('pending', 'running')
        then 'enriching'
      when v_target_status = 'succeeded' then 'ready'
      when v_target_status = 'skipped' then 'skipped'
      else 'needs_data'
    end;

    if v_stage <> 'needs_data' then
      raise exception 'Only submissions in Needs Data can be dropped'
        using errcode = 'P0001';
    end if;
  end loop;

  if v_locked_count <> cardinality(p_submission_ids) then
    raise exception 'Submission not found'
      using errcode = 'P0002';
  end if;

  -- Return only paths owned by the selected submission.  Refresh references
  -- to published brand images have no storage path; the prefix guard also
  -- prevents a malformed row from deleting another resource's object.
  select coalesce(
    array_agg(image.storage_path order by image.submission_id, image.created_at, image.id)
      filter (
        where image.storage_path is not null
          and image.storage_path like 'submissions/' || image.submission_id::text || '/%'
      ),
    '{}'::text[]
  )
  into v_storage_paths
  from public.submission_images as image
  where image.submission_id = any(p_submission_ids);

  delete from public.brand_submissions
  where id = any(p_submission_ids);

  if not found then
    raise exception 'Submission not found'
      using errcode = 'P0002';
  end if;

  return v_storage_paths;
end;
$$;

-- Curation workers update their history tables independently from the
-- submission row.  These narrowly scoped fences make those writes use the
-- same submission-row lock as the drop RPC, so a stage-changing write either
-- commits before the drop validates or waits until after the row is gone.
create or replace function public.lock_submission_rows_for_curation_target()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_submission_ids uuid[] := '{}'::uuid[];
  v_submission_id uuid;
  v_requires_existing_submission boolean;
begin
  if tg_op = 'UPDATE' or tg_op = 'DELETE' then
    if old.target_type = 'submission' then
      v_submission_ids := array_append(v_submission_ids, old.target_id);
    end if;
  end if;
  if tg_op = 'INSERT' or tg_op = 'UPDATE' then
    if new.target_type = 'submission' then
      v_submission_ids := array_append(v_submission_ids, new.target_id);
    end if;
  end if;

  for v_submission_id in
    select distinct selected.id
    from unnest(v_submission_ids) as selected(id)
    where selected.id is not null
    order by selected.id
  loop
    v_requires_existing_submission :=
      tg_op = 'INSERT'
      or (
        tg_op = 'UPDATE'
        and new.target_type = 'submission'
      );

    perform 1
    from public.brand_submissions
    where id = v_submission_id
    for update;

    if v_requires_existing_submission and not found then
      raise exception 'Submission not found'
        using errcode = 'P0002';
    end if;
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.lock_submission_rows_for_curation_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
  v_submission_ids uuid[];
  v_submission_id uuid;
begin
  if tg_op = 'DELETE' then
    v_job_id := old.id;
  else
    v_job_id := new.id;
  end if;

  select coalesce(
    array_agg(target.target_id order by target.target_id),
    '{}'::uuid[]
  )
  into v_submission_ids
  from public.curation_job_targets as target
  where target.job_id = v_job_id
    and target.target_type = 'submission';

  for v_submission_id in
    select distinct selected.id
    from unnest(v_submission_ids) as selected(id)
    where selected.id is not null
    order by selected.id
  loop
    perform 1
    from public.brand_submissions
    where id = v_submission_id
    for update;
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists lock_submission_rows_for_curation_target
  on public.curation_job_targets;
create trigger lock_submission_rows_for_curation_target
before insert or update or delete on public.curation_job_targets
for each row execute function public.lock_submission_rows_for_curation_target();

drop trigger if exists lock_submission_rows_for_curation_job
  on public.curation_jobs;
create trigger lock_submission_rows_for_curation_job
before update of status, dispatch_status or delete on public.curation_jobs
for each row execute function public.lock_submission_rows_for_curation_job();

revoke all on function public.drop_needs_data_submissions(uuid[])
  from public, anon, authenticated;
grant execute on function public.drop_needs_data_submissions(uuid[])
  to service_role;

revoke all on function public.lock_submission_rows_for_curation_target()
  from public, anon, authenticated;
grant execute on function public.lock_submission_rows_for_curation_target()
  to service_role;

revoke all on function public.lock_submission_rows_for_curation_job()
  from public, anon, authenticated;
grant execute on function public.lock_submission_rows_for_curation_job()
  to service_role;

commit;
