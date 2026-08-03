begin;

-- Refresh field protection narrows to `source = 'owner'`. `admin_locked` stops
-- being read anywhere; `admin` and `submitted` become descriptive labels with no
-- blocking effect.
--
-- Why: the protected set was never what it claimed to be.
--
--   * `admin` is mostly synthetic. The provenance reclassification in
--     20260720140736 re-derived every pre-existing row by matching the brand's
--     current value against its latest approved submission, with `else 'admin'`
--     as the catch-all. Brands with no submission fell straight through it. One
--     statement stamped 4,150 rows across 307 brands, and 298 of those brands
--     have no approved non-refresh submission at all. Every one carries
--     `updated_by = null` — no human was ever involved.
--   * `submitted` marks the pipeline's gaps, not verified data. It lands on a
--     field only when enrichment produced nothing for it and the reviewer did
--     not edit it. Approval is a whole-listing publish decision plus structural
--     completeness checks, never a per-field fact check, and the submitter is
--     typically anonymous. These are the weakest-provenance values in the
--     system and the ones a refresh is most likely to improve.
--   * `admin_locked` is dead: false on all 10,803 rows, with no writer anywhere
--     in the application.
--
-- Distribution at time of writing: enriched 4,604 / admin 4,506 /
-- submitted 1,690 / owner 3. So this unprotects 6,196 rows and keeps 3.
--
-- Overwrites remain recoverable: `brand_field_events` captures `old_value` on
-- every write path and has no retention or pruning job.
--
-- The `admin_locked` COLUMN is deliberately kept. Nothing reads it after this
-- migration, but preserving it makes a revert a one-line predicate change
-- rather than a data migration.
--
-- These bodies are edited in place via pg_get_functiondef + replace + execute,
-- matching the established pattern for these functions (20260728071406,
-- 20260730120000, 20260730150000, 20260730153000, 20260801150000,
-- 20260801160000, 20260802090000). Reconstructing them as literal
-- `create or replace` blocks would risk silently reverting that chain, and
-- would also drop the `SET lock_timeout` attribute that 20260730030000 attached
-- via ALTER — pg_get_functiondef re-emits it for free.
do $migration$
declare
  v_definition text;
  v_anchor text;
  v_count integer;
begin
  -- 1. The main gate. Two arms guard the same field allow-list: one over
  -- `enriched_data` keys, one over `_cleared_fields` (added by 20260802090000).
  -- Both must change, or half the guard stays live.
  select pg_get_functiondef(
    'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure
  ) into v_definition;

  v_anchor := $anchor$    where (state.admin_locked or state.source in ('owner', 'admin', 'submitted'))$anchor$;
  v_count := (length(v_definition) - length(replace(v_definition, v_anchor, ''))) / length(v_anchor);
  if v_count <> 2 then
    raise exception 'Expected two protection predicates in the refresh gate, found %', v_count;
  end if;
  v_definition := replace(
    v_definition,
    v_anchor,
    $new$    where state.source = 'owner'$new$
  );
  execute v_definition;

  -- 2. The wrapper temporarily downgrades a protected `retail_locations` row so
  -- the gate lets additive location writes through, then restores it. Narrow
  -- the predicate, and stop writing `admin_locked` on both legs so the column
  -- ends up untouched by code rather than written-then-restored.
  select pg_get_functiondef(
    'public.apply_brand_refresh(uuid,uuid)'::regprocedure
  ) into v_definition;

  v_anchor := $anchor$    and (state.admin_locked or state.source in ('owner', 'admin', 'submitted'))$anchor$;
  v_count := (length(v_definition) - length(replace(v_definition, v_anchor, ''))) / length(v_anchor);
  if v_count <> 1 then
    raise exception 'Expected one protection predicate in apply_brand_refresh, found %', v_count;
  end if;
  v_definition := replace(
    v_definition,
    v_anchor,
    $new$    and state.source = 'owner'$new$
  );

  v_anchor := $anchor$    set source = 'enriched', admin_locked = false$anchor$;
  v_count := (length(v_definition) - length(replace(v_definition, v_anchor, ''))) / length(v_anchor);
  if v_count <> 1 then
    raise exception 'Expected one location unlock in apply_brand_refresh, found %', v_count;
  end if;
  v_definition := replace(
    v_definition,
    v_anchor,
    $new$    set source = 'enriched'$new$
  );

  v_anchor := $anchor$        admin_locked = v_location_state.admin_locked,
$anchor$;
  v_count := (length(v_definition) - length(replace(v_definition, v_anchor, ''))) / length(v_anchor);
  if v_count <> 1 then
    raise exception 'Expected one location restore in apply_brand_refresh, found %', v_count;
  end if;
  v_definition := replace(v_definition, v_anchor, '');
  execute v_definition;

  -- 3. The submission trigger that auto-publishes verified location candidates.
  select pg_get_functiondef(
    'public.reparent_brand_location_candidates()'::regprocedure
  ) into v_definition;

  v_anchor := $anchor$          and (state.admin_locked or state.source in ('owner', 'admin', 'submitted'))$anchor$;
  v_count := (length(v_definition) - length(replace(v_definition, v_anchor, ''))) / length(v_anchor);
  if v_count <> 1 then
    raise exception 'Expected one protection predicate in reparent_brand_location_candidates, found %', v_count;
  end if;
  v_definition := replace(
    v_definition,
    v_anchor,
    $new$          and state.source = 'owner'$new$
  );
  execute v_definition;

  -- 4. The location-only path. Its admin-lock hard-fail is present in
  -- 20260723114341 but ABSENT from the deployed function — an out-of-band edit
  -- no migration records. So this arm is a no-op against production and a real
  -- removal on a clean replay; tolerating both is what converges the two.
  --
  -- It is removed rather than re-pointed at `source = 'owner'` because
  -- re-adding a guard here would make the location-only path stricter than the
  -- main path, which deliberately punches through location protection (see 2).
  -- Owner intent on locations is already protected structurally by this
  -- function's own 'Location enrichment cannot grant owner confirmation' check.
  select pg_get_functiondef(
    'public.apply_brand_refresh_locations(uuid[],uuid)'::regprocedure
  ) into v_definition;

  v_anchor := $anchor$    if exists (
      select 1 from public.brand_field_state
      where brand_id = v_brand.id
        and field = 'retail_locations'
        and admin_locked = true
    ) then
      raise exception 'Location refresh blocked: retail_locations is admin-locked';
    end if;

$anchor$;
  v_count := (length(v_definition) - length(replace(v_definition, v_anchor, ''))) / length(v_anchor);
  if v_count > 1 then
    raise exception 'Expected at most one admin-lock guard in apply_brand_refresh_locations, found %', v_count;
  end if;
  if v_count = 1 then
    v_definition := replace(v_definition, v_anchor, '');
    execute v_definition;
  end if;

  -- Post-condition: no function body may still read admin_locked.
  select count(*)
  into v_count
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and pg_get_functiondef(p.oid) like '%admin_locked%';
  if v_count <> 0 then
    raise exception '% function(s) still reference admin_locked', v_count;
  end if;
end
$migration$;

commit;
