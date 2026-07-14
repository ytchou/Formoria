-- Update approve_submission to handle pending_enrichment brand rows:
-- if the submission is linked to a pending_enrichment brand, UPDATE it
-- instead of INSERT; otherwise INSERT as before.
begin;

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
  v_existing_brand_status text;
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

  if v_submission.status <> 'pending' then
    raise exception 'Submission already processed';
  end if;

  -- Check if the linked brand is pending_enrichment (valid) or already approved/hidden (invalid)
  if v_submission.brand_id is not null then
    select status into v_existing_brand_status
    from public.brands
    where id = v_submission.brand_id;

    if v_existing_brand_status is distinct from 'pending_enrichment' then
      raise exception 'Submission already processed';
    end if;
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
  order by target.created_at desc
  limit 1;

  if found and v_latest_target_status <> 'succeeded' then
    raise exception
      'Submission must have a successful enrichment run before approval';
  end if;

  -- If a pending_enrichment brand exists, UPDATE it; otherwise INSERT
  if v_submission.brand_id is not null and v_existing_brand_status = 'pending_enrichment' then
    update public.brands
    set name = brand.name,
        slug = brand.slug,
        description = brand.description,
        hero_image_url = brand.hero_image_url,
        status = coalesce(brand.status, 'approved'),
        is_demo = coalesce(brand.is_demo, false),
        product_type = brand.product_type,
        founding_year = brand.founding_year,
        social_instagram = brand.social_instagram,
        social_threads = brand.social_threads,
        social_facebook = brand.social_facebook,
        purchase_website = brand.purchase_website,
        purchase_pinkoi = brand.purchase_pinkoi,
        purchase_shopee = brand.purchase_shopee,
        other_urls = coalesce(brand.other_urls, '[]'::jsonb),
        retail_locations = coalesce(brand.retail_locations, '[]'::jsonb),
        contact_email = brand.contact_email,
        site_content = brand.site_content,
        submitted_at = brand.submitted_at,
        approved_at = brand.approved_at,
        price_range = brand.price_range,
        product_tags = brand.product_tags,
        updated_at = now()
    from jsonb_to_record(coalesce(p_brand_data, '{}'::jsonb)) as brand(
      name text,
      slug text,
      description text,
      hero_image_url text,
      status text,
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
      product_tags text[]
    )
    where public.brands.id = v_submission.brand_id;

    v_brand_id := v_submission.brand_id;
  else
    insert into public.brands (
      name,
      slug,
      description,
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
      product_tags
    )
    select
      brand.name,
      brand.slug,
      brand.description,
      brand.hero_image_url,
      coalesce(brand.status, 'approved'),
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
      brand.product_tags
    from jsonb_to_record(coalesce(p_brand_data, '{}'::jsonb)) as brand(
      name text,
      slug text,
      description text,
      hero_image_url text,
      status text,
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
      product_tags text[]
    )
    returning id into v_brand_id;
  end if;

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
