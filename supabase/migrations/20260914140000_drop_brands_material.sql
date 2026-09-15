-- Drop brands.material and brand-level material infrastructure (DEV-1724).
--
-- Release order is deliberate: deploy the application that no longer reads,
-- writes, or sends the search RPC filter_materials argument before applying
-- this contract migration. The old nullable column and optional argument
-- remain compatible with that application during the deployment window.
--
-- Pattern: 20260824090000_remove_brand_price_range.sql

begin;

create or replace function public.dev1724_replace_exact(
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
      'DEV-1724 replacement drift for %: expected % occurrences, got %',
      p_legacy, p_expected_count, v_count
      using errcode = 'P0001';
  end if;
  return replace(p_definition, p_legacy, p_final);
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Remove filter_materials from both search RPCs
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Parameter list changes → drop + create (Postgres refuses in-place changes).
-- Dropping discards ACL; Supabase defaults re-grant EXECUTE to anon/
-- authenticated. search_brand_page is SECURITY DEFINER and reads brands
-- unfiltered by RLS, so the revoke/grant must be explicit. The closing block
-- asserts the result with has_function_privilege.

do $migration$
declare
  v_page text;
  v_search text;
begin
  -- ── search_brand_page ──────────────────────────────────────────────────
  v_page := pg_get_functiondef(
    'public.search_brand_page(text,text[],text[],text,integer,text,text[])'::regprocedure
  );

  v_page := public.dev1724_replace_exact(
    v_page,
    'sort_mode text DEFAULT ''rank''::text, filter_materials text[] DEFAULT NULL::text[])',
    'sort_mode text DEFAULT ''rank''::text)',
    1
  );

  v_page := public.dev1724_replace_exact(
    v_page,
    '    OR cardinality(filter_materials) > 12' || chr(10),
    '',
    1
  );

  v_page := public.dev1724_replace_exact(
    v_page,
    '      AND (filter_materials IS NULL OR b.material && filter_materials)' || chr(10),
    '',
    1
  );

  -- ── search_brands ──────────────────────────────────────────────────────
  v_search := pg_get_functiondef(
    'public.search_brands(text,integer,boolean,text[],text[],text,text,boolean,text[])'::regprocedure
  );

  v_search := public.dev1724_replace_exact(
    v_search,
    'include_test_brands boolean DEFAULT false, filter_materials text[] DEFAULT NULL::text[])',
    'include_test_brands boolean DEFAULT false)',
    1
  );

  v_search := public.dev1724_replace_exact(
    v_search,
    '      AND (filter_materials IS NULL OR b.material && filter_materials)' || chr(10),
    '',
    2
  );

  drop function public.search_brand_page(text,text[],text[],text,integer,text,text[]);
  drop function public.search_brands(text,integer,boolean,text[],text[],text,text,boolean,text[]);

  execute v_page;
  execute v_search;

  revoke all on function
    public.search_brand_page(text,text[],text[],text,integer,text)
    from public;
  revoke all on function
    public.search_brand_page(text,text[],text[],text,integer,text)
    from anon, authenticated;
  grant execute on function
    public.search_brand_page(text,text[],text[],text,integer,text)
    to postgres, service_role;

  revoke all on function
    public.search_brands(text,integer,boolean,text[],text[],text,text,boolean)
    from public;
  revoke all on function
    public.search_brands(text,integer,boolean,text[],text[],text,text,boolean)
    from anon, authenticated;
  grant execute on function
    public.search_brands(text,integer,boolean,text[],text[],text,text,boolean)
    to postgres, service_role;
end
$migration$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Remove 'material' from the 4 refresh allow-lists
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Reverses 20260821100000_refresh_allowlist_material.sql, which added
-- 'material' as the first element in 4 of the 5 allow-lists inside
-- apply_brand_refresh_with_protected_location_gate. List 5 (cleared-fields)
-- was deliberately excluded then and stays untouched now.
--
-- The two indent widths match the original insertion: lists 3/5 and 4/5
-- (enrichment and admin patches) used 4-space indent; lists 1/5 and 2/5
-- (owner-protection checks) used 8-space indent.

do $migration$
declare
  v_refresh text;
  v_live text;
  v_material_count integer;
begin
  v_refresh := pg_get_functiondef(
    'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure
  );

  v_refresh := public.dev1724_replace_exact(
    v_refresh, $token$'material'$token$, $token$'material'$token$, 4
  );

  -- Lists 3/5 and 4/5: 4-space indent
  v_refresh := public.dev1724_replace_exact(
    v_refresh,
    chr(10) || '    ''material'',',
    '',
    2
  );

  -- Lists 1/5 and 2/5: 8-space indent
  v_refresh := public.dev1724_replace_exact(
    v_refresh,
    chr(10) || '        ''material'',',
    '',
    2
  );

  execute v_refresh;

  v_live := pg_get_functiondef(
    'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure
  );
  v_material_count :=
    (length(v_live) - length(replace(v_live, $token$'material'$token$, '')))
    / length($token$'material'$token$);
  if v_material_count <> 0 then
    raise exception
      'DEV-1724 refresh allow-lists still carry % material entries, expected 0',
      v_material_count
      using errcode = 'P0001';
  end if;
end
$migration$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Clean up provenance and correction state, then narrow the constraint
-- ─────────────────────────────────────────────────────────────────────────────

delete from public.brand_field_events where field = 'material';
delete from public.brand_field_state where field = 'material';
delete from public.brand_field_corrections where field = 'material';

alter table public.brand_field_corrections
  drop constraint brand_field_corrections_field_check;
alter table public.brand_field_corrections
  add constraint brand_field_corrections_field_check check (
    field = any (array[
      'category'::text,
      'subcategories'::text,
      'purchase_website'::text,
      'purchase_pinkoi'::text,
      'purchase_shopee'::text,
      'purchase_myship'::text,
      'social_instagram'::text,
      'social_threads'::text,
      'social_facebook'::text
    ])
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Drop the column (CASCADE removes CHECK + GIN index)
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.brands
  drop column material;

-- ─────────────────────────────────────────────────────────────────────────────
-- Closing assertions
-- ─────────────────────────────────────────────────────────────────────────────

do $migration$
declare
  v_signature regprocedure;
  v_role text;
  v_acl text;
begin
  foreach v_signature in array array[
    'public.search_brand_page(text,text[],text[],text,integer,text)'::regprocedure,
    'public.search_brands(text,integer,boolean,text[],text[],text,text,boolean)'::regprocedure
  ]
  loop
    if not has_function_privilege('service_role', v_signature, 'EXECUTE') then
      raise exception 'DEV-1724 % lost EXECUTE for service_role', v_signature
        using errcode = 'P0001';
    end if;
    foreach v_role in array array['anon', 'authenticated']
    loop
      if has_function_privilege(v_role, v_signature, 'EXECUTE') then
        raise exception 'DEV-1724 % is executable by % after the recreate',
          v_signature, v_role
          using errcode = 'P0001';
      end if;
    end loop;

    select coalesce(array_to_string(p.proacl, ','), '<default>')
      into v_acl
      from pg_proc p where p.oid = v_signature;
    if v_acl is distinct from 'postgres=X/postgres,service_role=X/postgres' then
      raise exception 'DEV-1724 % ACL is %, expected captured baseline',
        v_signature, v_acl
        using errcode = 'P0001';
    end if;

    if position('filter_materials' in pg_get_functiondef(v_signature)) > 0 then
      raise exception 'DEV-1724 % still references filter_materials', v_signature
        using errcode = 'P0001';
    end if;
  end loop;

  if to_regprocedure(
    'public.search_brand_page(text,text[],text[],text,integer,text,text[])'
  ) is not null then
    raise exception 'DEV-1724 old search_brand_page overload with filter_materials remains'
      using errcode = 'P0001';
  end if;
  if to_regprocedure(
    'public.search_brands(text,integer,boolean,text[],text[],text,text,boolean,text[])'
  ) is not null then
    raise exception 'DEV-1724 old search_brands overload with filter_materials remains'
      using errcode = 'P0001';
  end if;

  if pg_get_function_arguments(
    'public.search_brand_page(text,text[],text[],text,integer,text)'::regprocedure
  ) is distinct from
    'search_query text, filter_categories text[] DEFAULT NULL::text[], '
    || 'filter_subcategories text[] DEFAULT NULL::text[], '
    || 'filter_verification text DEFAULT NULL::text, '
    || 'page_offset integer DEFAULT 0, sort_mode text DEFAULT ''rank''::text'
  then
    raise exception 'DEV-1724 search_brand_page argument contract drifted: %',
      pg_get_function_arguments(
        'public.search_brand_page(text,text[],text[],text,integer,text)'::regprocedure
      )
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_proc p
    where p.oid = 'public.search_brand_page(text,text[],text[],text,integer,text)'::regprocedure
      and p.provolatile = 's'
      and p.prosecdef
      and p.proconfig = array['search_path=public, pg_temp']::text[]
  ) then
    raise exception 'DEV-1724 search_brand_page must remain STABLE SECURITY DEFINER with its search path'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'brands'
      and column_name = 'material'
  ) then
    raise exception 'DEV-1724 brands.material column remains'
      using errcode = 'P0001';
  end if;

  if exists (select 1 from public.brand_field_events where field = 'material')
     or exists (select 1 from public.brand_field_state where field = 'material')
     or exists (select 1 from public.brand_field_corrections where field = 'material') then
    raise exception 'DEV-1724 material provenance or correction rows remain'
      using errcode = 'P0001';
  end if;
end
$migration$;

drop function public.dev1724_replace_exact(text, text, text, integer);

notify pgrst, 'reload schema';

commit;
