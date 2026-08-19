-- `filter_materials` on both search RPCs (DEV-1510, Task 12).
--
-- ---------------------------------------------------------------------------
-- WHY THE RPCs AND NOT JUST THE QUERY BUILDER
-- ---------------------------------------------------------------------------
--
-- `getBrands` has two read paths. With no search term it builds a PostgREST
-- query and can add `.overlaps("material", …)` in TypeScript. The moment a
-- search term is present (`brands.ts:1626`) it leaves the builder entirely for
-- `search_brand_page`, which applies every filter INSIDE the function body. A
-- material filter added only to the builder is therefore silently ignored as
-- soon as a user types — the same defect class as the `?sub=` no-op that
-- DEV-1510 exists to fix. `search_brands` gains the parameter for contract
-- parity; its own caller (the typeahead) passes no filters today.
--
-- ---------------------------------------------------------------------------
-- WHY DROP AND RECREATE INSTEAD OF `CREATE OR REPLACE`
-- ---------------------------------------------------------------------------
--
-- PostgREST resolves an RPC by its PARAMETER NAMES, not positionally, and
-- Postgres refuses to change a function's parameter list in place. Adding
-- `filter_materials` therefore means `drop function` + `create function`.
--
-- That has a security consequence this file must undo by hand: dropping a
-- function discards its ACL, and Supabase's default privileges then hand
-- `anon` and `authenticated` EXECUTE on whatever is created in `public`.
-- `search_brand_page` is `SECURITY DEFINER` and reads `public.brands`
-- unfiltered by RLS, so an un-revoked recreate is a data-exposure change, not a
-- cosmetic one. **Revoking from `public` does NOT undo it** — the grants land
-- on the roles by name, so the revoke has to name them too. The closing block
-- verifies the result with `has_function_privilege` rather than trusting the
-- statements above it.
--
-- Baseline ACL, captured live before this migration:
--
--   search_brand_page … | postgres=X/postgres , service_role=X/postgres
--   search_brands     … | postgres=X/postgres , service_role=X/postgres
--
-- ---------------------------------------------------------------------------
-- DUMP PROVENANCE — these bodies have no source file
-- ---------------------------------------------------------------------------
--
-- Both functions were last rebuilt by string substitution inside
-- 20260819090000_contract_category_subcategory_vocabulary.sql:250-290, so the
-- migration files that name them are stale. The bodies below are not retyped:
-- they are re-materialized from the live catalog at apply time and patched with
-- assertion-carrying replacements, exactly as that migration did.
--
-- Re-dumped LIVE from staging (`xwkigpvnheecihpxyvsl`) at
-- **2026-08-19 09:51:55 UTC** with:
--
--   psql "$SUPABASE_DB_URL" -At -c "
--     select p.oid::regprocedure::text,
--            md5(pg_get_functiondef(p.oid)),
--            length(pg_get_functiondef(p.oid))
--     from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public'
--       and p.proname in ('search_brand_page', 'search_brands')
--     order by 1"
--
-- which returned:
--
--   search_brand_page(text,text[],text[],text,integer[],integer,text)
--     | fb308a1a2eebd8d56e239f2d153c3fa2 | 4740 bytes
--   search_brands(text,integer,boolean,text[],text[],text,text,boolean)
--     | 7b788e4078cc7b4c22e32ca4b10071b9 | 3210 bytes
--
-- `search_brand_page`'s md5 is unchanged from the Task 5 search baseline
-- (`docs/reports/2026-08-20-search-ranking-baseline.md:23`), captured at
-- 2026-08-19 07:55:34 UTC — so nothing moved between the baseline and this
-- edit, and the ranking the baseline pins is the ranking being patched here.
-- Both md5s are asserted below BEFORE anything is dropped: a body that drifted
-- since the dump aborts the migration instead of being silently overwritten.
--
-- ---------------------------------------------------------------------------
-- WHAT CHANGES INSIDE EACH BODY
-- ---------------------------------------------------------------------------
--
--   * one trailing parameter, `filter_materials text[] DEFAULT NULL::text[]`.
--     Appended LAST so every existing positional call site keeps its meaning
--     and every named call keeps resolving;
--   * one predicate, `(filter_materials IS NULL OR b.material && filter_materials)`,
--     mirroring the `filter_subcategories` shape — NULL means "no filter", and
--     `&&` makes a multi-term filter a union, which is what a checkbox rail is;
--   * a bound of 12 on `search_brand_page`'s existing cardinality guard, which
--     is the size of the closed `MATERIALS` vocabulary.
--
-- Ranking is untouched: the predicate sits in the `base` CTE's WHERE clause,
-- so it removes rows without changing any surviving row's `rank_score`. The
-- Task 7 recall check re-runs after this file to prove that.
--
-- Staging only. Production carries none of the 2026-08-19 chain (ADR decision 3).

begin;

create or replace function public.dev1510_assert_function(
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
      'DEV-1510 function fingerprint drift for %: expected %, got %',
      p_signature, p_expected_md5, md5(v_definition)
      using errcode = 'P0001';
  end if;
end;
$function$;

create or replace function public.dev1510_replace_exact(
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
      'DEV-1510 replacement drift for %: expected % occurrences, got %',
      p_legacy, p_expected_count, v_count
      using errcode = 'P0001';
  end if;
  return replace(p_definition, p_legacy, p_final);
end;
$function$;

do $migration$
declare
  v_page text;
  v_search text;
begin
  perform public.dev1510_assert_function(
    'public.search_brand_page(text,text[],text[],text,integer[],integer,text)'::regprocedure,
    'fb308a1a2eebd8d56e239f2d153c3fa2'
  );
  perform public.dev1510_assert_function(
    'public.search_brands(text,integer,boolean,text[],text[],text,text,boolean)'::regprocedure,
    '7b788e4078cc7b4c22e32ca4b10071b9'
  );

  -- ---------------------------------------------------------------------
  -- search_brand_page — the paginated directory RPC
  -- ---------------------------------------------------------------------
  v_page := pg_get_functiondef(
    'public.search_brand_page(text,text[],text[],text,integer[],integer,text)'::regprocedure
  );

  -- The signature. `sort_mode text DEFAULT 'rank'::text)` is unique: the other
  -- two mentions of 'rank' in the body are bare literals with no cast.
  v_page := public.dev1510_replace_exact(
    v_page,
    'sort_mode text DEFAULT ''rank''::text)',
    'sort_mode text DEFAULT ''rank''::text, filter_materials text[] DEFAULT NULL::text[])',
    1
  );

  -- The input bound, alongside the three that already exist. 12 is the whole
  -- closed vocabulary, so a longer array is malformed input rather than a
  -- wider search.
  v_page := public.dev1510_replace_exact(
    v_page,
    '    OR cardinality(filter_price_ranges) > 3',
    '    OR cardinality(filter_price_ranges) > 3' || chr(10) ||
    '    OR cardinality(filter_materials) > 12',
    1
  );

  -- The predicate, immediately after the subcategory filter it mirrors.
  v_page := public.dev1510_replace_exact(
    v_page,
    '      AND (filter_subcategories IS NULL OR b.subcategories && filter_subcategories)',
    '      AND (filter_subcategories IS NULL OR b.subcategories && filter_subcategories)' || chr(10) ||
    '      AND (filter_materials IS NULL OR b.material && filter_materials)',
    1
  );

  -- ---------------------------------------------------------------------
  -- search_brands — the typeahead RPC
  -- ---------------------------------------------------------------------
  v_search := pg_get_functiondef(
    'public.search_brands(text,integer,boolean,text[],text[],text,text,boolean)'::regprocedure
  );

  v_search := public.dev1510_replace_exact(
    v_search,
    'include_test_brands boolean DEFAULT false)',
    'include_test_brands boolean DEFAULT false, filter_materials text[] DEFAULT NULL::text[])',
    1
  );

  -- TWO occurrences by design: this body has an `fts_results` CTE and a
  -- `trgm_results` fallback CTE, and a filter applied to only one of them
  -- leaks unfiltered rows exactly when FTS misses.
  v_search := public.dev1510_replace_exact(
    v_search,
    '      AND (filter_categories IS NULL OR b.category = ANY(filter_categories))',
    '      AND (filter_categories IS NULL OR b.category = ANY(filter_categories))' || chr(10) ||
    '      AND (filter_materials IS NULL OR b.material && filter_materials)',
    2
  );

  -- Parameter names are the PostgREST contract, so these are rebuilt rather
  -- than replaced in place.
  drop function public.search_brand_page(text,text[],text[],text,integer[],integer,text);
  drop function public.search_brands(text,integer,boolean,text[],text[],text,text,boolean);

  execute v_page;
  execute v_search;

  -- Dropping a function discards its ACL and Supabase's default privileges
  -- re-grant EXECUTE to anon/authenticated. Restore the captured baseline
  -- exactly, revoking BY ROLE NAME: revoking from `public` alone leaves the
  -- role grants standing.
  revoke all on function
    public.search_brand_page(text,text[],text[],text,integer[],integer,text,text[])
    from public;
  revoke all on function
    public.search_brand_page(text,text[],text[],text,integer[],integer,text,text[])
    from anon, authenticated;
  grant execute on function
    public.search_brand_page(text,text[],text[],text,integer[],integer,text,text[])
    to postgres, service_role;

  revoke all on function
    public.search_brands(text,integer,boolean,text[],text[],text,text,boolean,text[])
    from public;
  revoke all on function
    public.search_brands(text,integer,boolean,text[],text[],text,text,boolean,text[])
    from anon, authenticated;
  grant execute on function
    public.search_brands(text,integer,boolean,text[],text[],text,text,boolean,text[])
    to postgres, service_role;
end
$migration$;

-- ---------------------------------------------------------------------------
-- CLOSING CONTRACT — assert the result, do not assume it
-- ---------------------------------------------------------------------------
do $migration$
declare
  v_signature regprocedure;
  v_role text;
  v_acl text;
begin
  foreach v_signature in array array[
    'public.search_brand_page(text,text[],text[],text,integer[],integer,text,text[])'::regprocedure,
    'public.search_brands(text,integer,boolean,text[],text[],text,text,boolean,text[])'::regprocedure
  ]
  loop
    if not has_function_privilege('service_role', v_signature, 'EXECUTE') then
      raise exception 'DEV-1510 % lost EXECUTE for service_role', v_signature
        using errcode = 'P0001';
    end if;
    foreach v_role in array array['anon', 'authenticated']
    loop
      if has_function_privilege(v_role, v_signature, 'EXECUTE') then
        raise exception
          'DEV-1510 % is executable by % after the recreate', v_signature, v_role
          using errcode = 'P0001';
      end if;
    end loop;

    -- `has_function_privilege` cannot be asked about PUBLIC (it is not a role),
    -- and a PUBLIC grant would satisfy every role at once. Compare the whole
    -- ACL against the captured baseline instead: an entry whose grantee is
    -- empty (`=X/postgres`) IS the PUBLIC grant.
    select coalesce(array_to_string(p.proacl, ','), '<default>')
      into v_acl
      from pg_proc p where p.oid = v_signature;
    if v_acl is distinct from 'postgres=X/postgres,service_role=X/postgres' then
      raise exception 'DEV-1510 % ACL is % , expected the captured baseline',
        v_signature, v_acl
        using errcode = 'P0001';
    end if;

    if position('b.material && filter_materials' in pg_get_functiondef(v_signature)) = 0 then
      raise exception 'DEV-1510 % has the parameter but never applies it', v_signature
        using errcode = 'P0001';
    end if;
  end loop;

  -- The PostgREST resolution contract, spelled out. `pg_get_function_arguments`
  -- is the form the schema cache matches a JSON body against, so a reordered or
  -- renamed parameter is a broken client, not a refactor.
  if pg_get_function_arguments(
    'public.search_brand_page(text,text[],text[],text,integer[],integer,text,text[])'::regprocedure
  ) is distinct from
    'search_query text, filter_categories text[] DEFAULT NULL::text[], '
    || 'filter_subcategories text[] DEFAULT NULL::text[], '
    || 'filter_verification text DEFAULT NULL::text, '
    || 'filter_price_ranges integer[] DEFAULT NULL::integer[], '
    || 'page_offset integer DEFAULT 0, sort_mode text DEFAULT ''rank''::text, '
    || 'filter_materials text[] DEFAULT NULL::text[]'
  then
    raise exception 'DEV-1510 search_brand_page argument contract drifted: %',
      pg_get_function_arguments(
        'public.search_brand_page(text,text[],text[],text,integer[],integer,text,text[])'::regprocedure
      )
      using errcode = 'P0001';
  end if;

  -- Volatility and security are load-bearing and easy to lose in a retype.
  if not exists (
    select 1 from pg_proc p
    where p.oid = 'public.search_brand_page(text,text[],text[],text,integer[],integer,text,text[])'::regprocedure
      and p.provolatile = 's'
      and p.prosecdef
  ) then
    raise exception 'DEV-1510 search_brand_page must stay STABLE SECURITY DEFINER'
      using errcode = 'P0001';
  end if;
end
$migration$;

drop function public.dev1510_assert_function(regprocedure, text);
drop function public.dev1510_replace_exact(text, text, text, integer);

-- PostgREST caches the schema; without this the new parameter resolves as
-- PGRST202 until the next unrelated DDL event.
notify pgrst, 'reload schema';

commit;
