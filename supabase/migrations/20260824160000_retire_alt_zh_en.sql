-- DEV-1603: Retire alt_zh / alt_en columns
-- Part 1+2: Re-create functions without alt_zh/alt_en references
-- Part 3: Drop the columns from brand_images, submission_images, event_exhibitor_content

-- =====================================================================
-- 1. approve_submission — without alt_zh/alt_en in brand_images INSERT
-- =====================================================================

create or replace function public.approve_submission(p_submission_id uuid, p_reviewer_id uuid, p_brand_data jsonb)
 returns table(brand_id uuid, submitter_email text, brand_name text, submitter_name text, is_brand_owner boolean, suggested_tags jsonb)
 language plpgsql
 set search_path to ''
as $function$
declare
  v_submission public.brand_submissions%rowtype;
  v_latest_target_status text;
  v_brand_id uuid;
  v_hero_url text;
  v_description text;
  v_product_type text;
  v_product_tags text[];
  v_price_range integer;
  v_website_url text;
  v_pinkoi_url text;
  v_shopee_url text;
  v_myship_url text;
  v_updated_submission public.brand_submissions%rowtype;
begin
  select *
  into v_submission
  from public.brand_submissions
  where id = p_submission_id
  for update;

  if not found then
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;

  if v_submission.status <> 'pending' or v_submission.brand_id is not null then
    raise exception 'Submission already processed';
  end if;

  select target.status
  into v_latest_target_status
  from public.curation_job_targets as target
  where target.target_type = 'submission'
    and target.target_id = p_submission_id
  order by target.created_at desc, target.id desc
  limit 1;

  if v_latest_target_status is distinct from 'succeeded' then
    raise exception 'Submission must have a successful enrichment run before approval';
  end if;

  select image.url
  into v_hero_url
  from public.submission_images as image
  where image.submission_id = p_submission_id
    and image.status = 'active'
  order by image.sort_order, image.created_at, image.id
  limit 1;

  p_brand_data := p_brand_data - 'hero_image_url';

  select
    brand.description,
    brand.product_type,
    brand.product_tags,
    brand.price_range,
    brand.purchase_website,
    brand.purchase_pinkoi,
    brand.purchase_shopee,
    brand.purchase_myship
  into
    v_description,
    v_product_type,
    v_product_tags,
    v_price_range,
    v_website_url,
    v_pinkoi_url,
    v_shopee_url,
    v_myship_url
  from jsonb_to_record(coalesce(p_brand_data, '{}'::jsonb)) as brand(
    description text,
    product_type text,
    product_tags text[],
    price_range integer,
    purchase_website text,
    purchase_pinkoi text,
    purchase_shopee text,
    purchase_myship text
  );

  if nullif(btrim(v_description), '') is null
    or v_product_type is null
    or v_product_type not in (
      'fashion', 'bags-accessories', 'jewelry', 'beauty', 'home',
      'food-drink', 'crafts', 'stationery', 'tech', 'outdoor',
      'fitness', 'kids-pets'
    )
    or coalesce(cardinality(v_product_tags), 0) not between 1 and 5
    or exists (
      select 1
      from unnest(v_product_tags) as tag(value)
      where nullif(btrim(tag.value), '') is null
    )
    or (
      select count(distinct btrim(tag.value))
      from unnest(v_product_tags) as tag(value)
    ) <> cardinality(v_product_tags)
    or v_price_range is null
    or v_price_range not between 1 and 3
    or not (
      coalesce(v_website_url ~* '^https?://[^/@[:space:]]+([/:?#][^[:space:]]*)?$', false)
      or nullif(btrim(p_brand_data ->> 'social_instagram'), '') is not null
      or nullif(btrim(p_brand_data ->> 'social_threads'), '') is not null
      or nullif(btrim(p_brand_data ->> 'social_facebook'), '') is not null
      or coalesce(
        v_pinkoi_url ~* '^https?://[^/@[:space:]]+([/:?#][^[:space:]]*)?$',
        false
      )
      or coalesce(
        v_shopee_url ~* '^https?://[^/@[:space:]]+([/:?#][^[:space:]]*)?$',
        false
      )
      or coalesce(
        v_myship_url ~* '^https?://[^/@[:space:]]+([/:?#][^[:space:]]*)?$',
        false
      )
    )
    or (
      select count(distinct image.url)
      from public.submission_images as image
      where image.submission_id = p_submission_id
        and image.status = 'active'
    ) < 1
    or (
      select count(distinct image.url)
      from public.submission_images as image
      where image.submission_id = p_submission_id
        and image.status = 'active'
    ) > 10
  then
    raise exception 'Submission must satisfy publishable core before approval';
  end if;

  insert into public.brands (
    name, slug, description, description_en, blurb, blurb_en, city,
    category_attributes, reputation_summary, mit_evidence, mit_story, hero_image_url,
    status, is_demo, product_type, founding_year, social_instagram,
    social_threads, social_facebook, purchase_website, purchase_pinkoi,
    purchase_shopee, purchase_myship, other_urls, retail_locations, contact_email,
    site_content, submitted_at, approved_at, price_range, product_tags,
    product_tags_en
  )
  select
    brand.name, brand.slug, brand.description, brand.description_en,
    brand.blurb, brand.blurb_en, brand.city, brand.category_attributes,
    brand.reputation_summary, brand.mit_evidence,
    nullif(btrim(v_submission.owner_data ->> 'mitStory'), ''),
    brand.hero_image_url, 'approved', coalesce(brand.is_demo, false), brand.product_type,
    brand.founding_year, brand.social_instagram, brand.social_threads,
    brand.social_facebook, brand.purchase_website, brand.purchase_pinkoi,
    brand.purchase_shopee, brand.purchase_myship, coalesce(brand.other_urls, '[]'::jsonb),
    coalesce(brand.retail_locations, '[]'::jsonb), brand.contact_email,
    brand.site_content, brand.submitted_at, brand.approved_at,
    brand.price_range, brand.product_tags, brand.product_tags_en
  from jsonb_to_record(coalesce(p_brand_data, '{}'::jsonb)) as brand(
    name text, slug text, description text, description_en text, blurb text,
    blurb_en text, city text, category_attributes jsonb,
    reputation_summary jsonb, mit_evidence jsonb, hero_image_url text,
    is_demo boolean, product_type text, founding_year integer,
    social_instagram text, social_threads text, social_facebook text,
    purchase_website text, purchase_pinkoi text, purchase_shopee text,
    purchase_myship text,
    other_urls jsonb, retail_locations jsonb, contact_email text,
    site_content jsonb, submitted_at timestamptz, approved_at timestamptz,
    price_range smallint, product_tags text[], product_tags_en text[]
  )
  returning id into v_brand_id;

  insert into public.brand_images (
    brand_id, storage_path, url, source, status, tags, score,
    width, height, dominant_color, sort_order, source_url, phash,
    sharpness, entropy, created_at
  )
  select
    v_brand_id, image.storage_path, image.url, image.source, 'active',
    image.tags, image.score, image.width,
    image.height, image.dominant_color, image.sort_order, image.source_url,
    image.phash, image.sharpness, image.entropy, image.created_at
  from public.submission_images as image
  where image.submission_id = p_submission_id
    and image.status = 'active'
  order by image.sort_order, image.created_at, image.id;

  update public.brands
  set hero_image_url = v_hero_url
  where id = v_brand_id;

  delete from public.submission_images
  where submission_id = p_submission_id
    and status = 'active';

  update public.brand_ai_results
  set brand_id = v_brand_id, submission_id = null
  where submission_id = p_submission_id;

  update public.brand_search_results
  set brand_id = v_brand_id, submission_id = null
  where submission_id = p_submission_id;

  insert into public.brand_field_state (brand_id, field, source, updated_by)
  select
    v_brand_id,
    field.key,
    case when coalesce(v_submission.is_brand_owner, false)
      then 'owner'
      else 'enriched'
    end,
    null
  from jsonb_each(coalesce(p_brand_data, '{}'::jsonb)) as field(key, value)
  where case jsonb_typeof(field.value)
    when 'null' then false
    when 'string' then btrim(field.value #>> '{}') <> ''
    when 'array' then jsonb_array_length(field.value) > 0
    else true
  end
  on conflict on constraint brand_field_state_pkey do nothing;

  update public.brand_submissions as submission
  set brand_id = v_brand_id,
      status = 'approved',
      reviewed_at = now(),
      reviewed_by = p_reviewer_id
  where submission.id = p_submission_id
    and submission.status = 'pending'
  returning submission.* into v_updated_submission;

  if not found then
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;

  return query
  select
    v_brand_id,
    v_updated_submission.submitter_email,
    v_updated_submission.brand_name,
    v_updated_submission.submitter_name,
    coalesce(v_updated_submission.is_brand_owner, false),
    v_updated_submission.suggested_tags;
end;
$function$;

-- =====================================================================
-- 2. apply_brand_refresh_with_protected_location_gate — without alt_zh/alt_en
-- =====================================================================

create or replace function public.apply_brand_refresh_with_protected_location_gate(p_submission_id uuid, p_reviewer_id uuid)
 returns text[]
 language plpgsql
 set search_path to ''
 set lock_timeout to '2s'
as $function$
declare
  v_submission public.brand_submissions%rowtype;
  v_brand public.brands%rowtype;
  v_latest_target_status text;
  v_latest_job_id uuid;
  v_current_image_snapshot jsonb;
  v_effective jsonb;
  v_selected_hero_url text;
  v_enrichment_patch jsonb;
  v_cleared_patch jsonb;
  v_admin_patch jsonb;
  v_entry record;
  v_old_value jsonb;
  v_retired_paths text[] := '{}'::text[];
  v_rejected_paths text[] := '{}'::text[];
begin
  select * into v_submission
  from public.brand_submissions
  where id = p_submission_id
  for update;
  if not found then
    raise exception 'Refresh submission not found' using errcode = 'P0002';
  end if;
  if v_submission.status <> 'pending' or v_submission.intent <> 'refresh'
    or v_submission.brand_id is null then
    raise exception 'Refresh submission already processed';
  end if;

  select target.status, target.job_id
  into v_latest_target_status, v_latest_job_id
  from public.curation_job_targets as target
  where target.target_type = 'submission'
    and target.target_id = p_submission_id
  order by target.created_at desc, target.id desc
  limit 1;
  if v_latest_target_status is distinct from 'succeeded' then
    raise exception 'Refresh must have a successful enrichment run before apply';
  end if;

  select * into v_brand
  from public.brands
  where id = v_submission.brand_id
  for update;
  if not found then
    raise exception 'Brand not found' using errcode = 'P0002';
  end if;
  if v_brand.status not in ('approved', 'hidden') then
    raise exception 'Refresh brand is no longer approved or hidden';
  end if;
  if v_brand.updated_at is distinct from v_submission.base_brand_updated_at then
    raise exception 'Refresh is stale: brand changed after request'
      using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', image.id,
    'storage_path', image.storage_path,
    'url', image.url,
    'source', image.source,
    'tags', image.tags,
    'score', image.score,
    'width', image.width,
    'height', image.height,
    'dominant_color', image.dominant_color,
    'sort_order', image.sort_order,
    'source_url', image.source_url,
    'phash', image.phash
  ) order by image.id::text), '[]'::jsonb)
  into v_current_image_snapshot
  from public.brand_images as image
  where image.brand_id = v_brand.id and image.status = 'active';
  if v_current_image_snapshot is distinct from
    coalesce(v_submission.base_brand_data -> '_active_images', '[]'::jsonb) then
    raise exception 'Refresh is stale: brand images changed after request'
      using errcode = 'P0001';
  end if;

  -- ALLOW-LIST 1/5 — owner-protection check over enriched_data
  if exists (
    select 1
    from jsonb_each(coalesce(v_submission.enriched_data, '{}'::jsonb)) as entry
    join public.brand_field_state as state
      on state.brand_id = v_brand.id and state.field = entry.key
    where state.source = 'owner'
      and entry.key = any(array[
        'description', 'description_en', 'blurb', 'blurb_en', 'city',
        'category_attributes', 'reputation_summary', 'retail_locations',
        'mit_evidence', 'site_content', 'founding_year',
        'product_type', 'price_range', 'product_tags', 'product_tags_en',
        'social_instagram', 'social_threads', 'social_facebook',
        'purchase_website', 'purchase_pinkoi', 'purchase_shopee',
        'purchase_myship', 'other_urls'
      ])
  ) or exists (
    -- ALLOW-LIST 2/5 — owner-protection check over _cleared_fields
    select 1
    from jsonb_array_elements_text(
           coalesce(v_submission.enriched_data -> '_cleared_fields', '[]'::jsonb)
         ) as cleared(field)
    join public.brand_field_state as state
      on state.brand_id = v_brand.id and state.field = cleared.field
    where state.source = 'owner'
      and cleared.field = any(array[
        'description', 'description_en', 'blurb', 'blurb_en', 'city',
        'category_attributes', 'reputation_summary', 'retail_locations',
        'mit_evidence', 'site_content', 'founding_year',
        'product_type', 'price_range', 'product_tags', 'product_tags_en',
        'social_instagram', 'social_threads', 'social_facebook',
        'purchase_website', 'purchase_pinkoi', 'purchase_shopee',
        'purchase_myship', 'other_urls'
      ])
  ) then
    raise exception 'Refresh is stale: field protection changed after enrichment'
      using errcode = 'P0001';
  end if;

  -- ALLOW-LIST 3/5 — enrichment patch filter
  select coalesce(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
  into v_enrichment_patch
  from jsonb_each(coalesce(v_submission.enriched_data, '{}'::jsonb)) as entry
  where entry.key = any(array[
    'description', 'description_en', 'blurb', 'blurb_en', 'city',
    'category_attributes', 'reputation_summary', 'retail_locations',
    'mit_evidence', 'site_content', 'founding_year',
    'product_type', 'price_range', 'product_tags', 'product_tags_en',
    'social_instagram', 'social_threads', 'social_facebook',
    'purchase_website', 'purchase_pinkoi', 'purchase_shopee',
    'purchase_myship', 'other_urls'
  ]);
  -- ALLOW-LIST 4/5 — admin override filter (NOTE: this one also carries 'name')
  select coalesce(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
  into v_admin_patch
  from jsonb_each(coalesce(v_submission.review_overrides, '{}'::jsonb)) as entry
  where entry.key = any(array[
    'name', 'description', 'description_en', 'blurb', 'blurb_en', 'city',
    'category_attributes', 'reputation_summary', 'retail_locations',
    'mit_evidence', 'site_content', 'founding_year',
    'product_type', 'price_range', 'product_tags', 'product_tags_en',
    'social_instagram', 'social_threads', 'social_facebook',
    'purchase_website', 'purchase_pinkoi', 'purchase_shopee',
    'purchase_myship', 'other_urls'
  ]);
  -- ALLOW-LIST 5/5 — cleared-fields patch filter
  select coalesce(jsonb_object_agg(f.field, 'null'::jsonb), '{}'::jsonb)
  into v_cleared_patch
  from jsonb_array_elements_text(
         coalesce(v_submission.enriched_data -> '_cleared_fields', '[]'::jsonb)
       ) as f(field)
  where f.field = any(array[
    'description', 'description_en', 'blurb', 'blurb_en', 'city',
    'category_attributes', 'reputation_summary', 'retail_locations',
    'mit_evidence', 'site_content', 'founding_year',
    'product_type', 'price_range', 'product_tags', 'product_tags_en',
    'social_instagram', 'social_threads', 'social_facebook',
    'purchase_website', 'purchase_pinkoi', 'purchase_shopee',
    'purchase_myship', 'other_urls'
  ]);

  v_effective := (v_submission.base_brand_data - '_active_images')
    || v_cleared_patch || v_enrichment_patch || v_admin_patch;

  select image.url
  into v_selected_hero_url
  from public.submission_images as image
  where image.submission_id = p_submission_id
    and image.status = 'active'
  order by image.sort_order, image.created_at, image.id
  limit 1;

  -- OCCURRENCE 6/6 — publishable-core guard (NOT an array allow-list)
  if nullif(btrim(v_effective ->> 'name'), '') is null
    or nullif(btrim(v_effective ->> 'description'), '') is null
    or v_effective ->> 'product_type' not in (
      'fashion', 'bags-accessories', 'jewelry', 'beauty', 'home',
      'food-drink', 'crafts', 'stationery', 'tech', 'outdoor',
      'fitness', 'kids-pets'
    )
    or jsonb_typeof(v_effective -> 'product_tags') <> 'array'
    or jsonb_array_length(v_effective -> 'product_tags') not between 1 and 5
    or coalesce((v_effective ->> 'price_range')::integer, 0) not between 1 and 3
    or not (
      coalesce(
        (v_effective ->> 'purchase_website') ~*
          '^https?://[^/@[:space:]]+([/:?#][^[:space:]]*)?$',
        false
      )
      or nullif(btrim(v_effective ->> 'social_instagram'), '') is not null
      or nullif(btrim(v_effective ->> 'social_threads'), '') is not null
      or nullif(btrim(v_effective ->> 'social_facebook'), '') is not null
      or coalesce(
        (v_effective ->> 'purchase_pinkoi') ~*
          '^https?://[^/@[:space:]]+([/:?#][^[:space:]]*)?$',
        false
      )
      or coalesce(
        (v_effective ->> 'purchase_shopee') ~*
          '^https?://[^/@[:space:]]+([/:?#][^[:space:]]*)?$',
        false
      )
      or coalesce(
        (v_effective ->> 'purchase_myship') ~*
          '^https?://[^/@[:space:]]+([/:?#][^[:space:]]*)?$',
        false
      )
    )
    or (
      select count(*)
      from public.submission_images as image
      where image.submission_id = p_submission_id and image.status = 'active'
    ) not between 1 and 10
    or (
      select count(distinct image.url) <> count(*)
      from public.submission_images as image
      where image.submission_id = p_submission_id and image.status = 'active'
    )
    or (
      select count(distinct image.sort_order) <> count(*)
      from public.submission_images as image
      where image.submission_id = p_submission_id and image.status = 'active'
    )
    or exists (
      select 1
      from public.submission_images as image
      where image.submission_id = p_submission_id and image.status = 'active'
        and image.sort_order not between 0 and 9
    )
  then
    raise exception 'Refresh must satisfy publishable core before apply';
  end if;

  for v_entry in select key, value from jsonb_each(v_cleared_patch || v_enrichment_patch)
  loop
    execute format('select to_jsonb(%I) from public.brands where id = $1', v_entry.key)
      into v_old_value using v_brand.id;
    if v_old_value is not distinct from v_entry.value then continue; end if;
    execute format(
      'update public.brands set %1$I = (jsonb_populate_record(null::public.brands, jsonb_build_object($1, $2))).%1$I where id = $3',
      v_entry.key
    ) using v_entry.key, v_entry.value, v_brand.id;
    insert into public.brand_field_state (brand_id, field, source, updated_by, updated_at)
    values (v_brand.id, v_entry.key, 'enriched', null, now())
    on conflict (brand_id, field) do update set
      source = excluded.source, updated_by = excluded.updated_by,
      updated_at = excluded.updated_at;
    insert into public.brand_field_events (
      brand_id, field, old_value, new_value, source, actor, job_id
    ) values (
      v_brand.id, v_entry.key, v_old_value, v_entry.value, 'enriched', null,
      v_latest_job_id
    );
  end loop;

  for v_entry in select key, value from jsonb_each(v_admin_patch)
  loop
    execute format('select to_jsonb(%I) from public.brands where id = $1', v_entry.key)
      into v_old_value using v_brand.id;
    if v_old_value is not distinct from v_entry.value then continue; end if;
    execute format(
      'update public.brands set %1$I = (jsonb_populate_record(null::public.brands, jsonb_build_object($1, $2))).%1$I where id = $3',
      v_entry.key
    ) using v_entry.key, v_entry.value, v_brand.id;
    insert into public.brand_field_state (brand_id, field, source, updated_by, updated_at)
    values (v_brand.id, v_entry.key, 'admin', p_reviewer_id, now())
    on conflict (brand_id, field) do update set
      source = excluded.source, updated_by = excluded.updated_by,
      updated_at = excluded.updated_at;
    insert into public.brand_field_events (
      brand_id, field, old_value, new_value, source, actor, job_id
    ) values (
      v_brand.id, v_entry.key, v_old_value, v_entry.value, 'admin',
      p_reviewer_id, v_latest_job_id
    );
  end loop;

  select coalesce(array_agg(image.storage_path) filter (
    where image.storage_path is not null
  ), '{}'::text[])
  into v_retired_paths
  from public.brand_images as image
  join public.submission_images as reference
    on reference.origin_brand_image_id = image.id
  where reference.submission_id = p_submission_id
    and reference.status = 'rejected'
    and image.source not in ('owner', 'admin');

  delete from public.brand_images as image
  using public.submission_images as reference
  where reference.submission_id = p_submission_id
    and reference.origin_brand_image_id = image.id
    and reference.status = 'rejected'
    and image.source not in ('owner', 'admin');

  update public.brand_images as image
  set status = 'active', sort_order = reference.sort_order,
      tags = reference.tags, score = reference.score
  from public.submission_images as reference
  where reference.submission_id = p_submission_id
    and reference.origin_brand_image_id = image.id
    and reference.status = 'active';

  insert into public.brand_images (
    brand_id, storage_path, url, source, status, tags, score,
    width, height, dominant_color, sort_order, source_url, phash, sharpness,
    entropy, created_at
  )
  select
    v_brand.id, image.storage_path, image.url, image.source, 'active',
    image.tags, image.score, image.width,
    image.height, image.dominant_color, image.sort_order, image.source_url,
    image.phash, image.sharpness, image.entropy, image.created_at
  from public.submission_images as image
  where image.submission_id = p_submission_id
    and image.status = 'active'
    and image.origin_brand_image_id is null
  on conflict (brand_id, source_url) do update set
    storage_path = excluded.storage_path, url = excluded.url,
    source = excluded.source, status = 'active', tags = excluded.tags,
    score = excluded.score,
    width = excluded.width, height = excluded.height,
    dominant_color = excluded.dominant_color, sort_order = excluded.sort_order,
    phash = excluded.phash, sharpness = excluded.sharpness,
    entropy = excluded.entropy;

  select coalesce(array_agg(storage_path) filter (where storage_path is not null), '{}'::text[])
  into v_rejected_paths
  from public.submission_images
  where submission_id = p_submission_id
    and status = 'rejected'
    and origin_brand_image_id is null;

  delete from public.submission_images where submission_id = p_submission_id;

  update public.brand_ai_results
  set brand_id = v_brand.id, submission_id = null
  where submission_id = p_submission_id;
  update public.brand_search_results
  set brand_id = v_brand.id, submission_id = null
  where submission_id = p_submission_id;

  update public.brands
  set brand_enriched_at = now(), status = v_brand.status,
      hero_image_url = v_selected_hero_url
  where id = v_brand.id;

  update public.brand_submissions
  set status = 'approved', reviewed_at = now(), reviewed_by = p_reviewer_id
  where id = p_submission_id and status = 'pending';
  if not found then
    raise exception 'Refresh submission not found' using errcode = 'P0002';
  end if;

  return coalesce(v_retired_paths, '{}'::text[])
    || coalesce(v_rejected_paths, '{}'::text[]);
end;
$function$;

-- =====================================================================
-- 3. Drop alt_zh / alt_en columns
-- =====================================================================

ALTER TABLE brand_images DROP COLUMN IF EXISTS alt_zh, DROP COLUMN IF EXISTS alt_en;
ALTER TABLE submission_images DROP COLUMN IF EXISTS alt_zh, DROP COLUMN IF EXISTS alt_en;
ALTER TABLE event_exhibitor_content DROP COLUMN IF EXISTS image_alt_zh, DROP COLUMN IF EXISTS image_alt_en;
