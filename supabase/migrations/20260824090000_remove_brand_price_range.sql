-- Remove brand price signals (DEV-1540).
--
-- Release order is deliberate: deploy the application that no longer reads,
-- writes, or sends the optional search RPC price argument before applying this
-- contract migration. The old nullable columns and optional argument remain
-- compatible with that application during the deployment window.
--
-- The four function fingerprints below were read from staging project
-- xwkigpvnheecihpxyvsl on 2026-08-24 before this migration was applied. These
-- functions are hand-patched in prior migrations and have no canonical source
-- file, so every fingerprint is asserted before any body or data is changed.
-- A production fingerprint mismatch must be reconciled before apply; it must
-- not be bypassed by changing the expected hash without reviewing the live
-- definition.

begin;

create or replace function public.dev1540_assert_function(
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
      'DEV-1540 function fingerprint drift for %: expected %, got %',
      p_signature, p_expected_md5, md5(v_definition)
      using errcode = 'P0001';
  end if;
end;
$function$;

create or replace function public.dev1540_replace_exact(
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
      'DEV-1540 replacement drift for %: expected % occurrences, got %',
      p_legacy, p_expected_count, v_count
      using errcode = 'P0001';
  end if;
  return replace(p_definition, p_legacy, p_final);
end;
$function$;

-- Remove both spellings wherever they occur as object keys, field-name
-- values, or changed/cleared-field array members. Audit payload columns are
-- intentionally not passed through this helper: their raw provider payloads
-- remain immutable historical records.
create or replace function pg_temp.dev1540_strip_price_keys(p_value jsonb)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_result jsonb;
begin
  if p_value is null then
    return null;
  end if;

  case jsonb_typeof(p_value)
    when 'object' then
      select coalesce(
        jsonb_object_agg(entry.key, pg_temp.dev1540_strip_price_keys(entry.value)),
        '{}'::jsonb
      )
      into v_result
      from jsonb_each(p_value) as entry
      where entry.key not in ('price_range', 'priceRange')
        and not (
          jsonb_typeof(entry.value) = 'string'
          and entry.value #>> '{}' in ('price_range', 'priceRange')
        );
      return v_result;
    when 'array' then
      select coalesce(
        jsonb_agg(pg_temp.dev1540_strip_price_keys(item.value) order by item.ordinality),
        '[]'::jsonb
      )
      into v_result
      from jsonb_array_elements(p_value) with ordinality as item(value, ordinality)
      where not (
        jsonb_typeof(item.value) = 'string'
        and item.value #>> '{}' in ('price_range', 'priceRange')
      );
      return v_result;
    else
      return p_value;
  end case;
end;
$function$;

do $migration$
begin
  perform public.dev1540_assert_function(
    'public.approve_submission(uuid,uuid,jsonb)'::regprocedure,
    '0f8c5a6216cf4728a41d51c8f016fdb0'
  );
  perform public.dev1540_assert_function(
    'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure,
    '42461685ebfecedd4ebd9a08254fadcd'
  );
  perform public.dev1540_assert_function(
    'public.correct_approved_submission_provenance()'::regprocedure,
    '6d778a7d18b90a9a89bfcb87a98b1b51'
  );
  perform public.dev1540_assert_function(
    'public.search_brand_page(text,text[],text[],text,integer[],integer,text,text[])'::regprocedure,
    '9916a7c0fb88922e042ce496874b111b'
  );
end
$migration$;

do $migration$
declare
  v_approve text;
  v_refresh text;
  v_provenance text;
  v_search text;
begin
  v_approve := pg_get_functiondef(
    'public.approve_submission(uuid,uuid,jsonb)'::regprocedure
  );
  v_approve := public.dev1540_replace_exact(
    v_approve, '  v_price_range integer;' || chr(10), '', 1
  );
  v_approve := public.dev1540_replace_exact(
    v_approve, '    brand.price_range,' || chr(10), '', 1
  );
  v_approve := public.dev1540_replace_exact(
    v_approve, '    v_price_range,' || chr(10), '', 1
  );
  v_approve := public.dev1540_replace_exact(
    v_approve, '    price_range integer,' || chr(10), '', 1
  );
  v_approve := public.dev1540_replace_exact(
    v_approve,
    '    or v_price_range is null' || chr(10)
      || '    or v_price_range not between 1 and 3' || chr(10),
    '',
    1
  );
  v_approve := public.dev1540_replace_exact(
    v_approve,
    '    site_content, submitted_at, approved_at, price_range, subcategories,' || chr(10),
    '    site_content, submitted_at, approved_at, subcategories,' || chr(10),
    1
  );
  v_approve := public.dev1540_replace_exact(
    v_approve,
    '    brand.price_range, brand.subcategories, brand.subcategories_en' || chr(10),
    '    brand.subcategories, brand.subcategories_en' || chr(10),
    1
  );
  v_approve := public.dev1540_replace_exact(
    v_approve,
    '    price_range smallint, subcategories text[], subcategories_en text[]' || chr(10),
    '    subcategories text[], subcategories_en text[]' || chr(10),
    1
  );

  v_refresh := pg_get_functiondef(
    'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure
  );
  v_refresh := public.dev1540_replace_exact(
    v_refresh,
    '''category'', ''price_range'', ''subcategories''',
    '''category'', ''subcategories''',
    5
  );
  v_refresh := public.dev1540_replace_exact(
    v_refresh,
    '    or coalesce((v_effective ->> ''price_range'')::integer, 0) not between 1 and 3' || chr(10),
    '',
    1
  );

  v_provenance := pg_get_functiondef(
    'public.correct_approved_submission_provenance()'::regprocedure
  );
  v_provenance := public.dev1540_replace_exact(
    v_provenance,
    '      ''price_range'', new.owner_data -> ''priceRange'',' || chr(10),
    '',
    1
  );

  v_search := pg_get_functiondef(
    'public.search_brand_page(text,text[],text[],text,integer[],integer,text,text[])'::regprocedure
  );
  v_search := public.dev1540_replace_exact(
    v_search,
    'filter_verification text DEFAULT NULL::text, filter_price_ranges integer[] DEFAULT NULL::integer[], page_offset',
    'filter_verification text DEFAULT NULL::text, page_offset',
    1
  );
  v_search := public.dev1540_replace_exact(
    v_search,
    '    OR cardinality(filter_price_ranges) > 3' || chr(10),
    '',
    1
  );
  v_search := public.dev1540_replace_exact(
    v_search,
    '      AND (filter_price_ranges IS NULL OR b.price_range = ANY(filter_price_ranges))' || chr(10),
    '',
    1
  );

  execute v_approve;
  execute v_refresh;
  execute v_provenance;

  drop function public.search_brand_page(
    text, text[], text[], text, integer[], integer, text, text[]
  );
  execute v_search;

  revoke all on function
    public.search_brand_page(text,text[],text[],text,integer,text,text[])
    from public;
  revoke all on function
    public.search_brand_page(text,text[],text[],text,integer,text,text[])
    from anon, authenticated;
  grant execute on function
    public.search_brand_page(text,text[],text[],text,integer,text,text[])
    to postgres, service_role;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and pg_get_functiondef(p.oid) ilike '%price_range%'
  ) then
    raise exception 'DEV-1540 active routine still references price_range'
      using errcode = 'P0001';
  end if;
end
$migration$;

-- Retire provenance and correction state before narrowing the correction
-- contract. Historical provider audit payloads are not modified.
delete from public.brand_field_events where field = 'price_range';
delete from public.brand_field_state where field = 'price_range';
delete from public.brand_field_corrections where field = 'price_range';

alter table public.brand_field_corrections
  drop constraint brand_field_corrections_field_check;
alter table public.brand_field_corrections
  add constraint brand_field_corrections_field_check check (
    field = any (array[
      'category'::text,
      'subcategories'::text,
      'material'::text,
      'purchase_website'::text,
      'purchase_pinkoi'::text,
      'purchase_shopee'::text,
      'purchase_myship'::text,
      'social_instagram'::text,
      'social_threads'::text,
      'social_facebook'::text
    ])
  );

update public.brands
set draft_data = pg_temp.dev1540_strip_price_keys(draft_data)
where draft_data is distinct from pg_temp.dev1540_strip_price_keys(draft_data);

update public.pending_brand_edits
set proposed_data = pg_temp.dev1540_strip_price_keys(proposed_data)
where proposed_data is distinct from pg_temp.dev1540_strip_price_keys(proposed_data);

update public.brand_submissions
set
  suggested_tags = pg_temp.dev1540_strip_price_keys(suggested_tags),
  validation_errors = pg_temp.dev1540_strip_price_keys(validation_errors),
  enriched_data = pg_temp.dev1540_strip_price_keys(enriched_data - 'faq'),
  owner_data = pg_temp.dev1540_strip_price_keys(owner_data),
  base_brand_data = pg_temp.dev1540_strip_price_keys(base_brand_data),
  review_overrides = pg_temp.dev1540_strip_price_keys(review_overrides)
where suggested_tags is distinct from pg_temp.dev1540_strip_price_keys(suggested_tags)
   or validation_errors is distinct from pg_temp.dev1540_strip_price_keys(validation_errors)
   or enriched_data is distinct from pg_temp.dev1540_strip_price_keys(enriched_data - 'faq')
   or owner_data is distinct from pg_temp.dev1540_strip_price_keys(owner_data)
   or base_brand_data is distinct from pg_temp.dev1540_strip_price_keys(base_brand_data)
   or review_overrides is distinct from pg_temp.dev1540_strip_price_keys(review_overrides);

update public.curation_job_targets
set
  phase_results = pg_temp.dev1540_strip_price_keys(phase_results),
  changed_fields = array(
    select field
    from unnest(coalesce(changed_fields, '{}'::text[])) as field
    where field not in ('price_range', 'priceRange')
  )
where phase_results is distinct from pg_temp.dev1540_strip_price_keys(phase_results)
   or changed_fields && array['price_range', 'priceRange']::text[];

-- Model-authored rows were generated under the retired commerce prompts. Human
-- rows survive unless they are the retired price-positioning preset itself.
-- No regeneration is triggered here; a later normal refresh may author new,
-- non-commerce model FAQs under the new prompt contract.
delete from public.brand_faq_entries
where source = 'model'
   or preset_id = 'price-positioning';

-- Drop the physical contract last, after every routine and structured payload
-- that could read or write it has been reconciled.
alter table public.brands
  drop constraint brands_price_range_check;
alter table public.brands
  drop column price_range;
alter table public.brand_ai_results
  drop column price_range;

do $migration$
declare
  v_search regprocedure :=
    'public.search_brand_page(text,text[],text[],text,integer,text,text[])'::regprocedure;
  v_acl text;
begin
  if to_regprocedure(
    'public.search_brand_page(text,text[],text,integer[],integer,text,text[])'
  ) is not null then
    raise exception 'DEV-1540 retired search_brand_page overload remains'
      using errcode = 'P0001';
  end if;

  if pg_get_function_arguments(v_search) is distinct from
    'search_query text, filter_categories text[] DEFAULT NULL::text[], '
    || 'filter_subcategories text[] DEFAULT NULL::text[], '
    || 'filter_verification text DEFAULT NULL::text, '
    || 'page_offset integer DEFAULT 0, sort_mode text DEFAULT ''rank''::text, '
    || 'filter_materials text[] DEFAULT NULL::text[]'
  then
    raise exception 'DEV-1540 search argument contract drifted: %',
      pg_get_function_arguments(v_search)
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from pg_proc p
    where p.oid = v_search
      and p.provolatile = 's'
      and p.prosecdef
      and p.proconfig = array['search_path=public, pg_temp']::text[]
  ) then
    raise exception 'DEV-1540 search must remain STABLE SECURITY DEFINER with its search path'
      using errcode = 'P0001';
  end if;

  select coalesce(array_to_string(p.proacl, ','), '<default>')
  into v_acl
  from pg_proc p
  where p.oid = v_search;
  if v_acl is distinct from 'postgres=X/postgres,service_role=X/postgres' then
    raise exception 'DEV-1540 search ACL is %, expected captured baseline', v_acl
      using errcode = 'P0001';
  end if;
  if has_function_privilege('anon', v_search, 'EXECUTE')
     or has_function_privilege('authenticated', v_search, 'EXECUTE') then
    raise exception 'DEV-1540 search became executable by a public application role'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and column_name = 'price_range'
      and table_name in ('brands', 'brand_ai_results')
  ) then
    raise exception 'DEV-1540 price_range column remains'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from pg_constraint
    where connamespace = 'public'::regnamespace
      and pg_get_constraintdef(oid) ilike '%price_range%'
  ) then
    raise exception 'DEV-1540 active constraint still references price_range'
      using errcode = 'P0001';
  end if;

  if exists (select 1 from public.brand_field_events where field = 'price_range')
     or exists (select 1 from public.brand_field_state where field = 'price_range')
     or exists (select 1 from public.brand_field_corrections where field = 'price_range') then
    raise exception 'DEV-1540 price provenance or correction rows remain'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.brand_faq_entries
    where source = 'model' or preset_id = 'price-positioning'
  ) then
    raise exception 'DEV-1540 retired FAQ rows remain'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.brands
    where draft_data::text ~ '"(price_range|priceRange)"'
  ) or exists (
    select 1 from public.pending_brand_edits
    where proposed_data::text ~ '"(price_range|priceRange)"'
  ) or exists (
    select 1 from public.brand_submissions
    where suggested_tags::text ~ '"(price_range|priceRange)"'
       or validation_errors::text ~ '"(price_range|priceRange)"'
       or enriched_data::text ~ '"(price_range|priceRange)"'
       or enriched_data ? 'faq'
       or owner_data::text ~ '"(price_range|priceRange)"'
       or base_brand_data::text ~ '"(price_range|priceRange)"'
       or review_overrides::text ~ '"(price_range|priceRange)"'
  ) or exists (
    select 1 from public.curation_job_targets
    where phase_results::text ~ '"(price_range|priceRange)"'
       or changed_fields && array['price_range', 'priceRange']::text[]
  ) then
    raise exception 'DEV-1540 structured price keys remain'
      using errcode = 'P0001';
  end if;
end
$migration$;

drop function public.dev1540_assert_function(regprocedure, text);
drop function public.dev1540_replace_exact(text, text, text, integer);

notify pgrst, 'reload schema';

commit;
