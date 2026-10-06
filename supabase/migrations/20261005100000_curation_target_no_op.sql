-- DEV-1929: a rerun that ran nothing and wrote nothing must not hide an
-- earlier succeeded enrichment run from the apply and approve gates.
--
-- A rerun whose phases are all satisfied from history records its target as
-- `skipped` ("no new enrichment fields"). Both gates read only the LATEST
-- `curation_job_targets` row and require `succeeded`, so that empty row hid
-- the earlier `succeeded` row and the apply failed.
--
-- `skipped` also carries negative editorial verdicts (not a brand, listing
-- rejected, no purchase channel), so the gates cannot ignore `skipped` rows.
-- The runner instead marks an empty run explicitly with `no_op = true` (zero
-- owned checkpoints AND every phase result `skipped`). Its status stays
-- `skipped`, so the job counters stay accurate. Existing rows keep the
-- default `false`: no backfill.
--
-- `apply_brand_refresh_with_protected_location_gate` and `approve_submission`
-- have no source file in this repo. They are patched from their LIVE
-- definitions, and each anchor must occur exactly once, so a drifted
-- definition fails loudly. CREATE OR REPLACE only (no DROP), so the ACLs
-- survive. The md5 pins of both functions change: re-pin them in the contract
-- baseline after the apply (`scripts/verify-contract-fingerprints.ts`).
--
-- Rollback: supabase/migrations/reverse/20261005100000_revert_curation_target_no_op.sql

begin;

create or replace function pg_temp.patch_once(
  v_body text,
  v_old text,
  v_new text,
  v_label text
) returns text
language plpgsql
as $patch_once$
declare
  v_count integer;
begin
  if v_body is null then
    raise exception '%: function definition is missing', v_label;
  end if;

  v_count := (length(v_body) - length(replace(v_body, v_old, ''))) / length(v_old);
  if v_count <> 1 then
    raise exception '%: expected one anchor, found %', v_label, v_count;
  end if;

  return replace(v_body, v_old, v_new);
end
$patch_once$;

alter table public.curation_job_targets
  add column if not exists no_op boolean not null default false;

comment on column public.curation_job_targets.no_op is
  'True when the run for this target executed nothing and wrote nothing: zero owned checkpoints and every phase result skipped (DEV-1929). The apply and approve gates ignore these rows when they select the latest enrichment run.';

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  -- Progress RPC: persist the `no_op` key of each update element. A missing
  -- key keeps the stored value, so callers that never send it are unchanged.
  select pg_get_functiondef(
    'public.persist_curation_job_target_progress(uuid,uuid,jsonb,uuid,text)'::regprocedure
  ) into v_definition;

  v_updated := pg_temp.patch_once(
    v_definition,
    $old$changed_fields text[], error text, completed_at timestamptz, duration_ms integer
    )$old$,
    $new$changed_fields text[], error text, completed_at timestamptz, duration_ms integer,
      no_op boolean
    )$new$,
    'persist_curation_job_target_progress recordset columns'
  );
  v_updated := pg_temp.patch_once(
    v_updated,
    $old$      duration_ms = coalesce(progress_update.duration_ms, target.duration_ms)
  from progress_update$old$,
    $new$      duration_ms = coalesce(progress_update.duration_ms, target.duration_ms),
      no_op = coalesce(progress_update.no_op, target.no_op)
  from progress_update$new$,
    'persist_curation_job_target_progress set list'
  );
  execute v_updated;

  -- Refresh apply gate.
  select pg_get_functiondef(
    'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure
  ) into v_definition;

  v_updated := pg_temp.patch_once(
    v_definition,
    $old$    and target.target_id = p_submission_id
  order by target.created_at desc, target.id desc
  limit 1;
  if v_latest_target_status is distinct from 'succeeded' then
    raise exception 'Refresh must have a successful enrichment run before apply';$old$,
    $new$    and target.target_id = p_submission_id
    and not target.no_op
  order by target.created_at desc, target.id desc
  limit 1;
  if v_latest_target_status is distinct from 'succeeded' then
    raise exception 'Refresh must have a successful enrichment run before apply';$new$,
    'apply_brand_refresh_with_protected_location_gate latest target'
  );
  execute v_updated;

  -- New-submission approve gate.
  select pg_get_functiondef(
    'public.approve_submission(uuid,uuid,jsonb)'::regprocedure
  ) into v_definition;

  v_updated := pg_temp.patch_once(
    v_definition,
    $old$    and target.target_id = p_submission_id
  order by target.created_at desc, target.id desc
  limit 1;

  if v_latest_target_status is distinct from 'succeeded' then
    raise exception 'Submission must have a successful enrichment run before approval';$old$,
    $new$    and target.target_id = p_submission_id
    and not target.no_op
  order by target.created_at desc, target.id desc
  limit 1;

  if v_latest_target_status is distinct from 'succeeded' then
    raise exception 'Submission must have a successful enrichment run before approval';$new$,
    'approve_submission latest target'
  );
  execute v_updated;
end
$migration$;

do $postcondition$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.persist_curation_job_target_progress(uuid,uuid,jsonb,uuid,text)'::regprocedure
  ) into v_definition;
  if position('no_op = coalesce(progress_update.no_op, target.no_op)' in v_definition) = 0 then
    raise exception 'persist_curation_job_target_progress postcondition failed: no_op is not persisted';
  end if;

  select pg_get_functiondef(
    'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure
  ) into v_definition;
  if position('and not target.no_op' in v_definition) = 0 then
    raise exception 'apply_brand_refresh_with_protected_location_gate postcondition failed: no_op filter missing';
  end if;

  select pg_get_functiondef(
    'public.approve_submission(uuid,uuid,jsonb)'::regprocedure
  ) into v_definition;
  if position('and not target.no_op' in v_definition) = 0 then
    raise exception 'approve_submission postcondition failed: no_op filter missing';
  end if;
end
$postcondition$;

drop function pg_temp.patch_once(text, text, text, text);

commit;
