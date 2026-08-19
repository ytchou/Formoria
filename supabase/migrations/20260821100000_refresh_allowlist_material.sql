-- Refresh allow-lists: admit `material`, and record why `products` stays out
-- (DEV-1469).
--
-- `apply_brand_refresh_with_protected_location_gate(uuid,uuid)` filters
-- `enriched_data` and `review_overrides` through FIVE field allow-lists. Read
-- live from staging today, they are:
--
--   1/5  owner-protection check over enriched_data          (raise on conflict)
--   2/5  owner-protection check over _cleared_fields        (raise on conflict)
--   3/5  the enrichment patch                               (writes brands.<col>)
--   4/5  the admin override patch (also carries 'name')     (writes brands.<col>)
--   5/5  the cleared-fields patch                           (writes NULL)
--
-- DEV-1510 rewrote the element blocks — `product_type` / `product_tags` /
-- `product_tags_en` are gone and `subcategories` / `subcategories_en` stand in
-- their place — but the COUNT is unchanged and so is the shape: five lists, one
-- identical element block each, distinguished only by the `into v_*_patch`,
-- `entry.key` and `cleared.field` lines above them. Those lines are the anchors
-- used below, and each occurs exactly once in the live body.
--
-- DEV-1502 shipped `brands.material` without touching any of the five, so a
-- material value on a submission is filtered out and silently lost at every
-- refresh. This migration adds `'material'` to 1-4.
--
-- LIST 5 IS DELIBERATELY EXCLUDED, and this is not an oversight. The
-- cleared-fields patch is built as `jsonb_object_agg(f.field, 'null'::jsonb)`,
-- so the only value it can express is JSON null; the apply loop then runs
-- `update public.brands set material = (jsonb_populate_record(...)).material`,
-- which writes SQL NULL. `brands.material` is `text[] not null default '{}'`
-- (confirmed live: information_schema.columns.is_nullable = 'NO'), so the clear
-- would 23502 and abort the whole apply. Every other member of these lists is
-- nullable or has no clear path, which is why list 5 was safe until material
-- arrived. "Clear a material list" means writing `'{}'`, and the cleared-fields
-- mechanism cannot say that — teaching it to needs its own change, so material
-- simply cannot be cleared through a refresh until then.
--
-- LISTS 3 AND 4 CARRY THE SAME 23502 EXPOSURE, and are admitted anyway. They
-- are built from `jsonb_each(enriched_data)` and `jsonb_each(review_overrides)`
-- with no non-null constraint, so a JSON null stored under `material` in either
-- blob would reach the same `update ... set material = ...` loop and fail the
-- whole apply exactly as a list-5 clear would. What makes list 5 different is
-- that it can ONLY produce JSON null — the exclusion there removes a certainty,
-- not a risk — while lists 3 and 4 carry whatever a writer put in the blob.
--
-- Nothing writes `material` into either blob today: no enrichment phase emits
-- it, and `SubmissionReviewData` has no material field, so `review_overrides`
-- cannot acquire one through the review. These entries are forward-looking, for
-- the writer DEV-1502 anticipated. THE INVARIANT THAT WRITER MUST HOLD: emit
-- `[]` for "no materials" and omit the key for "unchanged", never JSON null.
-- `material` is the first NOT NULL member of these lists — every other one is
-- nullable, which is why the blobs have never had to observe this rule — so it
-- is stated here rather than left to be rediscovered from a failed apply. It is
-- not guarded in SQL because the guard would have to be material-specific: a
-- blanket `entry.value <> 'null'` would silently retire the working NULL-clear
-- path that every nullable member of these lists relies on.
--
-- `'products'` IS NOT ADDED TO ANY LIST, and must not be. The curated-product
-- proposals ride `brand_submissions.enriched_data.products`, and this function
-- never writes or deletes that column — it only READS the submission blob, so
-- nothing about the proposals is lost at refresh. What lists 3-5 actually feed
-- is a per-key loop that uses each key as a `brands` COLUMN IDENTIFIER:
--
--   execute format('select to_jsonb(%I) from public.brands where id = $1', v_entry.key)
--   execute format('update public.brands set %1$I = (jsonb_populate_record(
--                     null::public.brands, jsonb_build_object($1, $2))).%1$I
--                   where id = $3', v_entry.key)
--
-- There is no `brands.products` column (confirmed live: zero rows in
-- information_schema.columns for brands.products), so a `'products'` entry
-- would raise 42703 on EVERY refresh apply that carried proposals — precisely
-- the backfill path. Approval materializes the proposals in TypeScript
-- (`lib/services/curated-products/materialize.ts`), from the effective review
-- layer, after the RPC returns. The count-0 contract below keeps that decision
-- checkable instead of re-derivable.
--
-- THE NEW-BRAND APPROVAL FUNCTION IS NOT TOUCHED HERE, deliberately and by
-- name: this file rewrites exactly one function. The approval RPC takes its
-- `p_brand_data` argument already assembled in TypeScript and never reads
-- `enriched_data`, so the new-brand path needs no SQL change for products at
-- all. Its own missing `material` entries — three positional column lists — are
-- known and out of this migration's scope.
--
-- ORDERING IS LOAD-BEARING, and this file was RENUMBERED for it. It was
-- authored as 20260819160000 against the body 20260819130000 left behind
-- (fingerprint `2206671cb5ec38c303ffd1cfdbbd9c3c`). DEV-1510 and DEV-1525 then
-- merged ahead of it: 20260820145000 appended the
-- `subcategory_json_to_slugs(v_effective)` conversion to this same function, so
-- the old fingerprint now describes a body that no longer exists and the old
-- number would sort this rewrite BEFORE the migrations it must follow.
--
-- FINGERPRINT PROVENANCE. `5615ed859182567e6e1155a3cdb7ecd4` was OBSERVED, not
-- derived. Read read-only from staging (`xwkigpvnheecihpxyvsl`) at
-- **2026-08-19 16:29 UTC**, with the full chain through 20260820170000 applied
-- and none of this branch's own migrations applied:
--
--   psql "$SUPABASE_DB_URL" -At -c "
--     select md5(pg_get_functiondef(
--       'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure
--     ));"
--   -- 5615ed859182567e6e1155a3cdb7ecd4
--
-- The same read confirmed the two count-0 preconditions asserted below: the
-- live body contains zero occurrences of `'material'` and zero of `'products'`.
-- A drifted body raises P0001 and changes nothing.

begin;

-- Re-created here: every migration that defines these two helpers drops them at
-- its own tail, and the last one to do so was 20260820145000. A migration that
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
  v_refresh text;
  v_live text;
  v_material_count integer;
begin
  perform public.dev1503_contract_assert_function(
    'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure,
    '5615ed859182567e6e1155a3cdb7ecd4'
  );

  v_refresh := pg_get_functiondef(
    'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure
  );

  -- Additive edits are not idempotent, so the token must be absent BEFORE it is
  -- inserted. A second application fails here instead of quietly writing
  -- `'material'` into each allow-list twice.
  v_refresh := public.dev1503_contract_replace_exact(
    v_refresh, $token$'material'$token$, $token$'material'$token$, 0
  );
  -- The decision recorded above, as a contract: a `products` key in any patch
  -- 42703s the apply loop, because there is no brands.products column.
  v_refresh := public.dev1503_contract_replace_exact(
    v_refresh, $token$'products'$token$, $token$'products'$token$, 0
  );

  -- Each allow-list is rewritten through its OWN anchor at an expected count of
  -- 1, longest anchor first. The five lists share an identical element block, so
  -- one shared literal could not have reached four of them and skipped the
  -- fifth; the `into v_*_patch` / `entry.key` / `cleared.field` lines are what
  -- make each anchor unique. `'material'` is inserted as the FIRST element
  -- because `= any(array[...])` is a membership test and a jsonb_object_agg
  -- filter — order is not meaningful in either, and the head of the array is the
  -- only position with a unique anchor.

  -- 3/5 enrichment patch: the path the material backfill uses.
  v_refresh := public.dev1503_contract_replace_exact(
    v_refresh,
$legacy$  into v_enrichment_patch
  from jsonb_each(coalesce(v_submission.enriched_data, '{}'::jsonb)) as entry
  where entry.key = any(array[
$legacy$,
$final$  into v_enrichment_patch
  from jsonb_each(coalesce(v_submission.enriched_data, '{}'::jsonb)) as entry
  where entry.key = any(array[
    'material',
$final$,
    1
  );

  -- 4/5 admin override patch: a reviewer's own material edit.
  v_refresh := public.dev1503_contract_replace_exact(
    v_refresh,
$legacy$  into v_admin_patch
  from jsonb_each(coalesce(v_submission.review_overrides, '{}'::jsonb)) as entry
  where entry.key = any(array[
$legacy$,
$final$  into v_admin_patch
  from jsonb_each(coalesce(v_submission.review_overrides, '{}'::jsonb)) as entry
  where entry.key = any(array[
    'material',
$final$,
    1
  );

  -- 1/5 owner-protection over enriched_data: an owner lock on material must
  -- block a refresh that would overwrite it, exactly like every other field.
  v_refresh := public.dev1503_contract_replace_exact(
    v_refresh,
$legacy$      and entry.key = any(array[
$legacy$,
$final$      and entry.key = any(array[
        'material',
$final$,
    1
  );

  -- 2/5 owner-protection over _cleared_fields. Kept in parity with 1/5 even
  -- though list 5 cannot apply the clear: erring towards protection costs
  -- nothing, and the day list 5 learns to write '{}' this is already correct.
  v_refresh := public.dev1503_contract_replace_exact(
    v_refresh,
$legacy$      and cleared.field = any(array[
$legacy$,
$final$      and cleared.field = any(array[
        'material',
$final$,
    1
  );

  v_refresh := public.dev1503_contract_replace_exact(
    v_refresh, $token$'material'$token$, $token$'material'$token$, 4
  );

  execute v_refresh;

  -- Read the LIVE body back. `execute` stores the text and Postgres regenerates
  -- the definition from the catalog, so this is the only step that proves what
  -- actually landed rather than what was assembled.
  v_live := pg_get_functiondef(
    'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure
  );
  v_material_count :=
    (length(v_live) - length(replace(v_live, $token$'material'$token$, '')))
    / length($token$'material'$token$);
  if v_material_count <> 4 then
    raise exception
      'DEV-1469 refresh allow-lists carry % material entries, expected 4',
      v_material_count
      using errcode = 'P0001';
  end if;
  if position($token$'products'$token$ in v_live) > 0 then
    raise exception
      'DEV-1469 refresh allow-lists must not carry products: there is no brands.products column'
      using errcode = 'P0001';
  end if;
end
$migration$;

drop function public.dev1503_contract_assert_function(regprocedure, text);
drop function public.dev1503_contract_replace_exact(text, text, text, integer);

commit;
