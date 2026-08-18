begin;

-- DEV-1503 Wave 3: contract the category/subcategory vocabulary after the
-- application migration. This migration is intentionally guarded by the live
-- function fingerprints captured in docs/reports/2026-08-19-dev-1503-contract-function-baseline.md.

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
  v_definition text;
  v_refresh text;
  v_approve text;
  v_trgm text;
  v_document text;
  v_vector text;
  v_page text;
  v_search text;
  v_provenance text;
begin
  -- The exact 11-function baseline is the refresh wrapper and gate, approval
  -- wrapper and core, review save, provenance trigger, four search functions,
  -- and the search-vector trigger. Hashes make an unexpected live deploy fail
  -- before any function is dropped or any data is rewritten.
  perform public.dev1503_contract_assert_function(
    'public.apply_brand_refresh(uuid,uuid)'::regprocedure,
    '9331b7c422bd3be07e2e36ef2a216bfa'
  );
  perform public.dev1503_contract_assert_function(
    'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure,
    '7ec68dd607613015fb60132db15d7254'
  );
  perform public.dev1503_contract_assert_function(
    'public.approve_submission(uuid,uuid,jsonb)'::regprocedure,
    '47749dd97b335068c7876499cdaf0b84'
  );
  perform public.dev1503_contract_assert_function(
    'public.approve_submission_with_romanized_name(uuid,uuid,jsonb)'::regprocedure,
    '18df85122a581854976dae1a0f333fd6'
  );
  perform public.dev1503_contract_assert_function(
    'public.save_submission_review(uuid,jsonb,jsonb)'::regprocedure,
    'c32ced23f06099734afffc1dff7a6ed9'
  );
  perform public.dev1503_contract_assert_function(
    'public.correct_approved_submission_provenance()'::regprocedure,
    'a79cee856a0e65baee1c16a989c9c749'
  );
  -- The brands content-hash trigger is an additional live dependency, not
  -- one of the plan's exact 11; it has no category/subcategory identifiers.
  perform public.dev1503_contract_assert_function(
    'public.brands_track_content_provenance()'::regprocedure,
    '8e37621a70cd485cbcbed9c2a718c2df'
  );
  perform public.dev1503_contract_assert_function(
    'public.brand_trgm_rank(text,text,text,text,text[],text[],text,text)'::regprocedure,
    'f486811dc9a4913cc0fde31a23883e51'
  );
  perform public.dev1503_contract_assert_function(
    'public.brands_search_document(text,text,text,text[],text[],text,text)'::regprocedure,
    'f5efe3719dbe304fc663076d3acb8ee5'
  );
  perform public.dev1503_contract_assert_function(
    'public.brands_search_vector_update()'::regprocedure,
    '713e2c2b4232e1b9ee488aea02afbe5b'
  );
  perform public.dev1503_contract_assert_function(
    'public.search_brand_page(text,text[],text[],text,integer[],integer,text)'::regprocedure,
    '9fb40a72a528186df1d220ab0a8e0b80'
  );
  perform public.dev1503_contract_assert_function(
    'public.search_brands(text,integer,boolean,text[],text[],text,text,boolean)'::regprocedure,
    '7bcba2c4bd56c0d6ba50988f59e3f80e'
  );

  -- Build all replacement definitions before dropping the search helpers.
  -- Longest tokens are replaced first so product_tags_en is not partially
  -- consumed by the product_tags replacement.
  v_refresh := pg_get_functiondef(
    'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure
  );
  v_refresh := public.dev1503_contract_replace_exact(
    v_refresh, 'product_tags_en', 'subcategories_en', 5
  );
  v_refresh := public.dev1503_contract_replace_exact(
    v_refresh, 'product_tags', 'subcategories', 7
  );
  v_refresh := public.dev1503_contract_replace_exact(
    v_refresh, 'product_type', 'category', 6
  );
  execute v_refresh;

  v_approve := pg_get_functiondef(
    'public.approve_submission(uuid,uuid,jsonb)'::regprocedure
  );
  v_approve := public.dev1503_contract_replace_exact(
    v_approve, 'product_tags_en', 'subcategories_en', 3
  );
  v_approve := public.dev1503_contract_replace_exact(
    v_approve, 'product_tags', 'subcategories', 11
  );
  v_approve := public.dev1503_contract_replace_exact(
    v_approve, 'product_type', 'category', 9
  );
  execute v_approve;

  v_provenance := pg_get_functiondef(
    'public.correct_approved_submission_provenance()'::regprocedure
  );
  v_provenance := public.dev1503_contract_replace_exact(
    v_provenance, 'product_tags_en', 'subcategories_en', 0
  );
  v_provenance := public.dev1503_contract_replace_exact(
    v_provenance, 'product_tags', 'subcategories', 2
  );
  v_provenance := public.dev1503_contract_replace_exact(
    v_provenance, 'product_type', 'category', 2
  );
  v_provenance := public.dev1503_contract_replace_exact(
    v_provenance, 'productTagsEn', 'subcategoriesEn', 0
  );
  v_provenance := public.dev1503_contract_replace_exact(
    v_provenance, 'productTags', 'subcategories', 1
  );
  v_provenance := public.dev1503_contract_replace_exact(
    v_provenance, 'productType', 'categorySlug', 2
  );
  -- suggested_tags is stored in the snake-shaped service boundary, while
  -- owner_data is form-shaped. Keep those two final contracts distinct.
  v_provenance := public.dev1503_contract_replace_exact(
    v_provenance,
    'suggested_tags -> ''categorySlug''',
    'suggested_tags -> ''category''',
    1
  );
  execute v_provenance;

  v_trgm := pg_get_functiondef(
    'public.brand_trgm_rank(text,text,text,text,text[],text[],text,text)'::regprocedure
  );
  v_trgm := public.dev1503_contract_replace_exact(
    v_trgm, 'product_tags_en', 'subcategories_en', 2
  );
  v_trgm := public.dev1503_contract_replace_exact(
    v_trgm, 'product_tags', 'subcategories', 2
  );
  v_trgm := public.dev1503_contract_replace_exact(
    v_trgm, 'product_type', 'category', 2
  );

  v_document := pg_get_functiondef(
    'public.brands_search_document(text,text,text,text[],text[],text,text)'::regprocedure
  );
  v_document := public.dev1503_contract_replace_exact(
    v_document, 'product_tags_en', 'subcategories_en', 2
  );
  v_document := public.dev1503_contract_replace_exact(
    v_document, 'product_tags', 'subcategories', 3
  );
  v_document := public.dev1503_contract_replace_exact(
    v_document, 'product_type', 'category', 2
  );

  v_vector := pg_get_functiondef(
    'public.brands_search_vector_update()'::regprocedure
  );
  v_vector := public.dev1503_contract_replace_exact(
    v_vector, 'product_tags_en', 'subcategories_en', 1
  );
  v_vector := public.dev1503_contract_replace_exact(
    v_vector, 'product_tags', 'subcategories', 1
  );
  v_vector := public.dev1503_contract_replace_exact(
    v_vector, 'product_type', 'category', 1
  );

  v_page := pg_get_functiondef(
    'public.search_brand_page(text,text[],text[],text,integer[],integer,text)'::regprocedure
  );
  v_page := public.dev1503_contract_replace_exact(
    v_page, 'product_tags_en', 'subcategories_en', 1
  );
  v_page := public.dev1503_contract_replace_exact(
    v_page, 'product_tags', 'subcategories', 2
  );
  v_page := public.dev1503_contract_replace_exact(
    v_page, 'product_type', 'category', 2
  );
  v_page := public.dev1503_contract_replace_exact(
    v_page, 'filter_tags', 'filter_subcategories', 4
  );

  v_search := pg_get_functiondef(
    'public.search_brands(text,integer,boolean,text[],text[],text,text,boolean)'::regprocedure
  );
  v_search := public.dev1503_contract_replace_exact(
    v_search, 'product_tags_en', 'subcategories_en', 2
  );
  v_search := public.dev1503_contract_replace_exact(
    v_search, 'product_tags', 'subcategories', 2
  );
  v_search := public.dev1503_contract_replace_exact(
    v_search, 'product_type', 'category', 6
  );
  v_search := public.dev1503_contract_replace_exact(
    v_search, 'filter_tags', 'filter_subcategories', 1
  );

  -- Parameter names are part of the PostgREST RPC contract, so the four
  -- parameterized helpers must be rebuilt rather than replaced in place.
  drop trigger if exists brands_search_vector_trigger on public.brands;
  drop function public.search_brands(text,integer,boolean,text[],text[],text,text,boolean);
  drop function public.search_brand_page(text,text[],text[],text,integer[],integer,text);
  drop function public.brand_trgm_rank(text,text,text,text,text[],text[],text,text);
  drop function public.brands_search_vector_update();
  drop function public.brands_search_document(text,text,text,text[],text[],text,text);

  execute v_document;
  execute v_trgm;
  execute v_page;
  execute v_search;
  execute v_vector;

  -- Dropping a function removes explicit ACL rows, so restore the baseline
  -- owner grants exactly. PUBLIC, anon, and authenticated remain denied.
  revoke all on function public.brands_search_document(text,text,text,text[],text[],text,text)
    from public, anon, authenticated;
  grant execute on function public.brands_search_document(text,text,text,text[],text[],text,text)
    to postgres, service_role;
  revoke all on function public.brand_trgm_rank(text,text,text,text,text[],text[],text,text)
    from public, anon, authenticated;
  grant execute on function public.brand_trgm_rank(text,text,text,text,text[],text[],text,text)
    to postgres, service_role;
  revoke all on function public.search_brand_page(text,text[],text[],text,integer[],integer,text)
    from public, anon, authenticated;
  grant execute on function public.search_brand_page(text,text[],text[],text,integer[],integer,text)
    to postgres, service_role;
  revoke all on function public.search_brands(text,integer,boolean,text[],text[],text,text,boolean)
    from public, anon, authenticated;
  grant execute on function public.search_brands(text,integer,boolean,text[],text[],text,text,boolean)
    to postgres, service_role;
  revoke all on function public.brands_search_vector_update() from public, anon, authenticated;
  grant execute on function public.brands_search_vector_update() to postgres, service_role;

  if (length(pg_get_functiondef(
    'public.brands_search_document(text,text,text,text[],text[],text,text)'::regprocedure
  )) - length(replace(pg_get_functiondef(
    'public.brands_search_document(text,text,text,text[],text[],text,text)'::regprocedure
  ), '''B''', ''))) / 3 <> 1 then
    raise exception 'DEV-1503 search document category weight B changed' using errcode = 'P0001';
  end if;
  if (length(pg_get_functiondef(
    'public.brands_search_document(text,text,text,text[],text[],text,text)'::regprocedure
  )) - length(replace(pg_get_functiondef(
    'public.brands_search_document(text,text,text,text[],text[],text,text)'::regprocedure
  ), '''C''', ''))) / 3 <> 3 then
    raise exception 'DEV-1503 search document subcategory weight C changed' using errcode = 'P0001';
  end if;
  if (length(pg_get_functiondef(
    'public.brand_trgm_rank(text,text,text,text,text[],text[],text,text)'::regprocedure
  )) - length(replace(pg_get_functiondef(
    'public.brand_trgm_rank(text,text,text,text,text[],text[],text,text)'::regprocedure
  ), '* 0.8', ''))) / 5 <> 1 then
    raise exception 'DEV-1503 category trigram multiplier changed' using errcode = 'P0001';
  end if;
  if (length(pg_get_functiondef(
    'public.brand_trgm_rank(text,text,text,text,text[],text[],text,text)'::regprocedure
  )) - length(replace(pg_get_functiondef(
    'public.brand_trgm_rank(text,text,text,text,text[],text[],text,text)'::regprocedure
  ), '* 0.6', ''))) / 5 <> 2 then
    raise exception 'DEV-1503 subcategory trigram multiplier changed' using errcode = 'P0001';
  end if;
end
$migration$;

-- The PR2 bridge table becomes a final-vocabulary table. Keep the first
-- canonical translation for each subcategory and preserve the old created_at.
create table public.subcategory_translations (
  subcategory text primary key,
  translation text not null,
  created_at timestamptz default now()
);
alter table public.subcategory_translations enable row level security;
create policy subcategory_translations_public_read
  on public.subcategory_translations for select
  using (true);
revoke all on table public.subcategory_translations from public, anon, authenticated;
grant all on table public.subcategory_translations to postgres, service_role;

insert into public.subcategory_translations (subcategory, translation, created_at)
select tag_zh, tag_en, created_at
from public.product_tag_translations
order by created_at nulls first, tag_zh;

create or replace function public.canonicalize_subcategory_translations(
  p_subcategories text[],
  p_subcategories_en text[]
)
returns text[]
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_index integer;
  v_subcategory text;
  v_translation text;
  v_canonical_translation text;
  v_result text[] := array[]::text[];
begin
  if p_subcategories is null or array_length(p_subcategories, 1) is null then
    return v_result;
  end if;

  for v_index in 1..array_length(p_subcategories, 1) loop
    v_subcategory := p_subcategories[v_index];
    v_translation := coalesce(p_subcategories_en[v_index], v_subcategory);

    insert into public.subcategory_translations (subcategory, translation)
    values (v_subcategory, v_translation)
    on conflict (subcategory) do nothing;

    select translation.translation
      into v_canonical_translation
      from public.subcategory_translations as translation
     where translation.subcategory = v_subcategory;

    v_result := array_append(
      v_result,
      coalesce(v_canonical_translation, v_subcategory)
    );
  end loop;

  return v_result;
end;
$function$;

revoke all on function public.canonicalize_subcategory_translations(text[], text[])
  from public, anon, authenticated;
grant execute on function public.canonicalize_subcategory_translations(text[], text[])
  to service_role;

do $migration$
begin
  if (select count(*) from public.subcategory_translations)
     <> (select count(*) from public.product_tag_translations) then
    raise exception 'DEV-1503 translation migration lost rows' using errcode = 'P0001';
  end if;
end
$migration$;

-- Stop compatibility triggers before canonicalizing the JSON. Otherwise the
-- Wave 1 trigger would immediately add the removed aliases back.
drop trigger if exists brands_category_subcategory_sync on public.brands;
drop trigger if exists brand_ai_results_category_subcategory_sync on public.brand_ai_results;
drop trigger if exists brand_submissions_category_subcategory_sync on public.brand_submissions;
drop trigger if exists brand_submissions_category_subcategory_json_sync on public.brand_submissions;

create or replace function public.dev1503_contract_submission_json(
  p_json jsonb,
  p_suggested_tags boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_result jsonb := p_json;
  v_value jsonb;
  v_cleared jsonb;
  v_item jsonb;
  v_key text;
  v_alias text;
  v_has_value boolean;
  v_keep_snake boolean;
  v_keep_camel boolean;
begin
  if p_json is null or jsonb_typeof(p_json) <> 'object' then
    return p_json;
  end if;

  -- Category accepts both the old snake/form keys and the two final shape
  -- keys. Preserve whichever final shape was present in the source object.
  v_value := null;
  v_has_value := false;
  foreach v_alias in array array['product_type', 'category', 'productType', 'categorySlug'] loop
    if v_result ? v_alias and jsonb_typeof(v_result -> v_alias) <> 'null' then
      if v_has_value and v_value is distinct from v_result -> v_alias then
        raise exception 'DEV-1503 conflicting category JSON aliases: %', v_alias
          using errcode = 'P0001';
      end if;
      v_value := v_result -> v_alias;
      v_has_value := true;
    end if;
  end loop;
  v_keep_snake := v_result ? 'category' or v_result ? 'product_type';
  v_keep_camel := v_result ? 'categorySlug' or v_result ? 'productType';
  if p_suggested_tags then
    -- suggested_tags is the persisted snake-shaped contract, even when a
    -- legacy form-shaped key was supplied by an older writer.
    v_keep_snake := v_has_value or v_keep_snake or v_keep_camel;
    v_keep_camel := false;
  end if;
  if v_has_value or v_keep_snake then
    v_result := jsonb_set(v_result, array['category'], coalesce(v_value, 'null'::jsonb), true);
  end if;
  if v_has_value or v_keep_camel then
    v_result := jsonb_set(v_result, array['categorySlug'], coalesce(v_value, 'null'::jsonb), true);
  end if;
  v_result := v_result - 'product_type' - 'productType';

  -- The zh-TW L2 key is shared by snake and form contracts.
  v_value := null;
  v_has_value := false;
  foreach v_alias in array array['product_tags', 'subcategories', 'productTags'] loop
    if v_result ? v_alias and jsonb_typeof(v_result -> v_alias) <> 'null' then
      if v_has_value and v_value is distinct from v_result -> v_alias then
        raise exception 'DEV-1503 conflicting subcategory JSON aliases: %', v_alias
          using errcode = 'P0001';
      end if;
      v_value := v_result -> v_alias;
      v_has_value := true;
    end if;
  end loop;
  if v_has_value or v_result ? 'product_tags' or v_result ? 'subcategories'
    or v_result ? 'productTags' then
    v_result := jsonb_set(v_result, array['subcategories'], coalesce(v_value, 'null'::jsonb), true);
  end if;
  v_result := v_result - 'product_tags' - 'productTags';

  -- English L2 keeps snake/form final keys when both shapes are present.
  v_value := null;
  v_has_value := false;
  foreach v_alias in array array['product_tags_en', 'subcategories_en', 'productTagsEn', 'subcategoriesEn'] loop
    if v_result ? v_alias and jsonb_typeof(v_result -> v_alias) <> 'null' then
      if v_has_value and v_value is distinct from v_result -> v_alias then
        raise exception 'DEV-1503 conflicting English subcategory JSON aliases: %', v_alias
          using errcode = 'P0001';
      end if;
      v_value := v_result -> v_alias;
      v_has_value := true;
    end if;
  end loop;
  v_keep_snake := v_result ? 'subcategories_en' or v_result ? 'product_tags_en';
  v_keep_camel := v_result ? 'subcategoriesEn' or v_result ? 'productTagsEn';
  if p_suggested_tags then
    v_keep_snake := v_has_value or v_keep_snake or v_keep_camel;
    v_keep_camel := false;
  end if;
  if v_has_value or v_keep_snake then
    v_result := jsonb_set(v_result, array['subcategories_en'], coalesce(v_value, 'null'::jsonb), true);
  end if;
  if v_has_value or v_keep_camel then
    v_result := jsonb_set(v_result, array['subcategoriesEn'], coalesce(v_value, 'null'::jsonb), true);
  end if;
  v_result := v_result - 'product_tags_en' - 'productTagsEn';

  -- suggested_tags has a historical `values` wrapper. Keep it, and expose the
  -- final `subcategories` alias if the object contained a tag list.
  if p_suggested_tags then
    v_value := null;
    v_has_value := false;
    foreach v_alias in array array['values', 'product_tags', 'subcategories', 'productTags'] loop
      if v_result ? v_alias and jsonb_typeof(v_result -> v_alias) <> 'null' then
        if v_has_value and v_value is distinct from v_result -> v_alias then
          raise exception 'DEV-1503 conflicting suggested subcategory aliases: %', v_alias
            using errcode = 'P0001';
        end if;
        v_value := v_result -> v_alias;
        v_has_value := true;
      end if;
    end loop;
    if v_has_value and (v_result ? 'product_tags' or v_result ? 'subcategories'
      or v_result ? 'productTags') then
      v_result := jsonb_set(v_result, array['subcategories'], v_value, true);
    end if;
    v_result := v_result - 'product_tags' - 'productTags';
  end if;

  if v_result ? '_cleared_fields'
    and jsonb_typeof(v_result -> '_cleared_fields') = 'array' then
    v_cleared := '[]'::jsonb;
    for v_item in select value from jsonb_array_elements(v_result -> '_cleared_fields') as field(value) loop
      if jsonb_typeof(v_item) <> 'string' then
        v_cleared := v_cleared || jsonb_build_array(v_item);
        continue;
      end if;
      v_key := v_item #>> '{}';
      v_key := case v_key
        when 'product_type' then 'category'
        when 'productType' then case when p_suggested_tags then 'category' else 'categorySlug' end
        when 'categorySlug' then case when p_suggested_tags then 'category' else 'categorySlug' end
        when 'product_tags' then 'subcategories'
        when 'productTags' then 'subcategories'
        when 'product_tags_en' then 'subcategories_en'
        when 'productTagsEn' then case when p_suggested_tags then 'subcategories_en' else 'subcategoriesEn' end
        when 'subcategoriesEn' then case when p_suggested_tags then 'subcategories_en' else 'subcategoriesEn' end
        else v_key
      end;
      if not (v_cleared ? v_key) then
        v_cleared := v_cleared || jsonb_build_array(v_key);
      end if;
    end loop;
    v_result := jsonb_set(v_result, array['_cleared_fields'], v_cleared, true);
  end if;

  return v_result;
end;
$function$;

-- Canonicalize all persisted submission containers before the legacy columns
-- disappear. Historical brand_ai_results.input/raw_response are untouched.
update public.brand_submissions
set enriched_data = public.dev1503_contract_submission_json(enriched_data),
    review_overrides = public.dev1503_contract_submission_json(review_overrides),
    base_brand_data = public.dev1503_contract_submission_json(base_brand_data),
    owner_data = public.dev1503_contract_submission_json(owner_data),
    suggested_tags = public.dev1503_contract_submission_json(suggested_tags, true)
where enriched_data is not null
   or review_overrides is not null
   or base_brand_data is not null
   or owner_data is not null
   or suggested_tags is not null;

-- Backfill target columns again under the Contract transaction, without
-- changing brands.updated_at. The assertion catches any mixed-version drift.
alter table public.brands disable trigger brands_updated_at;
update public.brands
set category = product_type,
    subcategories = product_tags,
    subcategories_en = product_tags_en
where category is distinct from product_type
   or subcategories is distinct from product_tags
   or subcategories_en is distinct from product_tags_en;
alter table public.brands enable trigger brands_updated_at;

update public.brand_ai_results
set category = product_type,
    subcategories = product_tags
where category is distinct from product_type
   or subcategories is distinct from product_tags;

update public.brand_submissions
set category_note = product_type_note
where category_note is distinct from product_type_note;

do $migration$
begin
  if exists (
    select 1 from public.brands
    where category is distinct from product_type
       or subcategories is distinct from product_tags
       or subcategories_en is distinct from product_tags_en
  ) then
    raise exception 'DEV-1503 contract brand backfill mismatch' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.brand_ai_results
    where category is distinct from product_type
       or subcategories is distinct from product_tags
  ) then
    raise exception 'DEV-1503 contract AI backfill mismatch' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.brand_submissions
    where category_note is distinct from product_type_note
  ) then
    raise exception 'DEV-1503 contract submission note mismatch' using errcode = 'P0001';
  end if;
end
$migration$;

-- Deterministic state collision resolution. Owner protection dominates, then
-- admin, submitted, enriched; newer updates win and final-name rows win a
-- stable tie. The same rule is applied independently to the zh/en pair so an
-- owner row can never be replaced by an enriched row during contraction.
create temporary table dev1503_state_winners on commit drop as
select distinct on (brand_id, final_field)
  brand_id,
  final_field,
  source,
  updated_by,
  updated_at,
  admin_locked
from (
  select
    state.brand_id,
    case state.field
      when 'product_type' then 'category'
      when 'product_tags' then 'subcategories'
      when 'product_tags_en' then 'subcategories_en'
      else state.field
    end as final_field,
    state.field,
    state.source,
    state.updated_by,
    state.updated_at,
    state.admin_locked,
    case state.source
      when 'owner' then 4
      when 'admin' then 3
      when 'submitted' then 2
      when 'enriched' then 1
      else 0
    end as source_priority
  from public.brand_field_state as state
  where state.field in (
    'product_type', 'category', 'product_tags', 'subcategories',
    'product_tags_en', 'subcategories_en'
  )
) as candidates
order by brand_id, final_field, source_priority desc, updated_at desc,
  (field = final_field) desc, field;

delete from public.brand_field_state
where field in (
  'product_type', 'category', 'product_tags', 'subcategories',
  'product_tags_en', 'subcategories_en'
);
insert into public.brand_field_state (
  brand_id, field, source, updated_by, updated_at, admin_locked
)
select brand_id, final_field, source, updated_by, updated_at, admin_locked
from dev1503_state_winners;

update public.brand_field_events
set field = case field
  when 'product_type' then 'category'
  when 'product_tags' then 'subcategories'
  when 'product_tags_en' then 'subcategories_en'
  else field
end
where field in ('product_type', 'product_tags', 'product_tags_en');

-- Pending corrections have a partial unique key. Keep the newest pending
-- proposal (stable id tie-break), then map all historical identifiers.
with pending_ranked as (
  select id,
    row_number() over (
      partition by brand_id, visitor_hash,
        case field
          when 'product_type' then 'category'
          when 'product_tags' then 'subcategories'
          when 'product_tags_en' then 'subcategories_en'
          else field
        end
      order by created_at desc, id desc
    ) as row_number
  from public.brand_field_corrections
  where status = 'pending'
    -- The partial unique index treats NULL visitor hashes as distinct. Only
    -- rank rows that can actually collide under that index; otherwise mapping
    -- would silently discard anonymous pending corrections.
    and visitor_hash is not null
    and field in ('product_type', 'category', 'product_tags', 'subcategories',
                  'product_tags_en', 'subcategories_en')
)
delete from public.brand_field_corrections as correction
using pending_ranked
where correction.id = pending_ranked.id
  and pending_ranked.row_number > 1;

update public.brand_field_corrections
set field = case field
  when 'product_type' then 'category'
  when 'product_tags' then 'subcategories'
  when 'product_tags_en' then 'subcategories_en'
  else field
end
where field in ('product_type', 'product_tags', 'product_tags_en');

alter table public.brand_field_corrections
  drop constraint brand_field_corrections_field_check;
alter table public.brand_field_corrections
  add constraint brand_field_corrections_field_check
  check (field in (
    'price_range', 'category', 'subcategories',
    'purchase_website', 'purchase_pinkoi', 'purchase_shopee',
    'purchase_myship', 'social_instagram', 'social_threads',
    'social_facebook'
  ));

do $migration$
begin
  if exists (
    select 1 from public.brand_field_state
    where field in ('product_type', 'product_tags', 'product_tags_en')
  ) or exists (
    select 1 from public.brand_field_events
    where field in ('product_type', 'product_tags', 'product_tags_en')
  ) or exists (
    select 1 from public.brand_field_corrections
    where field in ('product_type', 'product_tags', 'product_tags_en')
  ) then
    raise exception 'DEV-1503 persisted identifiers remain after contraction' using errcode = 'P0001';
  end if;
end
$migration$;

-- Remove temporary JSON and SQL compatibility surfaces before dropping their
-- underlying columns. The dead tag-slug trigger function has no live trigger.
drop function public.sync_brands_category_subcategory_columns();
drop function public.sync_brand_ai_results_category_subcategory_columns();
drop function public.sync_brand_submission_category_note();
drop function public.sync_submission_json_alias_group(jsonb, text[]);
drop function public.sync_submission_json_aliases(jsonb);
drop function public.sync_submission_suggested_tags_aliases(jsonb);
drop function public.sync_brand_submission_category_subcategory_aliases();
do $migration$
begin
  if exists (
    select 1
    from pg_trigger
    where not tgisinternal
      and tgfoid = 'public.sync_brand_tag_slugs()'::regprocedure
  ) then
    raise exception 'DEV-1503 cannot drop live sync_brand_tag_slugs trigger' using errcode = 'P0001';
  end if;
end
$migration$;
drop function if exists public.sync_brand_tag_slugs();
drop function public.dev1503_contract_submission_json(jsonb, boolean);

-- Contract the physical columns and compatibility indexes/constraints only
-- after all live functions and rows use final names.
alter table public.brands drop constraint brands_product_type_check;
drop index if exists public.idx_brands_product_type;
drop index if exists public.idx_brands_product_tags;
alter table public.brands
  drop column product_type,
  drop column product_tags,
  drop column product_tags_en;

alter table public.brand_ai_results
  drop column product_type,
  drop column product_tags;

alter table public.brand_submissions
  drop column product_type_note;

comment on column public.brands.category is null;
comment on column public.brands.subcategories is null;
comment on column public.brands.subcategories_en is null;
comment on column public.brand_ai_results.category is null;
comment on column public.brand_ai_results.subcategories is null;
comment on column public.brand_submissions.category_note is null;

-- Recreate the vector trigger against final columns and recompute vectors with
-- only the timestamp trigger disabled. No brand timestamp may move.
create trigger brands_search_vector_trigger
before insert or update of
  name, slug, category, subcategories, subcategories_en, description, blurb_en
on public.brands
for each row execute function public.brands_search_vector_update();

create temporary table dev1503_updated_at_snapshot on commit drop as
select id, updated_at from public.brands;
alter table public.brands disable trigger brands_updated_at;
update public.brands
set search_vector = public.brands_search_document(
  name, slug, category, subcategories, subcategories_en, description, blurb_en
);
alter table public.brands enable trigger brands_updated_at;

do $migration$
begin
  if exists (
    select 1
    from public.brands as brand
    join dev1503_updated_at_snapshot as snapshot on snapshot.id = brand.id
    where brand.updated_at is distinct from snapshot.updated_at
  ) then
    raise exception 'DEV-1503 vector recompute changed brands.updated_at' using errcode = 'P0001';
  end if;
end
$migration$;

do $migration$
begin
  if exists (
    select 1 from public.brand_submissions
    where enriched_data::text ~* '(product_type|product_tags|productType|productTags|productTagsEn|product_tags_en)'
       or review_overrides::text ~* '(product_type|product_tags|productType|productTags|productTagsEn|product_tags_en)'
       or base_brand_data::text ~* '(product_type|product_tags|productType|productTags|productTagsEn|product_tags_en)'
       or owner_data::text ~* '(product_type|product_tags|productType|productTags|productTagsEn|product_tags_en)'
       or suggested_tags::text ~* '(product_type|product_tags|productType|productTags|productTagsEn|product_tags_en)'
  ) then
    raise exception 'DEV-1503 legacy submission JSON key remains' using errcode = 'P0001';
  end if;
end
$migration$;

drop table public.product_tag_translations;
drop function public.dev1503_contract_assert_function(regprocedure, text);
drop function public.dev1503_contract_replace_exact(text, text, text, integer);

commit;
