-- Reverts 20261005100000_curation_target_no_op.sql
-- Removes the `no_op` filter from both enrichment gates and the `no_op` write
-- from the progress RPC, then drops curation_job_targets.no_op (DEV-1929).
-- A no-op rerun hides an earlier succeeded run from the gates again.

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

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'public.persist_curation_job_target_progress(uuid,uuid,jsonb,uuid,text)'::regprocedure
  ) into v_definition;
  v_updated := pg_temp.patch_once(
    v_definition,
    $old$changed_fields text[], error text, completed_at timestamptz, duration_ms integer,
      no_op boolean
    )$old$,
    $new$changed_fields text[], error text, completed_at timestamptz, duration_ms integer
    )$new$,
    'persist_curation_job_target_progress recordset columns'
  );
  v_updated := pg_temp.patch_once(
    v_updated,
    $old$      duration_ms = coalesce(progress_update.duration_ms, target.duration_ms),
      no_op = coalesce(progress_update.no_op, target.no_op)
  from progress_update$old$,
    $new$      duration_ms = coalesce(progress_update.duration_ms, target.duration_ms)
  from progress_update$new$,
    'persist_curation_job_target_progress set list'
  );
  execute v_updated;

  select pg_get_functiondef(
    'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure
  ) into v_definition;
  v_updated := pg_temp.patch_once(
    v_definition,
    $old$    and target.target_id = p_submission_id
    and not target.no_op
  order by target.created_at desc, target.id desc$old$,
    $new$    and target.target_id = p_submission_id
  order by target.created_at desc, target.id desc$new$,
    'apply_brand_refresh_with_protected_location_gate latest target'
  );
  execute v_updated;

  select pg_get_functiondef(
    'public.approve_submission(uuid,uuid,jsonb)'::regprocedure
  ) into v_definition;
  v_updated := pg_temp.patch_once(
    v_definition,
    $old$    and target.target_id = p_submission_id
    and not target.no_op
  order by target.created_at desc, target.id desc$old$,
    $new$    and target.target_id = p_submission_id
  order by target.created_at desc, target.id desc$new$,
    'approve_submission latest target'
  );
  execute v_updated;
end
$migration$;

alter table public.curation_job_targets drop column if exists no_op;

drop function pg_temp.patch_once(text, text, text, text);

commit;
