create temporary table recovery_assertions(submission_id uuid, checkpoint_id uuid) on commit drop;

do $$
declare
  v_submission uuid := gen_random_uuid();
  v_job uuid := gen_random_uuid();
  v_source uuid := gen_random_uuid();
  v_checkpoint uuid := gen_random_uuid();
  v_rejected boolean := false;
begin
  insert into public.brand_submissions(id, brand_name, submitter_email, status, intent)
  values(v_submission, '[E2E-TEST] Recovery 林木工坊', 'recovery+maria@test.example', 'pending', 'recommend');
  insert into public.curation_jobs(id, operation, started_by, status, dry_run, run_after)
  values(v_source, 'enrich', 'e2e-recovery-transaction', 'failed', false, '2099-01-01');
  insert into public.curation_jobs(id, operation, started_by, status, dry_run, params, run_after, parent_job_id)
  values(v_job, 'enrich', 'e2e-recovery-transaction', 'running', false,
    jsonb_build_object('retry', jsonb_build_object('version', 1, 'targets',
      jsonb_build_object(v_submission::text, jsonb_build_object('selected', jsonb_build_array('faq'))))),
    '2099-01-01', v_source);
  insert into public.curation_job_targets(job_id, target_id, target_type, brand_name, status)
  values(v_job, v_submission, 'submission', '[E2E-TEST] Recovery 林木工坊', 'running');
  insert into public.curation_phase_outputs(id, job_id, target_id, target_type, phase, status, output)
  values(v_checkpoint, v_source, v_submission, 'submission', 'faq', 'succeeded', '{"patch":{"faq":[]}}');

  -- Legacy callers still write without acknowledging an unconsumed checkpoint.
  if not public.apply_submission_enrichment_result(v_submission, '{"description":"legacy"}', v_job) then
    raise exception 'Legacy RPC rejected a running job';
  end if;
  if exists(select 1 from public.curation_phase_outputs where id = v_checkpoint and persisted_at is not null) then
    raise exception 'Legacy RPC acknowledged an unrelated checkpoint';
  end if;

  -- Missing IDs reject the complete write, even if another ID is valid.
  begin
    perform public.apply_submission_enrichment_result(v_submission, '{"description":"invalid"}', v_job,
      array[v_checkpoint, gen_random_uuid()]);
  exception when others then
    if sqlerrm not like '%Missing or duplicate%' then raise; end if;
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'Missing checkpoint accepted'; end if;
  if (select enriched_data ->> 'description' from public.brand_submissions where id = v_submission) <> 'legacy'
    or exists(select 1 from public.curation_phase_outputs where id = v_checkpoint and persisted_at is not null)
  then raise exception 'Rejected write changed submission or checkpoint'; end if;

  update public.curation_jobs set status = 'cancelled' where id = v_job;
  if public.apply_submission_enrichment_result(v_submission, '{"description":"cancelled"}', v_job, array[v_checkpoint]) then
    raise exception 'Cancelled job wrote enrichment';
  end if;
  update public.curation_jobs set status = 'running' where id = v_job;
  update public.brand_submissions set status = 'rejected' where id = v_submission;
  if public.apply_submission_enrichment_result(v_submission, '{"description":"rejected"}', v_job, array[v_checkpoint]) then
    raise exception 'Non-pending submission accepted enrichment';
  end if;
  if exists(select 1 from public.curation_phase_outputs where id = v_checkpoint and persisted_at is not null) then
    raise exception 'Cancellation or non-pending guard acknowledged a checkpoint';
  end if;
  update public.brand_submissions set status = 'pending' where id = v_submission;

  -- A preview checkpoint cannot populate a normal recovery run.
  update public.curation_jobs set dry_run = true where id = v_source;
  v_rejected := false;
  begin
    perform public.apply_submission_enrichment_result(v_submission, '{"description":"preview"}', v_job, array[v_checkpoint]);
  exception when others then
    if sqlerrm not like '%Ineligible enrichment checkpoint%' then raise; end if;
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'Preview checkpoint accepted'; end if;
  update public.curation_jobs set dry_run = false where id = v_source;

  -- Even a successful checkpoint is ineligible when it belongs to another target.
  update public.curation_phase_outputs set target_id = gen_random_uuid() where id = v_checkpoint;
  v_rejected := false;
  begin
    perform public.apply_submission_enrichment_result(v_submission, '{"description":"wrong-target"}', v_job, array[v_checkpoint]);
  exception when others then
    if sqlerrm not like '%Ineligible enrichment checkpoint%' then raise; end if;
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'Another target checkpoint accepted'; end if;
  update public.curation_phase_outputs set target_id = v_submission where id = v_checkpoint;

  -- A scope mismatch cannot consume a valid checkpoint from another phase.
  update public.curation_phase_outputs set phase = 'products' where id = v_checkpoint;
  v_rejected := false;
  begin
    perform public.apply_submission_enrichment_result(v_submission, '{"description":"wrong-scope"}', v_job, array[v_checkpoint]);
  exception when others then
    if sqlerrm not like '%outside selected recovery scope%' then raise; end if;
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'Unselected phase accepted'; end if;
  update public.curation_phase_outputs set phase = 'faq' where id = v_checkpoint;

  -- An enclosing transaction rollback restores both sides of the commit.
  begin
    perform public.apply_submission_enrichment_result(v_submission, '{"description":"rolled-back"}', v_job, array[v_checkpoint]);
    raise exception 'intentional transaction rollback';
  exception when raise_exception then
    if sqlerrm <> 'intentional transaction rollback' then raise; end if;
  end;
  if (select enriched_data ->> 'description' from public.brand_submissions where id = v_submission) <> 'legacy'
    or exists(select 1 from public.curation_phase_outputs where id = v_checkpoint and persisted_at is not null)
  then raise exception 'Transaction rollback did not restore submission and checkpoint'; end if;

  if not public.apply_submission_enrichment_result(v_submission, '{"description":"committed"}', v_job, array[v_checkpoint]) then
    raise exception 'Valid checkpoint commit rejected';
  end if;
  if (select enriched_data ->> 'description' from public.brand_submissions where id = v_submission) <> 'committed'
    or not exists(select 1 from public.curation_phase_outputs where id = v_checkpoint and persisted_at is not null)
  then raise exception 'Submission and checkpoint did not commit together'; end if;
  insert into recovery_assertions values(v_submission, v_checkpoint);
end;
$$;

select json_build_object('description', s.enriched_data ->> 'description', 'checkpointConsumed', o.persisted_at is not null)
from recovery_assertions a
join public.brand_submissions s on s.id = a.submission_id
join public.curation_phase_outputs o on o.id = a.checkpoint_id;
