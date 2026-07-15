begin;

create temporary table legacy_submission_brands on commit drop as
select submission.id as submission_id, brand.id as brand_id
from public.brand_submissions as submission
join public.brands as brand on brand.id = submission.brand_id
where submission.status = 'pending'
  and brand.status = 'pending_enrichment';

update public.brand_submissions as submission
set enriched_data = coalesce(submission.enriched_data, '{}'::jsonb) ||
  jsonb_strip_nulls(jsonb_build_object(
    'name', brand.name,
    'description', brand.description,
    'description_en', brand.description_en,
    'blurb', brand.blurb,
    'blurb_en', brand.blurb_en,
    'city', brand.city,
    'category_attributes', brand.category_attributes,
    'reputation_summary', brand.reputation_summary,
    'retail_locations', brand.retail_locations,
    'mit_evidence', brand.mit_evidence,
    'site_content', brand.site_content,
    'founding_year', brand.founding_year,
    'hero_image_url', brand.hero_image_url,
    'product_type', brand.product_type,
    'price_range', brand.price_range,
    'product_tags', brand.product_tags,
    'product_tags_en', brand.product_tags_en,
    'social_instagram', brand.social_instagram,
    'social_threads', brand.social_threads,
    'social_facebook', brand.social_facebook,
    'purchase_website', brand.purchase_website,
    'purchase_pinkoi', brand.purchase_pinkoi,
    'purchase_shopee', brand.purchase_shopee,
    'other_urls', case
      when jsonb_array_length(coalesce(brand.other_urls, '[]'::jsonb)) > 0
        then brand.other_urls
      else null
    end
  ))
from legacy_submission_brands as legacy
join public.brands as brand on brand.id = legacy.brand_id
where submission.id = legacy.submission_id;

insert into public.submission_images (
  submission_id,
  storage_path,
  url,
  source,
  status,
  tags,
  score,
  alt_zh,
  alt_en,
  width,
  height,
  dominant_color,
  sort_order,
  source_url,
  phash,
  created_at
)
select
  legacy.submission_id,
  image.storage_path,
  image.url,
  image.source,
  image.status,
  image.tags,
  image.score,
  image.alt_zh,
  image.alt_en,
  image.width,
  image.height,
  image.dominant_color,
  image.sort_order,
  image.source_url,
  image.phash,
  image.created_at
from legacy_submission_brands as legacy
join public.brand_images as image on image.brand_id = legacy.brand_id
on conflict (submission_id, source_url) do update
set storage_path = excluded.storage_path,
    url = excluded.url,
    source = excluded.source,
    status = excluded.status,
    tags = excluded.tags,
    score = excluded.score,
    alt_zh = excluded.alt_zh,
    alt_en = excluded.alt_en,
    width = excluded.width,
    height = excluded.height,
    dominant_color = excluded.dominant_color,
    sort_order = excluded.sort_order,
    phash = excluded.phash;

update public.brand_ai_results as result
set brand_id = null,
    submission_id = legacy.submission_id
from legacy_submission_brands as legacy
where result.brand_id = legacy.brand_id;

update public.brand_search_results as result
set brand_id = null,
    submission_id = legacy.submission_id
from legacy_submission_brands as legacy
where result.brand_id = legacy.brand_id;

update public.curation_job_targets as submission_target
set status = case
      when array_position(array['pending', 'running', 'skipped', 'failed', 'succeeded'], brand_target.status)
        > array_position(array['pending', 'running', 'skipped', 'failed', 'succeeded'], submission_target.status)
        then brand_target.status
      else submission_target.status
    end,
    current_phase = coalesce(brand_target.current_phase, submission_target.current_phase),
    phase_results = coalesce(brand_target.phase_results, submission_target.phase_results),
    changed_fields = case
      when cardinality(coalesce(brand_target.changed_fields, '{}'::text[])) > 0
        then brand_target.changed_fields
      else submission_target.changed_fields
    end,
    error = coalesce(brand_target.error, submission_target.error),
    completed_at = coalesce(brand_target.completed_at, submission_target.completed_at),
    duration_ms = coalesce(brand_target.duration_ms, submission_target.duration_ms)
from public.curation_job_targets as brand_target
join legacy_submission_brands as legacy on legacy.brand_id = brand_target.target_id
where brand_target.target_type = 'brand'
  and submission_target.job_id = brand_target.job_id
  and submission_target.target_type = 'submission'
  and submission_target.target_id = legacy.submission_id;

delete from public.curation_job_targets as brand_target
using legacy_submission_brands as legacy
where brand_target.target_type = 'brand'
  and brand_target.target_id = legacy.brand_id
  and exists (
    select 1
    from public.curation_job_targets as submission_target
    where submission_target.job_id = brand_target.job_id
      and submission_target.target_type = 'submission'
      and submission_target.target_id = legacy.submission_id
  );

update public.curation_job_targets as target
set target_type = 'submission',
    target_id = legacy.submission_id,
    brand_slug = null
from legacy_submission_brands as legacy
where target.target_type = 'brand'
  and target.target_id = legacy.brand_id;

update public.curation_jobs as job
set current_target_id = legacy.submission_id
from legacy_submission_brands as legacy
where job.current_target_id = legacy.brand_id;

update public.brand_submissions as submission
set brand_id = null
from legacy_submission_brands as legacy
where submission.id = legacy.submission_id;

delete from public.brands as brand
using legacy_submission_brands as legacy
where brand.id = legacy.brand_id;

alter table public.brands
  drop constraint if exists brands_status_check,
  add constraint brands_status_check
    check (status = any (array['approved'::text, 'hidden'::text]));

create or replace function public.approve_submission(
  p_submission_id uuid,
  p_reviewer_id uuid,
  p_brand_data jsonb
)
returns table (
  brand_id uuid,
  submitter_email text,
  brand_name text,
  submitter_name text,
  is_brand_owner boolean,
  suggested_tags jsonb
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_submission public.brand_submissions%rowtype;
  v_latest_target_status text;
  v_brand_id uuid;
  v_hero_url text;
  v_updated_submission public.brand_submissions%rowtype;
begin
  select *
  into v_submission
  from public.brand_submissions
  where id = p_submission_id
  for update;

  if not found then
    raise exception 'Submission not found'
      using errcode = 'P0002';
  end if;

  if v_submission.status <> 'pending' or v_submission.brand_id is not null then
    raise exception 'Submission already processed';
  end if;

  if not (
    coalesce(
      jsonb_typeof(v_submission.enriched_data) = 'object'
      and jsonb_typeof(v_submission.enriched_data -> 'description') = 'string'
      and nullif(btrim(v_submission.enriched_data ->> 'description'), '') is not null,
      false
    )
    and coalesce(
      (
        jsonb_typeof(v_submission.enriched_data -> 'hero_image_url') = 'string'
        and nullif(btrim(v_submission.enriched_data ->> 'hero_image_url'), '') is not null
      )
      or nullif(btrim(v_submission.hero_image_url), '') is not null,
      false
    )
    and coalesce(
      jsonb_typeof(v_submission.enriched_data) = 'object'
      and jsonb_typeof(v_submission.enriched_data -> 'product_type') = 'string'
      and nullif(btrim(v_submission.enriched_data ->> 'product_type'), '') is not null,
      false
    )
  ) then
    raise exception 'Submission must have complete enrichment before approval';
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

  v_hero_url := nullif(btrim(p_brand_data ->> 'hero_image_url'), '');

  insert into public.brands (
    name,
    slug,
    description,
    description_en,
    blurb,
    blurb_en,
    city,
    category_attributes,
    reputation_summary,
    mit_evidence,
    hero_image_url,
    status,
    is_demo,
    product_type,
    founding_year,
    social_instagram,
    social_threads,
    social_facebook,
    purchase_website,
    purchase_pinkoi,
    purchase_shopee,
    other_urls,
    retail_locations,
    contact_email,
    site_content,
    submitted_at,
    approved_at,
    price_range,
    product_tags,
    product_tags_en
  )
  select
    brand.name,
    brand.slug,
    brand.description,
    brand.description_en,
    brand.blurb,
    brand.blurb_en,
    brand.city,
    brand.category_attributes,
    brand.reputation_summary,
    brand.mit_evidence,
    brand.hero_image_url,
    'approved',
    coalesce(brand.is_demo, false),
    brand.product_type,
    brand.founding_year,
    brand.social_instagram,
    brand.social_threads,
    brand.social_facebook,
    brand.purchase_website,
    brand.purchase_pinkoi,
    brand.purchase_shopee,
    coalesce(brand.other_urls, '[]'::jsonb),
    coalesce(brand.retail_locations, '[]'::jsonb),
    brand.contact_email,
    brand.site_content,
    brand.submitted_at,
    brand.approved_at,
    brand.price_range,
    brand.product_tags,
    brand.product_tags_en
  from jsonb_to_record(coalesce(p_brand_data, '{}'::jsonb)) as brand(
    name text,
    slug text,
    description text,
    description_en text,
    blurb text,
    blurb_en text,
    city text,
    category_attributes jsonb,
    reputation_summary jsonb,
    mit_evidence jsonb,
    hero_image_url text,
    is_demo boolean,
    product_type text,
    founding_year integer,
    social_instagram text,
    social_threads text,
    social_facebook text,
    purchase_website text,
    purchase_pinkoi text,
    purchase_shopee text,
    other_urls jsonb,
    retail_locations jsonb,
    contact_email text,
    site_content jsonb,
    submitted_at timestamptz,
    approved_at timestamptz,
    price_range smallint,
    product_tags text[],
    product_tags_en text[]
  )
  returning id into v_brand_id;

  insert into public.brand_images (
    brand_id,
    storage_path,
    url,
    source,
    status,
    tags,
    score,
    alt_zh,
    alt_en,
    width,
    height,
    dominant_color,
    sort_order,
    source_url,
    phash,
    created_at
  )
  select
    v_brand_id,
    image.storage_path,
    image.url,
    image.source,
    image.status,
    image.tags,
    image.score,
    image.alt_zh,
    image.alt_en,
    image.width,
    image.height,
    image.dominant_color,
    case
      when image.url = v_hero_url then 0
      else (row_number() over (order by image.sort_order, image.created_at, image.id))::integer + 1
    end,
    image.source_url,
    image.phash,
    image.created_at
  from public.submission_images as image
  where image.submission_id = p_submission_id;

  if v_hero_url is not null and not exists (
    select 1
    from public.brand_images
    where brand_id = v_brand_id
      and url = v_hero_url
  ) then
    insert into public.brand_images (
      brand_id,
      url,
      source_url,
      source,
      status,
      sort_order
    )
    values (
      v_brand_id,
      v_hero_url,
      v_hero_url,
      case when v_submission.hero_image_url = v_hero_url then 'owner' else 'admin' end,
      'active',
      0
    );
  end if;

  delete from public.submission_images
  where submission_id = p_submission_id;

  update public.brand_ai_results
  set brand_id = v_brand_id,
      submission_id = null
  where submission_id = p_submission_id;

  update public.brand_search_results
  set brand_id = v_brand_id,
      submission_id = null
  where submission_id = p_submission_id;

  insert into public.brand_field_state (
    brand_id,
    field,
    source,
    updated_by
  )
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
  on conflict (brand_id, field) do nothing;

  update public.brand_submissions as submission
  set brand_id = v_brand_id,
      status = 'approved',
      reviewed_at = now(),
      reviewed_by = p_reviewer_id
  where submission.id = p_submission_id
    and submission.status = 'pending'
  returning submission.* into v_updated_submission;

  if not found then
    raise exception 'Submission not found'
      using errcode = 'P0002';
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
$$;

revoke all on function public.approve_submission(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.approve_submission(uuid, uuid, jsonb)
  to service_role;

commit;
