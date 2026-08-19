-- Drop brands.category_attributes (DEV-1502, Wave 2).
--
-- The material axis introduced in 20260819120000 replaces the last thing
-- category_attributes was read for. Nothing in the schema reads the column's
-- VALUE: the live baseline captured in
-- docs/reports/2026-08-19-pre-material-function-dump.sql shows every one of the
-- eight remaining mentions is a plain allow-list membership test or a
-- pass-through column/record-field name, spread over exactly two functions.
--
-- ORDERING IS LOAD-BEARING.
--
--   1. Against the ledger: DEV-1503's migrations AND 20260819120000
--      (material axis + curated rename) must already be applied. The function
--      fingerprints asserted below are the post-DEV-1503 bodies; an unapplied
--      predecessor fails here before any function is rewritten or any column
--      is dropped.
--   2. Inside this file: the two functions are rewritten BEFORE the column is
--      dropped. `approve_submission` names the column in an insert column
--      list, so a drop that ran first would leave the approval path 42703ing
--      on every submission until this migration finished.
--
-- Every rewrite goes through dev1503_contract_replace_exact with an explicit
-- expected occurrence count, so a drifted body raises instead of silently
-- losing a field. The plan estimated ~8 functions; the live schema has 2.

begin;

-- Re-created here: 20260819090000 dropped both helpers at its own tail.
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
  v_approve text;
begin
  -- Exactly two live functions mention the column. Hashes make an unexpected
  -- deploy fail before anything is rewritten.
  perform public.dev1503_contract_assert_function(
    'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure,
    '38657d05f0f079cda852410e00efa32d'
  );
  perform public.dev1503_contract_assert_function(
    'public.approve_submission(uuid,uuid,jsonb)'::regprocedure,
    '1fe09ba3a6aa5d1458cf795cda6c5ef4'
  );

  -- apply_brand_refresh_with_protected_location_gate: 5 occurrences, all of
  -- them the same `any(array[...])` field allow-list entry (owner-state guard
  -- over enriched_data and over _cleared_fields, the enrichment patch filter,
  -- the admin override filter, and the cleared-field patch filter). Dropping
  -- the quoted element together with its trailing comma+space keeps every
  -- array literal valid.
  v_refresh := pg_get_functiondef(
    'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure
  );
  v_refresh := public.dev1503_contract_replace_exact(
    v_refresh, 'category_attributes', 'category_attributes', 5
  );
  v_refresh := public.dev1503_contract_replace_exact(
    v_refresh, '''category_attributes'', ', '', 5
  );
  v_refresh := public.dev1503_contract_replace_exact(
    v_refresh, 'category_attributes', 'category_attributes', 0
  );
  execute v_refresh;

  -- approve_submission: 3 occurrences in three different positional lists —
  -- the insert column list, the matching select expression, and the
  -- jsonb_to_record column-type declaration. All three must lose the column
  -- or the lists stop lining up, so each is removed by its own literal and
  -- the closing count-0 contract proves none was missed.
  v_approve := pg_get_functiondef(
    'public.approve_submission(uuid,uuid,jsonb)'::regprocedure
  );
  v_approve := public.dev1503_contract_replace_exact(
    v_approve, 'category_attributes', 'category_attributes', 3
  );
  -- 1/3 insert column list
  v_approve := public.dev1503_contract_replace_exact(
    v_approve, 'category_attributes, ', '', 1
  );
  -- 2/3 select expression
  v_approve := public.dev1503_contract_replace_exact(
    v_approve, ' brand.category_attributes,', '', 1
  );
  -- 3/3 jsonb_to_record column-type declaration
  v_approve := public.dev1503_contract_replace_exact(
    v_approve, ' category_attributes jsonb,', '', 1
  );
  v_approve := public.dev1503_contract_replace_exact(
    v_approve, 'category_attributes', 'category_attributes', 0
  );
  execute v_approve;
end
$migration$;

alter table public.brands drop column if exists category_attributes;

do $migration$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      -- Functions AND procedures. The filter stays because
      -- pg_get_functiondef() errors on aggregates (prokind = 'a'), so a bare
      -- scan cannot run at all.
      and p.prokind in ('f', 'p')
      and pg_get_functiondef(p.oid) like '%category_attributes%'
  ) then
    raise exception 'DEV-1502 category_attributes remains in a public function or procedure'
      using errcode = 'P0001';
  end if;
end
$migration$;

drop function public.dev1503_contract_assert_function(regprocedure, text);
drop function public.dev1503_contract_replace_exact(text, text, text, integer);

commit;
