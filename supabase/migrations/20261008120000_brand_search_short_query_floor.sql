-- Raise the brand-search trigram floor for short and repeated-character
-- queries (DEV-1970 / DS-19).
--
-- The trigram arm of search_brand_page and search_brands runs only when the
-- query has no CJK and full-text search matched nothing. Its fixed 0.25 floor
-- let nonsense queries through: `/brands?search=zzzz` matched 10-11 brands and
-- `aaaa` matched 33. Measured on staging with a 0.5 floor: zzzz -> 0,
-- aaaa -> 0, zen -> 1 (山霧 ZenU, a real match), lamp -> 5.
--
-- public.brand_trgm_floor(query) now owns the floor:
--   * one repeated character (zz, aaaa)  -> 2.0, above brand_trgm_rank's 1.0
--     ceiling, so the trigram arm returns nothing
--   * 4 characters or fewer              -> 0.5
--   * anything longer                    -> 0.25 (unchanged)
--
-- Deliberate shortcut: "spring pool" (11 chars, 4 trigram matches at 0.25) is
-- NOT addressed. Ceiling: only <=4-char and repeated-character queries are
-- tightened. Upgrade path: calibrate the general floor against a search golden
-- set.
--
-- Neither RPC has a canonical source file, so both bodies are read live with
-- pg_get_functiondef and rewritten through pg_temp.patch_once, which refuses
-- unless its anchor appears exactly once. CREATE OR REPLACE with an unchanged
-- signature keeps the ACL; the closing assertions prove it anyway.
--
-- Rollback: supabase/migrations/reverse/20261008120000_revert_brand_search_short_query_floor.sql
-- (a reverse patch_once replacing each helper call back with 0.25, then
-- `drop function public.brand_trgm_floor(text)`).
--
-- Pattern: 20260812020753_drop_brands_retail_locations.sql (patch_once),
--          20260914140000_drop_brands_material.sql (ACL assertions).

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

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The floor helper
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.brand_trgm_floor(p_query text)
returns real
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $function$
  select case
    when lower(btrim(p_query)) ~ '^(.)\1*$' then 2.0::real
    when char_length(btrim(p_query)) <= 4 then 0.5::real
    else 0.25::real
  end;
$function$;

-- Same grants as brand_trgm_rank (20260819090000). search_brand_page is
-- SECURITY DEFINER (runs as postgres); search_brands is SECURITY INVOKER and is
-- called by service_role, so service_role needs EXECUTE directly.
revoke all on function public.brand_trgm_floor(text)
  from public, anon, authenticated;
grant execute on function public.brand_trgm_floor(text)
  to postgres, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Patch both search RPCs in place
-- ─────────────────────────────────────────────────────────────────────────────

-- One text fingerprint of everything a recreate could silently change:
-- arguments, result, ACL, SECURITY DEFINER, volatility and search path.
create or replace function pg_temp.dev1970_contract(p_sig regprocedure)
returns text
language sql
as $contract$
  select concat_ws(
    ' | ',
    pg_get_function_arguments(p.oid),
    pg_get_function_result(p.oid),
    coalesce(array_to_string(p.proacl, ','), '<default>'),
    p.prosecdef::text,
    p.provolatile::text,
    coalesce(array_to_string(p.proconfig, ','), '<none>')
  )
  from pg_proc p
  where p.oid = p_sig;
$contract$;

do $migration$
declare
  v_page_sig constant regprocedure :=
    'public.search_brand_page(text,text[],text[],text,integer,text)'::regprocedure;
  v_search_sig constant regprocedure :=
    'public.search_brands(text,integer,boolean,text[],text[],text,text,boolean)'::regprocedure;
  v_page_before constant text := pg_temp.dev1970_contract(
    'public.search_brand_page(text,text[],text[],text,integer,text)'::regprocedure
  );
  v_search_before constant text := pg_temp.dev1970_contract(
    'public.search_brands(text,integer,boolean,text[],text[],text,text,boolean)'::regprocedure
  );
  v_sig regprocedure;
  v_body text;
  v_role text;
begin
  -- search_brand_page: the trigram arm of the `ranked` CTE.
  v_body := pg_temp.patch_once(
    pg_get_functiondef(v_page_sig),
    '      AND base.trgm_rank >= 0.25',
    '      AND base.trgm_rank >= public.brand_trgm_floor(sanitized_query)',
    'search_brand_page trigram floor'
  );
  execute v_body;

  -- search_brands: the closing paren of the brand_trgm_rank(...) call.
  v_body := pg_temp.patch_once(
    pg_get_functiondef(v_search_sig),
    '      ) >= 0.25',
    '      ) >= public.brand_trgm_floor(search_query)',
    'search_brands trigram floor'
  );
  execute v_body;

  -- Signature, volatility, security mode, search path and ACL are unchanged.
  if pg_temp.dev1970_contract(v_page_sig) is distinct from v_page_before then
    raise exception 'DEV-1970 search_brand_page contract drifted: % -> %',
      v_page_before, pg_temp.dev1970_contract(v_page_sig)
      using errcode = 'P0001';
  end if;
  if pg_temp.dev1970_contract(v_search_sig) is distinct from v_search_before then
    raise exception 'DEV-1970 search_brands contract drifted: % -> %',
      v_search_before, pg_temp.dev1970_contract(v_search_sig)
      using errcode = 'P0001';
  end if;

  foreach v_sig in array array[v_page_sig, v_search_sig]
  loop
    if not has_function_privilege('service_role', v_sig, 'EXECUTE') then
      raise exception 'DEV-1970 % lost EXECUTE for service_role', v_sig
        using errcode = 'P0001';
    end if;
    foreach v_role in array array['anon', 'authenticated']
    loop
      if has_function_privilege(v_role, v_sig, 'EXECUTE') then
        raise exception 'DEV-1970 % is executable by %', v_sig, v_role
          using errcode = 'P0001';
      end if;
    end loop;
  end loop;
end
$migration$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Closing assertions
-- ─────────────────────────────────────────────────────────────────────────────

do $assertions$
declare
  v_sig regprocedure;
  v_body text;
  v_role text;
begin
  -- Helper thresholds.
  if not (public.brand_trgm_floor('zzzz') > 1) then
    raise exception 'DEV-1970 floor(zzzz) must exceed 1' using errcode = 'P0001';
  end if;
  if not (public.brand_trgm_floor('aaaaaaa') > 1) then
    raise exception 'DEV-1970 floor(aaaaaaa) must exceed 1' using errcode = 'P0001';
  end if;
  if not (public.brand_trgm_floor(' Zz ') > 1) then
    raise exception 'DEV-1970 floor( Zz ) must exceed 1' using errcode = 'P0001';
  end if;
  if not (public.brand_trgm_floor('zen') = 0.5) then
    raise exception 'DEV-1970 floor(zen) must be 0.5' using errcode = 'P0001';
  end if;
  if not (public.brand_trgm_floor('lamp') = 0.5) then
    raise exception 'DEV-1970 floor(lamp) must be 0.5' using errcode = 'P0001';
  end if;
  if not (public.brand_trgm_floor('spring pool') = 0.25) then
    raise exception 'DEV-1970 floor(spring pool) must be 0.25' using errcode = 'P0001';
  end if;

  -- Helper ACL matches brand_trgm_rank.
  if not has_function_privilege('service_role', 'public.brand_trgm_floor(text)', 'EXECUTE') then
    raise exception 'DEV-1970 brand_trgm_floor is not executable by service_role'
      using errcode = 'P0001';
  end if;
  foreach v_role in array array['anon', 'authenticated']
  loop
    if has_function_privilege(v_role, 'public.brand_trgm_floor(text)', 'EXECUTE') then
      raise exception 'DEV-1970 brand_trgm_floor is executable by %', v_role
        using errcode = 'P0001';
    end if;
  end loop;

  -- Both live bodies call the helper and no longer carry the fixed floor.
  foreach v_sig in array array[
    'public.search_brand_page(text,text[],text[],text,integer,text)'::regprocedure,
    'public.search_brands(text,integer,boolean,text[],text[],text,text,boolean)'::regprocedure
  ]
  loop
    v_body := pg_get_functiondef(v_sig);
    if position('brand_trgm_floor(' in v_body) = 0 then
      raise exception 'DEV-1970 % does not call brand_trgm_floor', v_sig
        using errcode = 'P0001';
    end if;
    if position('>= 0.25' in v_body) > 0 then
      raise exception 'DEV-1970 % still carries a fixed >= 0.25 floor', v_sig
        using errcode = 'P0001';
    end if;
  end loop;

  if pg_get_function_arguments(
    'public.search_brand_page(text,text[],text[],text,integer,text)'::regprocedure
  ) is distinct from
    'search_query text, filter_categories text[] DEFAULT NULL::text[], '
    || 'filter_subcategories text[] DEFAULT NULL::text[], '
    || 'filter_verification text DEFAULT NULL::text, '
    || 'page_offset integer DEFAULT 0, sort_mode text DEFAULT ''rank''::text'
  then
    raise exception 'DEV-1970 search_brand_page argument contract drifted'
      using errcode = 'P0001';
  end if;
end
$assertions$;

drop function pg_temp.dev1970_contract(regprocedure);
drop function pg_temp.patch_once(text, text, text, text);

notify pgrst, 'reload schema';

commit;
