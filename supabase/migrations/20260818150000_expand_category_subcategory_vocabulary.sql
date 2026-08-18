begin;

-- DEV-1503 Wave 1: keep the legacy vocabulary as the active contract while
-- adding the final names beside it. The migrate wave will move callers to the
-- target columns; the contract wave will remove this bridge.

alter table public.brands
  add column if not exists category text,
  add column if not exists subcategories text[],
  add column if not exists subcategories_en text[];

alter table public.brand_ai_results
  add column if not exists category text,
  add column if not exists subcategories text[];

alter table public.brand_submissions
  add column if not exists category_note text;

comment on column public.brands.category is
  'DEV-1503 expand target for product_type; synchronized until contract';
comment on column public.brands.subcategories is
  'DEV-1503 expand target for product_tags; synchronized until contract';
comment on column public.brands.subcategories_en is
  'DEV-1503 expand target for product_tags_en; synchronized until contract';
comment on column public.brand_ai_results.category is
  'DEV-1503 expand target for product_type; synchronized until contract';
comment on column public.brand_ai_results.subcategories is
  'DEV-1503 expand target for product_tags; synchronized until contract';
comment on column public.brand_submissions.category_note is
  'DEV-1503 expand target for product_type_note; synchronized until contract';

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.brands'::regclass
      and conname = 'brands_category_check'
  ) then
    alter table public.brands
      add constraint brands_category_check
      check (category in (
        'fashion', 'bags-accessories', 'jewelry', 'beauty', 'home',
        'food-drink', 'crafts', 'stationery', 'tech', 'outdoor',
        'fitness', 'kids-pets'
      ));
  end if;
end
$migration$;

create index if not exists idx_brands_category
  on public.brands (category);
create index if not exists idx_brands_subcategories
  on public.brands using gin (subcategories);
create index if not exists idx_brands_subcategories_en
  on public.brands using gin (subcategories_en);
create index if not exists idx_brand_ai_results_category
  on public.brand_ai_results (category);
create index if not exists idx_brand_ai_results_subcategories
  on public.brand_ai_results using gin (subcategories);

-- A single trigger function cannot safely assign fields on different table
-- composite types, so the three physical-table bridges are explicit. UPDATE
-- uses OLD to distinguish a one-sided write from a conflicting dual write.
create or replace function public.sync_brands_category_subcategory_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_legacy_changed boolean;
  v_target_changed boolean;
begin
  if tg_op = 'INSERT' then
    if new.product_type is not null
      and new.category is not null
      and new.product_type is distinct from new.category then
      raise exception
        'Conflicting category values on public.brands: product_type and category differ'
        using errcode = 'P0001';
    end if;
    if new.product_tags is not null
      and new.subcategories is not null
      and new.product_tags is distinct from new.subcategories then
      raise exception
        'Conflicting subcategory values on public.brands: product_tags and subcategories differ'
        using errcode = 'P0001';
    end if;
    if new.product_tags_en is not null
      and new.subcategories_en is not null
      and new.product_tags_en is distinct from new.subcategories_en then
      raise exception
        'Conflicting English subcategory values on public.brands: product_tags_en and subcategories_en differ'
        using errcode = 'P0001';
    end if;

    new.product_type := coalesce(new.product_type, new.category);
    new.category := coalesce(new.category, new.product_type);
    new.product_tags := coalesce(new.product_tags, new.subcategories);
    new.subcategories := coalesce(new.subcategories, new.product_tags);
    new.product_tags_en := coalesce(new.product_tags_en, new.subcategories_en);
    new.subcategories_en := coalesce(new.subcategories_en, new.product_tags_en);
    return new;
  end if;

  v_legacy_changed := new.product_type is distinct from old.product_type;
  v_target_changed := new.category is distinct from old.category;
  if v_legacy_changed and v_target_changed then
    if new.product_type is distinct from new.category then
      raise exception
        'Conflicting category values on public.brands: product_type and category differ'
        using errcode = 'P0001';
    end if;
  elsif v_legacy_changed then
    new.category := new.product_type;
  elsif v_target_changed then
    new.product_type := new.category;
  elsif new.product_type is distinct from new.category then
    raise exception
      'Conflicting category values on public.brands: product_type and category differ'
      using errcode = 'P0001';
  end if;

  v_legacy_changed := new.product_tags is distinct from old.product_tags;
  v_target_changed := new.subcategories is distinct from old.subcategories;
  if v_legacy_changed and v_target_changed then
    if new.product_tags is distinct from new.subcategories then
      raise exception
        'Conflicting subcategory values on public.brands: product_tags and subcategories differ'
        using errcode = 'P0001';
    end if;
  elsif v_legacy_changed then
    new.subcategories := new.product_tags;
  elsif v_target_changed then
    new.product_tags := new.subcategories;
  elsif new.product_tags is distinct from new.subcategories then
    raise exception
      'Conflicting subcategory values on public.brands: product_tags and subcategories differ'
      using errcode = 'P0001';
  end if;

  v_legacy_changed := new.product_tags_en is distinct from old.product_tags_en;
  v_target_changed := new.subcategories_en is distinct from old.subcategories_en;
  if v_legacy_changed and v_target_changed then
    if new.product_tags_en is distinct from new.subcategories_en then
      raise exception
        'Conflicting English subcategory values on public.brands: product_tags_en and subcategories_en differ'
        using errcode = 'P0001';
    end if;
  elsif v_legacy_changed then
    new.subcategories_en := new.product_tags_en;
  elsif v_target_changed then
    new.product_tags_en := new.subcategories_en;
  elsif new.product_tags_en is distinct from new.subcategories_en then
    raise exception
      'Conflicting English subcategory values on public.brands: product_tags_en and subcategories_en differ'
      using errcode = 'P0001';
  end if;

  return new;
end;
$function$;

create or replace function public.sync_brand_ai_results_category_subcategory_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_legacy_changed boolean;
  v_target_changed boolean;
begin
  if tg_op = 'INSERT' then
    if new.product_type is not null
      and new.category is not null
      and new.product_type is distinct from new.category then
      raise exception
        'Conflicting category values on public.brand_ai_results: product_type and category differ'
        using errcode = 'P0001';
    end if;
    if new.product_tags is not null
      and new.subcategories is not null
      and new.product_tags is distinct from new.subcategories then
      raise exception
        'Conflicting subcategory values on public.brand_ai_results: product_tags and subcategories differ'
        using errcode = 'P0001';
    end if;

    new.product_type := coalesce(new.product_type, new.category);
    new.category := coalesce(new.category, new.product_type);
    new.product_tags := coalesce(new.product_tags, new.subcategories);
    new.subcategories := coalesce(new.subcategories, new.product_tags);
    return new;
  end if;

  v_legacy_changed := new.product_type is distinct from old.product_type;
  v_target_changed := new.category is distinct from old.category;
  if v_legacy_changed and v_target_changed then
    if new.product_type is distinct from new.category then
      raise exception
        'Conflicting category values on public.brand_ai_results: product_type and category differ'
        using errcode = 'P0001';
    end if;
  elsif v_legacy_changed then
    new.category := new.product_type;
  elsif v_target_changed then
    new.product_type := new.category;
  elsif new.product_type is distinct from new.category then
    raise exception
      'Conflicting category values on public.brand_ai_results: product_type and category differ'
      using errcode = 'P0001';
  end if;

  v_legacy_changed := new.product_tags is distinct from old.product_tags;
  v_target_changed := new.subcategories is distinct from old.subcategories;
  if v_legacy_changed and v_target_changed then
    if new.product_tags is distinct from new.subcategories then
      raise exception
        'Conflicting subcategory values on public.brand_ai_results: product_tags and subcategories differ'
        using errcode = 'P0001';
    end if;
  elsif v_legacy_changed then
    new.subcategories := new.product_tags;
  elsif v_target_changed then
    new.product_tags := new.subcategories;
  elsif new.product_tags is distinct from new.subcategories then
    raise exception
      'Conflicting subcategory values on public.brand_ai_results: product_tags and subcategories differ'
      using errcode = 'P0001';
  end if;

  return new;
end;
$function$;

create or replace function public.sync_brand_submission_category_note()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_legacy_changed boolean;
  v_target_changed boolean;
begin
  if tg_op = 'INSERT' then
    if new.product_type_note is not null
      and new.category_note is not null
      and new.product_type_note is distinct from new.category_note then
      raise exception
        'Conflicting category note values on public.brand_submissions: product_type_note and category_note differ'
        using errcode = 'P0001';
    end if;
    new.product_type_note := coalesce(new.product_type_note, new.category_note);
    new.category_note := coalesce(new.category_note, new.product_type_note);
    return new;
  end if;

  v_legacy_changed := new.product_type_note is distinct from old.product_type_note;
  v_target_changed := new.category_note is distinct from old.category_note;
  if v_legacy_changed and v_target_changed then
    if new.product_type_note is distinct from new.category_note then
      raise exception
        'Conflicting category note values on public.brand_submissions: product_type_note and category_note differ'
        using errcode = 'P0001';
    end if;
  elsif v_legacy_changed then
    new.category_note := new.product_type_note;
  elsif v_target_changed then
    new.product_type_note := new.category_note;
  elsif new.product_type_note is distinct from new.category_note then
    raise exception
      'Conflicting category note values on public.brand_submissions: product_type_note and category_note differ'
      using errcode = 'P0001';
  end if;

  return new;
end;
$function$;

-- JSON aliases are grouped rather than paired because the zh-TW
-- `subcategories` key is shared by the snake_case and form-shaped contracts.
create or replace function public.sync_submission_json_alias_group(
  p_json jsonb,
  p_aliases text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_result jsonb := p_json;
  v_chosen jsonb;
  v_chosen_alias text;
  v_alias text;
  v_index integer;
  v_has_value boolean := false;
  v_has_alias boolean := false;
  v_alias_count integer;
begin
  if p_json is null or jsonb_typeof(p_json) <> 'object' then
    return p_json;
  end if;

  v_alias_count := coalesce(array_length(p_aliases, 1), 0);
  if v_alias_count = 0 then
    return p_json;
  end if;

  for v_index in 1..v_alias_count loop
    v_alias := p_aliases[v_index];
    if p_json ? v_alias then
      v_has_alias := true;
      if jsonb_typeof(p_json -> v_alias) <> 'null' then
        if v_has_value and v_chosen is distinct from (p_json -> v_alias) then
          raise exception
            'Conflicting submission JSON aliases: % and % contain different values',
            v_chosen_alias, v_alias
            using errcode = 'P0001',
              detail = format('Aliases: %s', array_to_string(p_aliases, ', '));
        end if;
        if not v_has_value then
          v_chosen := p_json -> v_alias;
          v_chosen_alias := v_alias;
          v_has_value := true;
        end if;
      end if;
    end if;
  end loop;

  if v_has_value then
    for v_index in 1..v_alias_count loop
      v_alias := p_aliases[v_index];
      v_result := jsonb_set(v_result, array[v_alias], v_chosen, true);
    end loop;
  elsif v_has_alias then
    -- Preserve an explicit JSON null while making the alias set complete.
    for v_index in 1..v_alias_count loop
      v_alias := p_aliases[v_index];
      v_result := jsonb_set(v_result, array[v_alias], 'null'::jsonb, true);
    end loop;
  end if;

  return v_result;
end;
$function$;

create or replace function public.sync_submission_json_aliases(p_json jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_result jsonb := p_json;
  v_entry record;
  v_alias text;
  v_aliases text[];
  v_cleared jsonb;
  v_field text;
begin
  if p_json is null or jsonb_typeof(p_json) <> 'object' then
    return p_json;
  end if;

  v_result := public.sync_submission_json_alias_group(
    v_result,
    array['product_type', 'category', 'productType', 'categorySlug']
  );
  v_result := public.sync_submission_json_alias_group(
    v_result,
    array['product_tags', 'subcategories', 'productTags']
  );
  v_result := public.sync_submission_json_alias_group(
    v_result,
    array['product_tags_en', 'subcategories_en', 'productTagsEn', 'subcategoriesEn']
  );

  if v_result ? '_cleared_fields'
    and jsonb_typeof(v_result -> '_cleared_fields') = 'array' then
    v_cleared := '[]'::jsonb;
    for v_entry in
      select value
      from jsonb_array_elements(v_result -> '_cleared_fields') as entry(value)
    loop
      if jsonb_typeof(v_entry.value) <> 'string' then
        v_cleared := v_cleared || jsonb_build_array(v_entry.value);
        continue;
      end if;

      v_field := v_entry.value #>> '{}';
      if v_cleared ? v_field then
        continue;
      end if;
      v_cleared := v_cleared || jsonb_build_array(v_entry.value);
      v_aliases := case
        when v_field in ('product_type', 'category', 'productType', 'categorySlug')
          then array['product_type', 'category', 'productType', 'categorySlug']
        when v_field in ('product_tags', 'subcategories', 'productTags')
          then array['product_tags', 'subcategories', 'productTags']
        when v_field in ('product_tags_en', 'subcategories_en', 'productTagsEn', 'subcategoriesEn')
          then array['product_tags_en', 'subcategories_en', 'productTagsEn', 'subcategoriesEn']
        else null
      end;
      if v_aliases is null then
        continue;
      end if;

      foreach v_alias in array v_aliases loop
        if not v_cleared ? v_alias then
          v_cleared := v_cleared || jsonb_build_array(v_alias);
        end if;
      end loop;
    end loop;
    v_result := jsonb_set(v_result, array['_cleared_fields'], v_cleared, true);
  end if;

  return v_result;
end;
$function$;

-- `suggested_tags` historically stores structured submissions as
-- `{values, productType}` rather than the flat keys used by the other JSON
-- containers. Keep that wrapper readable by both vocabularies as well.
create or replace function public.sync_submission_suggested_tags_aliases(p_json jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_result jsonb;
begin
  v_result := public.sync_submission_json_aliases(p_json);
  if p_json is null or jsonb_typeof(p_json) <> 'object' then
    return v_result;
  end if;

  return public.sync_submission_json_alias_group(
    v_result,
    array['values', 'product_tags', 'subcategories', 'productTags']
  );
end;
$function$;

create or replace function public.sync_brand_submission_category_subcategory_aliases()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  new.enriched_data := public.sync_submission_json_aliases(new.enriched_data);
  new.review_overrides := public.sync_submission_json_aliases(new.review_overrides);
  new.base_brand_data := public.sync_submission_json_aliases(new.base_brand_data);
  new.owner_data := public.sync_submission_json_aliases(new.owner_data);
  new.suggested_tags := public.sync_submission_suggested_tags_aliases(new.suggested_tags);
  return new;
end;
$function$;

-- These functions are trigger-only compatibility helpers. They must not become
-- callable API surface while the old and new columns coexist.
revoke all on function public.sync_brands_category_subcategory_columns() from public, anon, authenticated;
revoke all on function public.sync_brand_ai_results_category_subcategory_columns() from public, anon, authenticated;
revoke all on function public.sync_brand_submission_category_note() from public, anon, authenticated;
revoke all on function public.sync_submission_json_alias_group(jsonb, text[]) from public, anon, authenticated;
revoke all on function public.sync_submission_json_aliases(jsonb) from public, anon, authenticated;
revoke all on function public.sync_submission_suggested_tags_aliases(jsonb) from public, anon, authenticated;
revoke all on function public.sync_brand_submission_category_subcategory_aliases() from public, anon, authenticated;

drop trigger if exists brands_category_subcategory_sync on public.brands;
create trigger brands_category_subcategory_sync
before insert or update of
  product_type, category, product_tags, subcategories,
  product_tags_en, subcategories_en
on public.brands
for each row execute function public.sync_brands_category_subcategory_columns();

drop trigger if exists brand_ai_results_category_subcategory_sync on public.brand_ai_results;
create trigger brand_ai_results_category_subcategory_sync
before insert or update of product_type, category, product_tags, subcategories
on public.brand_ai_results
for each row execute function public.sync_brand_ai_results_category_subcategory_columns();

drop trigger if exists brand_submissions_category_subcategory_sync on public.brand_submissions;
create trigger brand_submissions_category_subcategory_sync
before insert or update of
  product_type_note, category_note
on public.brand_submissions
for each row execute function public.sync_brand_submission_category_note();

drop trigger if exists brand_submissions_category_subcategory_json_sync on public.brand_submissions;
create trigger brand_submissions_category_subcategory_json_sync
before insert or update of
  enriched_data, review_overrides, base_brand_data, owner_data, suggested_tags
on public.brand_submissions
for each row execute function public.sync_brand_submission_category_subcategory_aliases();

-- New-column writes must still feed the legacy search-vector function. The
-- function and its B/C weights remain untouched; only the trigger's UPDATE OF
-- list grows so a target-only write cannot leave search_vector stale.
drop trigger if exists brands_search_vector_trigger on public.brands;
create trigger brands_search_vector_trigger
before insert or update of
  name, slug, product_type, category, product_tags, subcategories,
  product_tags_en, subcategories_en, description, blurb_en
on public.brands
for each row execute function public.brands_search_vector_update();

-- Fresh target columns are populated from the legacy values. Suppress the
-- unconditional updated_at trigger so this compatibility backfill does not
-- change directory ordering, sitemap lastmod, or refresh staleness snapshots.
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

-- Backfill every current submission JSON container through the same alias
-- function used by future writes. Historical LLM input/raw_response JSON is in
-- brand_ai_results and is intentionally not touched.
update public.brand_submissions
set enriched_data = public.sync_submission_json_aliases(enriched_data),
    review_overrides = public.sync_submission_json_aliases(review_overrides),
    base_brand_data = public.sync_submission_json_aliases(base_brand_data),
    owner_data = public.sync_submission_json_aliases(owner_data),
    suggested_tags = public.sync_submission_suggested_tags_aliases(suggested_tags)
where enriched_data is not null
   or review_overrides is not null
   or base_brand_data is not null
   or owner_data is not null
   or suggested_tags is not null;

do $migration$
begin
  if exists (
    select 1 from public.brands
    where category is distinct from product_type
       or subcategories is distinct from product_tags
       or subcategories_en is distinct from product_tags_en
  ) then
    raise exception 'DEV-1503 brands expand backfill is not equal to legacy values';
  end if;
  if exists (
    select 1 from public.brand_ai_results
    where category is distinct from product_type
       or subcategories is distinct from product_tags
  ) then
    raise exception 'DEV-1503 brand_ai_results expand backfill is not equal to legacy values';
  end if;
  if exists (
    select 1 from public.brand_submissions
    where category_note is distinct from product_type_note
  ) then
    raise exception 'DEV-1503 brand_submissions expand backfill is not equal to legacy values';
  end if;
end
$migration$;

commit;
