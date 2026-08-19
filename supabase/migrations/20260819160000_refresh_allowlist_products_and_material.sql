-- Refresh allow-lists: admit `material`, and record why `products` stays out
-- (DEV-1469 / DEV-1502).
--
-- `apply_brand_refresh_with_protected_location_gate` filters `enriched_data`
-- and `review_overrides` through FIVE field allow-lists:
--
--   1/5  owner-protection check over enriched_data          (raise on conflict)
--   2/5  owner-protection check over _cleared_fields        (raise on conflict)
--   3/5  the enrichment patch                               (writes brands.<col>)
--   4/5  the admin override patch (also carries 'name')     (writes brands.<col>)
--   5/5  the cleared-fields patch                           (writes NULL)
--
-- DEV-1502 shipped `brands.material` without touching any of them, so a
-- material value on a submission is filtered out and silently lost at every
-- refresh. This migration adds `'material'` to 1-4.
--
-- LIST 5 IS DELIBERATELY EXCLUDED, and this is not an oversight. The
-- cleared-fields patch is built as `jsonb_object_agg(f.field, 'null'::jsonb)`,
-- so the only value it can express is JSON null; the apply loop then runs
-- `update public.brands set material = (jsonb_populate_record(...)).material`,
-- which writes SQL NULL. `brands.material` is `text[] not null default '{}'`
-- (20260819120000), so the clear would 23502 and abort the whole apply. Every
-- other member of these lists is nullable or has no clear path, which is why
-- list 5 was safe until material arrived. "Clear a material list" means writing
-- `'{}'`, and the cleared-fields mechanism cannot say that — teaching it to
-- needs its own change, so material simply cannot be cleared through a refresh
-- until then.
--
-- `'products'` IS NOT ADDED TO ANY LIST, and must not be. The curated-product
-- proposals ride `brand_submissions.enriched_data.products`, and this function
-- never writes or deletes that column — it only reads it, so nothing about the
-- proposals is lost at refresh. What lists 3-5 actually do is drive a per-key
-- `update public.brands set <key> = ...` loop over the patch, and there is no
-- `brands.products` column: a `products` key inside the patch would make
-- `select to_jsonb("products") from public.brands` raise 42703 and fail EVERY
-- refresh apply that carried proposals — precisely the backfill path. Approval
-- materializes the proposals in TypeScript
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
-- ORDERING IS LOAD-BEARING. The asserted fingerprint is the body left by
-- 20260819130000, which is itself gated on 20260819090000 and 20260819120000.
-- An unapplied predecessor fails at the fingerprint assert before a single
-- allow-list is rewritten.
--
-- FINGERPRINT PROVENANCE. `2206671cb5ec38c303ffd1cfdbbd9c3c` was derived, not
-- observed live: the committed staging dump
-- `docs/reports/2026-08-18-pre-rename-function-dump.sql` md5s to
-- `7ec68dd607613015fb60132db15d7254`, which is the baseline asserted by
-- 20260819090000; replaying that migration's three documented replacements
-- (product_tags_en x5, product_tags x7, product_type x6) reproduces
-- `38657d05f0f079cda852410e00efa32d`, the exact value 20260819130000 asserts,
-- which validates the replay; applying 20260819130000's own removal of
-- `'category_attributes', ` x5 then yields the value below. No later migration
-- touches this function. A drifted live body raises P0001 and changes nothing.

begin;

-- Re-created here: 20260819090000 dropped both helpers at its own tail, and
-- 20260819130000 re-created and dropped them again for the same reason.
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
    '2206671cb5ec38c303ffd1cfdbbd9c3c'
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

  -- 3/5 enrichment patch: the path the products/material backfill uses.
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
