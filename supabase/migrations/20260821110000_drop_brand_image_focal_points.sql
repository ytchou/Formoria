-- Drop brand-image focal points (DEV-1521).
--
-- DEV-1406 added `focal_x` / `focal_y` to `brand_images` and
-- `submission_images` (20260808160000) so a renderer could emit
-- `object-position` and follow a subject that centre-cropping cuts out of
-- frame. The write path never ran. Every focal value is NULL: 0 of 10,498 rows
-- in production, and 0 of 1,425 `brand_images` rows with `submission_images`
-- empty when read from staging on 2026-08-20. The columns are a schema surface
-- with no state behind them, so this removes them rather than extending them.
--
-- NO BACKFILL AND NO REVERSE SCRIPT, deliberately. A reverse migration would
-- re-add two nullable columns and two CHECK constraints and restore exactly
-- nothing, because there is nothing to restore. 20260808160000 already is the
-- whole of the rollback, and it is already written.
--
-- ORDERING IS LOAD-BEARING, AND IT IS THE ONLY RISK IN THIS FILE.
-- `approve_submission` and `apply_brand_refresh_with_protected_location_gate`
-- are hand-patched: neither has a canonical source file in this repo, and both
-- name `focal_x` / `focal_y` in an `insert into public.brand_images` column
-- list and in the `select` list feeding it. The refresh gate names them a third
-- time, in its `on conflict do update set`. Drop the columns before those
-- bodies are rewritten and every submission approval raises 42703 for the
-- window between the two statements. Functions first, columns second, one
-- transaction, so a failure in either half rolls back both.
--
-- The ordering that spans artifacts matters just as much, and this file cannot
-- enforce it: apply this migration only once the code that stopped selecting
-- `focal_x` / `focal_y` is live in the target environment. Against an
-- environment still running older code, PostgREST answers 42703 on the brand
-- image read, and `getBrandImages` rethrows anything that is not PGRST205
-- (src/lib/services/brand-images.ts), so `/brands/[slug]` and every microsite
-- return 500 rather than degrade. 20260808160000:62-69 wrote its own deploy
-- window down for the same reason, in the opposite direction.
--
-- FINGERPRINT PROVENANCE. Both md5s below were OBSERVED, not derived. Read
-- read-only from staging on 2026-08-20, with the full chain through
-- 20260821100000 applied and this branch's own migration not applied:
--
--   psql "$SUPABASE_DB_URL" -At -c "
--     select md5(pg_get_functiondef(
--       'public.approve_submission(uuid,uuid,jsonb)'::regprocedure));"
--   -- 4d107ce1c764e920c0a601379cae1da8
--
--   psql "$SUPABASE_DB_URL" -At -c "
--     select md5(pg_get_functiondef(
--       'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'
--       ::regprocedure));"
--   -- 401a5c499848fc3c2d0e1571db269e72
--
-- The same read confirmed each of the five anchors below occurs exactly once in
-- its own body, and that nothing else in the database mentions `focal`: no
-- index, no view, no materialized view, no RLS policy, and no third function.
-- The two CHECK constraints dropped at the tail are the only other dependents,
-- and they are named explicitly rather than left to the implicit drop that
-- `drop column` would perform, so the intent stays checkable.
--
-- BOTH FINGERPRINTS ARE STAGING-ONLY. They were never observed on production.
-- Run the two `select md5(pg_get_functiondef(...))` commands above against
-- PRODUCTION before the production apply, and reconcile any difference first: a
-- one-byte divergence aborts the assert, rolls the whole transaction back, and
-- strands the fleet staging-migrated and production-not.
--
-- RECOGNISING AN ALREADY-APPLIED RE-RUN. A second run of this file aborts at
-- the same fingerprint assert, with `DEV-1503 function fingerprint drift...` —
-- indistinguishable from the genuine hand-patch drift these two functions are
-- known for. If that assert fires, check whether the migration already
-- succeeded BEFORE treating it as drift: `select focal_x from
-- public.brand_images limit 1` raising 42703 means it did, and there is nothing
-- to repair. There is deliberately NO already-applied skip guard here (its
-- predecessor 20260808160000 had one). This migration is one-shot and
-- destructive, so a loud abort is the intended outcome and the operator
-- disambiguates by hand.
--
-- THE READ-BACKS ARE NOT REDUNDANT. Each rewrite is assembled as text and then
-- `execute`d; Postgres regenerates the definition from the catalog, so
-- re-reading `pg_get_functiondef` AFTER the `execute` is the only step that
-- proves what landed rather than what was assembled. Both read-backs raise
-- P0001 on any surviving `focal`, and both run before any column is dropped.

begin;

-- Re-created here: every migration that defines these two helpers drops them at
-- its own tail, and the last one to do so was 20260821100000. A migration that
-- called them without re-creating them would fail on an undefined function.
create or replace function public.dev1503_contract_assert_function(
  p_signature regprocedure,
  p_expected_md5 text
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_definition text;
begin
  v_definition := pg_get_functiondef(p_signature);
  if md5(v_definition) is distinct from p_expected_md5 then
    raise exception
      'DEV-1503 function fingerprint drift for %: expected %, got %',
      p_signature, p_expected_md5, md5(v_definition)
      using errcode = 'P0001';
  end if;
end;
$function$;

create or replace function public.dev1503_contract_replace_exact(
  p_definition text,
  p_legacy text,
  p_final text,
  p_expected_count integer
)
returns text
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_count integer;
begin
  v_count :=
    (length(p_definition) - length(replace(p_definition, p_legacy, '')))
    / nullif(length(p_legacy), 0);
  if v_count is distinct from p_expected_count then
    raise exception
      'DEV-1503 replacement drift for % -> %: expected %, got %',
      p_legacy, p_final, p_expected_count, v_count
      using errcode = 'P0001';
  end if;
  return replace(p_definition, p_legacy, p_final);
end;
$function$;

do $migration$
declare
  v_approve text;
  v_approve_live text;
  v_refresh text;
  v_refresh_live text;
begin
  -- Both fingerprints are asserted before either body is touched, so a drifted
  -- refresh gate aborts the run before `approve_submission` is rewritten.
  perform public.dev1503_contract_assert_function(
    'public.approve_submission(uuid,uuid,jsonb)'::regprocedure,
    '4d107ce1c764e920c0a601379cae1da8'
  );
  perform public.dev1503_contract_assert_function(
    'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure,
    '401a5c499848fc3c2d0e1571db269e72'
  );

  ---------------------------------------------------------------------------
  -- 1/2  approve_submission(uuid,uuid,jsonb)
  --
  -- Two anchors, both inside the same `insert into public.brand_images ...
  -- select` that copies an approved submission's images across. Each anchor
  -- carries its own leading and trailing newline, which pins it to whole lines
  -- and is what makes `entropy, focal_x, focal_y, created_at` unambiguous
  -- against the refresh gate's differently-wrapped copy of the same list.
  -- Longest anchor first, each at an expected count of 1.
  ---------------------------------------------------------------------------
  v_approve := pg_get_functiondef(
    'public.approve_submission(uuid,uuid,jsonb)'::regprocedure
  );

  -- The select list. 20 expressions become 18, matching the column list below.
  v_approve := public.dev1503_contract_replace_exact(
    v_approve,
$legacy$
    image.phash, image.sharpness, image.entropy, image.focal_x,
    image.focal_y, image.created_at
$legacy$,
$final$
    image.phash, image.sharpness, image.entropy, image.created_at
$final$,
    1
  );

  -- The insert column list. `created_at` stays last, so no trailing comma is
  -- exposed by removing the two names ahead of it.
  v_approve := public.dev1503_contract_replace_exact(
    v_approve,
$legacy$
    sharpness, entropy, focal_x, focal_y, created_at
$legacy$,
$final$
    sharpness, entropy, created_at
$final$,
    1
  );

  execute v_approve;

  -- Read the LIVE body back from the catalog, not the variable that was just
  -- executed. This is the assertion that the columns are safe to drop.
  v_approve_live := pg_get_functiondef(
    'public.approve_submission(uuid,uuid,jsonb)'::regprocedure
  );
  if position('focal' in v_approve_live) > 0 then
    raise exception
      'DEV-1521 approve_submission still references focal after rewrite; columns not dropped'
      using errcode = 'P0001';
  end if;

  ---------------------------------------------------------------------------
  -- 2/2  apply_brand_refresh_with_protected_location_gate(uuid,uuid)
  --
  -- Three anchors: the same insert/select pair as above, plus the
  -- `on conflict (brand_id, source_url) do update set` assignment list. That
  -- third one ends the whole statement, so its replacement must carry the
  -- terminating `;` forward onto `entropy = excluded.entropy`.
  ---------------------------------------------------------------------------
  v_refresh := pg_get_functiondef(
    'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure
  );

  -- The select list. Byte-identical to approve_submission's, but read from a
  -- different body, so it is asserted separately at count 1.
  v_refresh := public.dev1503_contract_replace_exact(
    v_refresh,
$legacy$
    image.phash, image.sharpness, image.entropy, image.focal_x,
    image.focal_y, image.created_at
$legacy$,
$final$
    image.phash, image.sharpness, image.entropy, image.created_at
$final$,
    1
  );

  -- The upsert assignment list, and the end of the statement.
  v_refresh := public.dev1503_contract_replace_exact(
    v_refresh,
$legacy$
    entropy = excluded.entropy, focal_x = excluded.focal_x,
    focal_y = excluded.focal_y;
$legacy$,
$final$
    entropy = excluded.entropy;
$final$,
    1
  );

  -- The insert column list. Wrapped one column earlier than
  -- approve_submission's, hence the shorter anchor.
  v_refresh := public.dev1503_contract_replace_exact(
    v_refresh,
$legacy$
    entropy, focal_x, focal_y, created_at
$legacy$,
$final$
    entropy, created_at
$final$,
    1
  );

  execute v_refresh;

  v_refresh_live := pg_get_functiondef(
    'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure
  );
  if position('focal' in v_refresh_live) > 0 then
    raise exception
      'DEV-1521 apply_brand_refresh_with_protected_location_gate still references focal after rewrite; columns not dropped'
      using errcode = 'P0001';
  end if;
end
$migration$;

-- Only now, with both live bodies proven clean, does the schema change. These
-- are unguarded on purpose: inside a single transaction, a missing constraint
-- or column means the migration has already run or the schema is not what this
-- file was written against, and both deserve a loud abort over a silent no-op.
alter table public.brand_images
  drop constraint brand_images_focal_range;

alter table public.submission_images
  drop constraint submission_images_focal_range;

alter table public.brand_images
  drop column focal_x,
  drop column focal_y;

alter table public.submission_images
  drop column focal_x,
  drop column focal_y;

drop function public.dev1503_contract_assert_function(regprocedure, text);
drop function public.dev1503_contract_replace_exact(text, text, text, integer);

commit;
