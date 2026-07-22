-- Preserve the owner-provided MIT story when approving a submission.

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
set search_path = ''
as $$
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

  v_hero_url := nullif(btrim(p_brand_data ->> 'hero_image_url'), '');

  select
    brand.description,
    brand.product_type,
    brand.product_tags,
    brand.price_range,
    brand.purchase_website
  into
    v_description,
    v_product_type,
    v_product_tags,
    v_price_range,
    v_website_url
  from jsonb_to_record(coalesce(p_brand_data, '{}'::jsonb)) as brand(
    description text,
    product_type text,
    product_tags text[],
    price_range integer,
    purchase_website text
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
    or nullif(btrim(v_website_url), '') is null
    or v_website_url !~* '^https?://[^/@[:space:]]+([/:?#][^[:space:]]*)?$'
    or v_hero_url is null
    or (
      select count(distinct image.url)
      from public.submission_images as image
      where image.submission_id = p_submission_id
        and image.status = 'active'
    ) < 2
    or (
      select count(*)
      from public.submission_images as image
      where image.submission_id = p_submission_id
        and image.status = 'active'
        and image.sort_order = 0
        and image.url = v_hero_url
    ) <> 1
    or (
      select count(*)
      from public.submission_images as image
      where image.submission_id = p_submission_id
        and image.status = 'active'
        and image.sort_order = 0
    ) <> 1
  then
    raise exception 'Submission must satisfy publishable core before approval';
  end if;

  insert into public.brands (
    name, slug, description, description_en, blurb, blurb_en, city,
    category_attributes, reputation_summary, mit_evidence, mit_story, hero_image_url,
    status, is_demo, product_type, founding_year, social_instagram,
    social_threads, social_facebook, purchase_website, purchase_pinkoi,
    purchase_shopee, other_urls, retail_locations, contact_email,
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
    brand.purchase_shopee, coalesce(brand.other_urls, '[]'::jsonb),
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
    other_urls jsonb, retail_locations jsonb, contact_email text,
    site_content jsonb, submitted_at timestamptz, approved_at timestamptz,
    price_range smallint, product_tags text[], product_tags_en text[]
  )
  returning id into v_brand_id;

  insert into public.brand_images (
    brand_id, storage_path, url, source, status, tags, score, alt_zh,
    alt_en, width, height, dominant_color, sort_order, source_url, phash,
    created_at
  )
  select
    v_brand_id, image.storage_path, image.url, image.source, 'active',
    image.tags, image.score, image.alt_zh, image.alt_en, image.width,
    image.height, image.dominant_color, image.sort_order, image.source_url,
    image.phash, image.created_at
  from public.submission_images as image
  where image.submission_id = p_submission_id
    and image.status = 'active'
  order by image.sort_order, image.created_at, image.id;

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
$$;

revoke all on function public.approve_submission(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.approve_submission(uuid, uuid, jsonb)
  to service_role;
