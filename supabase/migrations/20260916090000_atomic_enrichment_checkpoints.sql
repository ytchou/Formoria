-- Keep the three-argument entry point for workers deployed before DEV-1731.
create or replace function public.apply_submission_enrichment_result(
  p_submission_id uuid,
  p_enriched_data jsonb,
  p_job_id uuid,
  p_checkpoint_ids uuid[]
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_params jsonb;
  v_dry_run boolean;
  v_checkpoint public.curation_phase_outputs%rowtype;
  v_count integer := 0;
  v_allowed_jobs uuid[];
  v_ids uuid[] := coalesce(p_checkpoint_ids, '{}'::uuid[]);
begin
  select params, dry_run into v_params, v_dry_run
  from public.curation_jobs
  where id = p_job_id and status = 'running'
  for share;
  if not found then return false; end if;

  if cardinality(v_ids) > 0 then
    if v_dry_run then
      raise exception 'Dry-run jobs cannot consume enrichment checkpoints';
    end if;
    perform 1 from public.curation_job_targets
    where job_id = p_job_id and target_id = p_submission_id
      and target_type = 'submission' and status in ('pending', 'running')
    for share;
    if not found then return false; end if;

    with recursive lineage as (
      select id, parent_job_id from public.curation_jobs where id = p_job_id
      union
      select parent.id, parent.parent_job_id
      from public.curation_jobs parent join lineage child on parent.id = child.parent_job_id
    ) select array_agg(id) into v_allowed_jobs from lineage;

    for v_checkpoint in
      select * from public.curation_phase_outputs
      where id = any(v_ids) order by id for update
    loop
      v_count := v_count + 1;
      if v_checkpoint.target_id <> p_submission_id
        or v_checkpoint.target_type <> 'submission'
        or not (v_checkpoint.job_id = any(v_allowed_jobs))
        or v_checkpoint.status <> 'succeeded'
        or v_checkpoint.persisted_at is not null
        or v_checkpoint.output is null
        or jsonb_typeof(v_checkpoint.output -> 'patch') is distinct from 'object'
        or exists (select 1 from public.curation_jobs where id = v_checkpoint.job_id and dry_run)
      then
        raise exception 'Ineligible enrichment checkpoint %', v_checkpoint.id;
      end if;
      if v_params #>> '{retry,version}' = '1' and not coalesce(
        (v_params #> array['retry', 'targets', p_submission_id::text, 'selected']) ? v_checkpoint.phase,
        false
      ) then
        raise exception 'Enrichment checkpoint phase is outside selected recovery scope';
      end if;
    end loop;
    if v_count <> cardinality(v_ids) then
      raise exception 'Missing or duplicate enrichment checkpoint IDs';
    end if;
  end if;

  update public.brand_submissions
  set enriched_data = p_enriched_data
  where id = p_submission_id and status = 'pending';
  if not found then return false; end if;

  update public.curation_phase_outputs set persisted_at = now()
  where id = any(v_ids);
  return true;
end;
$$;

create or replace function public.apply_submission_enrichment_result(
  p_submission_id uuid,
  p_enriched_data jsonb,
  p_job_id uuid
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select public.apply_submission_enrichment_result(
    p_submission_id, p_enriched_data, p_job_id, '{}'::uuid[]
  );
$$;

revoke execute on function public.apply_submission_enrichment_result(uuid, jsonb, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.apply_submission_enrichment_result(uuid, jsonb, uuid, uuid[])
  to service_role;
