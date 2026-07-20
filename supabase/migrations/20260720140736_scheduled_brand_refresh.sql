begin;

alter table public.brand_submissions
  drop constraint if exists brand_submissions_intent_check;

alter table public.brand_submissions
  add constraint brand_submissions_intent_check
    check (intent in ('recommend', 'owner_claim', 'refresh')),
  add column base_brand_data jsonb,
  add column base_brand_updated_at timestamptz,
  add column review_overrides jsonb not null default '{}'::jsonb,
  add column refresh_requested_by uuid references auth.users(id) on delete set null;

alter table public.brand_submissions
  add constraint brand_submissions_review_overrides_object_check
    check (jsonb_typeof(review_overrides) = 'object'),
  add constraint brand_submissions_refresh_snapshot_check
    check (
      intent <> 'refresh'
      or (
        brand_id is not null
        and base_brand_data is not null
        and jsonb_typeof(base_brand_data) = 'object'
        and base_brand_updated_at is not null
      )
    );

drop policy if exists "Authenticated users can submit brands"
  on public.brand_submissions;
create policy "Authenticated users can submit brands"
  on public.brand_submissions for insert to authenticated
  with check (intent <> 'refresh');

alter table public.submission_images
  add column origin_brand_image_id uuid
    references public.brand_images(id) on delete set null;

alter table public.submission_images
  add constraint submission_images_origin_reference_check
    check (origin_brand_image_id is null or storage_path is null);

create index submission_images_origin_brand_image_idx
  on public.submission_images (origin_brand_image_id)
  where origin_brand_image_id is not null;

alter table public.brand_field_state
  drop constraint if exists brand_field_state_source_check;

alter table public.brand_field_state
  add constraint brand_field_state_source_check
    check (source in ('enriched', 'owner', 'admin', 'submitted'));

alter table public.brand_images
  drop constraint if exists brand_images_source_check;

alter table public.brand_images
  add constraint brand_images_source_check
    check (source in ('scrape', 'google_image', 'owner', 'admin', 'legacy', 'json_ld'));

alter table public.admin_audit_log
  drop constraint if exists admin_audit_log_action_check;

alter table public.admin_audit_log
  add constraint admin_audit_log_action_check check (action in (
    'impersonate_start', 'impersonate_end', 'brand_edit', 'draft_save',
    'draft_publish', 'draft_discard', 'curation_job_cancelled',
    'newsletter_confirmation_resent', 'newsletter_unsubscribed',
    'refresh_requested'
  ));

create or replace function public.request_brand_refresh(
  p_brand_id uuid,
  p_requested_by uuid,
  p_requester_email text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_brand public.brands%rowtype;
  v_submission_id uuid;
  v_base_data jsonb;
begin
  if p_requested_by is null or nullif(btrim(p_requester_email), '') is null then
    raise exception 'Refresh requester is required';
  end if;

  select * into v_brand
  from public.brands
  where id = p_brand_id
  for update;

  if not found then
    raise exception 'Brand not found' using errcode = 'P0002';
  end if;
  if v_brand.status not in ('approved', 'hidden') then
    raise exception 'Only approved or hidden brands can be refreshed';
  end if;
  if v_brand.updated_at is null then
    raise exception 'Brand has no refreshable version';
  end if;
  if exists (
    select 1 from public.brand_submissions
    where brand_id = p_brand_id and intent = 'refresh' and status = 'pending'
  ) then
    raise exception 'A refresh is already pending for this brand'
      using errcode = '23505';
  end if;

  v_base_data := (to_jsonb(v_brand) - 'search_vector' - 'draft_data')
    || jsonb_build_object(
      '_active_images', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', image.id,
          'storage_path', image.storage_path,
          'url', image.url,
          'source', image.source,
          'tags', image.tags,
          'score', image.score,
          'alt_zh', image.alt_zh,
          'alt_en', image.alt_en,
          'width', image.width,
          'height', image.height,
          'dominant_color', image.dominant_color,
          'sort_order', image.sort_order,
          'source_url', image.source_url,
          'phash', image.phash
        ) order by image.id::text)
        from public.brand_images as image
        where image.brand_id = p_brand_id and image.status = 'active'
      ), '[]'::jsonb)
    );

  insert into public.brand_submissions (
    brand_id, intent, brand_name, submitter_email, submitter_name,
    status, base_brand_data, base_brand_updated_at, review_overrides,
    refresh_requested_by
  ) values (
    p_brand_id, 'refresh', v_brand.name, p_requester_email, 'Admin refresh',
    'pending', v_base_data, v_brand.updated_at, '{}'::jsonb, p_requested_by
  ) returning id into v_submission_id;

  insert into public.submission_images (
    submission_id, storage_path, url, source, status, tags, score, alt_zh,
    alt_en, width, height, dominant_color, sort_order, source_url, phash,
    created_at, origin_brand_image_id
  )
  select
    v_submission_id, null, image.url, image.source, 'active', image.tags,
    image.score, image.alt_zh, image.alt_en, image.width, image.height,
    image.dominant_color, image.sort_order, image.source_url, image.phash,
    image.created_at, image.id
  from public.brand_images as image
  where image.brand_id = p_brand_id and image.status = 'active'
  order by image.sort_order, image.created_at, image.id;

  insert into public.admin_audit_log (
    admin_user_id, admin_email, action, target_brand_slug, target_brand_id,
    metadata
  ) values (
    p_requested_by, p_requester_email, 'refresh_requested', v_brand.slug,
    p_brand_id, jsonb_build_object('submission_id', v_submission_id)
  );

  return v_submission_id;
exception
  when unique_violation then
    raise exception 'A refresh is already pending for this brand'
      using errcode = '23505';
end;
$$;

revoke all on function public.request_brand_refresh(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.request_brand_refresh(uuid, uuid, text)
  to service_role;

do $$
declare
  v_anomaly record;
  v_refresh_id uuid;
  v_base_data jsonb;
begin
  if exists (
    select 1
    from public.brand_submissions as submission
    left join public.brands as brand on brand.id = submission.brand_id
    where submission.status = 'pending'
      and submission.brand_id is not null
      and submission.intent <> 'refresh'
      and (
        brand.id is null
        or brand.status not in ('approved', 'hidden')
        or submission.reviewed_at is null
      )
  ) then
    raise exception 'Unmatched pending linked submission anomaly';
  end if;
  if exists (
    select 1
    from public.brand_submissions as submission
    where submission.status = 'pending'
      and submission.brand_id is not null
      and submission.intent <> 'refresh'
    group by submission.brand_id
    having count(*) > 1
  ) then
    raise exception 'Multiple pending linked submissions exist for one brand';
  end if;

  for v_anomaly in
    select submission.*, brand.updated_at as brand_updated_at,
      brand.slug as brand_slug, to_jsonb(brand) as brand_data
    from public.brand_submissions as submission
    join public.brands as brand on brand.id = submission.brand_id
    where submission.status = 'pending'
      and submission.brand_id is not null
      and submission.intent <> 'refresh'
    order by submission.submitted_at, submission.id
  loop
    update public.brand_submissions
    set status = 'approved'
    where id = v_anomaly.id;

    v_base_data := (v_anomaly.brand_data - 'search_vector' - 'draft_data')
      || jsonb_build_object(
        '_active_images', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', image.id,
            'storage_path', image.storage_path,
            'url', image.url,
            'source', image.source,
            'tags', image.tags,
            'score', image.score,
            'alt_zh', image.alt_zh,
            'alt_en', image.alt_en,
            'width', image.width,
            'height', image.height,
            'dominant_color', image.dominant_color,
            'sort_order', image.sort_order,
            'source_url', image.source_url,
            'phash', image.phash
          ) order by image.id::text)
          from public.brand_images as image
          where image.brand_id = v_anomaly.brand_id and image.status = 'active'
        ), '[]'::jsonb)
      );

    insert into public.brand_submissions (
      brand_id, intent, brand_name, submitter_email, submitter_name, status,
      base_brand_data, base_brand_updated_at, review_overrides,
      refresh_requested_by, submitted_at
    ) values (
      v_anomaly.brand_id, 'refresh', v_anomaly.brand_name,
      v_anomaly.submitter_email, v_anomaly.submitter_name, 'pending',
      v_base_data, v_anomaly.brand_updated_at, '{}'::jsonb,
      v_anomaly.reviewed_by, now()
    ) returning id into v_refresh_id;

    insert into public.submission_images (
      submission_id, storage_path, url, source, status, tags, score, alt_zh,
      alt_en, width, height, dominant_color, sort_order, source_url, phash,
      created_at, origin_brand_image_id
    )
    select
      v_refresh_id, null, image.url, image.source, 'active', image.tags,
      image.score, image.alt_zh, image.alt_en, image.width, image.height,
      image.dominant_color, image.sort_order, image.source_url, image.phash,
      image.created_at, image.id
    from public.brand_images as image
    where image.brand_id = v_anomaly.brand_id and image.status = 'active';
  end loop;
end;
$$;

create unique index brand_submissions_one_pending_refresh_idx
  on public.brand_submissions (brand_id)
  where intent = 'refresh' and status = 'pending';

create or replace function public.protect_refresh_snapshot()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.intent = 'refresh' and (
    new.intent is distinct from old.intent
    or new.brand_id is distinct from old.brand_id
    or new.base_brand_data is distinct from old.base_brand_data
    or new.base_brand_updated_at is distinct from old.base_brand_updated_at
  ) then
    raise exception 'Refresh snapshot is immutable';
  end if;
  if old.intent <> 'refresh' and new.intent = 'refresh' then
    raise exception 'Refresh requests must be inserted as new submissions';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_refresh_snapshot on public.brand_submissions;
create trigger protect_refresh_snapshot
before update on public.brand_submissions
for each row execute function public.protect_refresh_snapshot();

revoke all on function public.protect_refresh_snapshot() from public;

with latest_submission as (
  select distinct on (submission.brand_id)
    submission.brand_id,
    submission.is_brand_owner,
    submission.enriched_data,
    jsonb_strip_nulls(jsonb_build_object(
      'name', submission.brand_name,
      'description', submission.description,
      'hero_image_url', submission.hero_image_url,
      'social_instagram', submission.social_instagram,
      'social_threads', submission.social_threads,
      'social_facebook', submission.social_facebook,
      'purchase_website', coalesce(submission.purchase_website, submission.website_url),
      'purchase_pinkoi', submission.purchase_pinkoi,
      'purchase_shopee', submission.purchase_shopee,
      'other_urls', submission.other_urls,
      'product_tags', case jsonb_typeof(submission.suggested_tags)
        when 'array' then submission.suggested_tags
        when 'object' then submission.suggested_tags -> 'values'
        else null
      end,
      'product_type', case when jsonb_typeof(submission.suggested_tags) = 'object'
        then submission.suggested_tags -> 'productType'
        else null
      end
    )) || coalesce(jsonb_strip_nulls(jsonb_build_object(
      'description', submission.owner_data -> 'description',
      'hero_image_url', submission.owner_data -> 'heroImageUrl',
      'product_type', submission.owner_data -> 'productType',
      'founding_year', submission.owner_data -> 'foundingYear',
      'city', submission.owner_data -> 'city',
      'price_range', submission.owner_data -> 'priceRange',
      'product_tags', submission.owner_data -> 'productTags',
      'retail_locations', submission.owner_data -> 'retailLocations',
      'mit_story', submission.owner_data -> 'mitStory',
      'social_instagram', submission.owner_data -> 'socialInstagram',
      'social_threads', submission.owner_data -> 'socialThreads',
      'social_facebook', submission.owner_data -> 'socialFacebook',
      'purchase_website', submission.owner_data -> 'purchaseWebsite',
      'purchase_pinkoi', submission.owner_data -> 'purchasePinkoi',
      'purchase_shopee', submission.owner_data -> 'purchaseShopee'
    )), '{}'::jsonb) as raw_data
  from public.brand_submissions as submission
  where submission.brand_id is not null
    and submission.status = 'approved'
    and submission.intent <> 'refresh'
  order by submission.brand_id, submission.reviewed_at desc nulls last,
    submission.submitted_at desc, submission.id desc
), classified as (
  select state.brand_id, state.field,
    case
      when latest.raw_data ? state.field
        and to_jsonb(brand) -> state.field = latest.raw_data -> state.field
        then case when coalesce(latest.is_brand_owner, false)
          then 'owner' else 'submitted' end
      when coalesce(latest.enriched_data, '{}'::jsonb) ? state.field
        and to_jsonb(brand) -> state.field = latest.enriched_data -> state.field
        then 'enriched'
      else 'admin'
    end as source
  from public.brand_field_state as state
  join public.brands as brand on brand.id = state.brand_id
  left join latest_submission as latest on latest.brand_id = state.brand_id
)
update public.brand_field_state as state
set source = classified.source,
    updated_by = case when classified.source = 'admin' then state.updated_by else null end,
    updated_at = now()
from classified
where state.brand_id = classified.brand_id and state.field = classified.field;

with latest_human_event as (
  select distinct on (event.brand_id, event.field)
    event.brand_id, event.field, event.source, event.actor, event.created_at
  from public.brand_field_events as event
  where event.source in ('owner', 'admin')
  order by event.brand_id, event.field, event.created_at desc, event.id desc
)
update public.brand_field_state as state
set source = event.source,
    updated_by = event.actor,
    updated_at = greatest(state.updated_at, event.created_at)
from latest_human_event as event
where state.brand_id = event.brand_id and state.field = event.field;

create or replace function public.correct_approved_submission_provenance()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_raw_data jsonb;
begin
  if old.status = 'pending' and new.status = 'approved'
    and new.intent <> 'refresh' and new.brand_id is not null then
    v_raw_data := jsonb_strip_nulls(jsonb_build_object(
      'name', new.brand_name,
      'description', new.description,
      'hero_image_url', new.hero_image_url,
      'social_instagram', new.social_instagram,
      'social_threads', new.social_threads,
      'social_facebook', new.social_facebook,
      'purchase_website', coalesce(new.purchase_website, new.website_url),
      'purchase_pinkoi', new.purchase_pinkoi,
      'purchase_shopee', new.purchase_shopee,
      'other_urls', new.other_urls,
      'product_tags', case jsonb_typeof(new.suggested_tags)
        when 'array' then new.suggested_tags
        when 'object' then new.suggested_tags -> 'values'
        else null
      end,
      'product_type', case when jsonb_typeof(new.suggested_tags) = 'object'
        then new.suggested_tags -> 'productType'
        else null
      end
    )) || coalesce(jsonb_strip_nulls(jsonb_build_object(
      'description', new.owner_data -> 'description',
      'hero_image_url', new.owner_data -> 'heroImageUrl',
      'product_type', new.owner_data -> 'productType',
      'founding_year', new.owner_data -> 'foundingYear',
      'city', new.owner_data -> 'city',
      'price_range', new.owner_data -> 'priceRange',
      'product_tags', new.owner_data -> 'productTags',
      'retail_locations', new.owner_data -> 'retailLocations',
      'mit_story', new.owner_data -> 'mitStory',
      'social_instagram', new.owner_data -> 'socialInstagram',
      'social_threads', new.owner_data -> 'socialThreads',
      'social_facebook', new.owner_data -> 'socialFacebook',
      'purchase_website', new.owner_data -> 'purchaseWebsite',
      'purchase_pinkoi', new.owner_data -> 'purchasePinkoi',
      'purchase_shopee', new.owner_data -> 'purchaseShopee'
    )), '{}'::jsonb);

    insert into public.brand_field_state (
      brand_id, field, source, updated_by, updated_at
    )
    select new.brand_id, entry.key, 'admin', new.reviewed_by, now()
    from jsonb_each(coalesce(new.review_overrides, '{}'::jsonb)) as entry
    on conflict (brand_id, field) do update set
      source = excluded.source,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at;

    update public.brand_field_state as state
    set source = case
          when coalesce(new.review_overrides, '{}'::jsonb) ? state.field then 'admin'
          when v_raw_data ? state.field
            and to_jsonb(brand) -> state.field = v_raw_data -> state.field
            then case when coalesce(new.is_brand_owner, false)
              then 'owner' else 'submitted' end
          when coalesce(new.enriched_data, '{}'::jsonb) ? state.field then 'enriched'
          when coalesce(new.is_brand_owner, false) then 'owner'
          else 'submitted'
        end,
        updated_by = case
          when coalesce(new.review_overrides, '{}'::jsonb) ? state.field
            then new.reviewed_by
          else null
        end,
        updated_at = now()
    from public.brands as brand
    where state.brand_id = new.brand_id and brand.id = new.brand_id;
  end if;
  return new;
end;
$$;

drop trigger if exists correct_approved_submission_provenance
  on public.brand_submissions;
create trigger correct_approved_submission_provenance
after update of status on public.brand_submissions
for each row execute function public.correct_approved_submission_provenance();

create or replace function public.save_submission_review(
  p_submission_id uuid,
  p_review_data jsonb,
  p_images jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_submission public.brand_submissions%rowtype;
  v_image_count integer;
  v_hero_count integer;
begin
  select * into v_submission
  from public.brand_submissions
  where id = p_submission_id and status = 'pending'
  for update;

  if not found or (v_submission.brand_id is not null and v_submission.intent <> 'refresh') then
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;
  if exists (
    select 1
    from public.curation_job_targets as target
    join public.curation_jobs as job on job.id = target.job_id
    where target.target_type = 'submission'
      and target.target_id = p_submission_id
      and target.status in ('pending', 'running')
      and job.status in ('pending', 'running')
      and job.dispatch_status <> 'failed'
  ) then
    raise exception 'Submission enrichment is still active';
  end if;
  if jsonb_typeof(coalesce(p_review_data, 'null'::jsonb)) <> 'object' then
    raise exception 'Invalid submission review data';
  end if;
  if jsonb_typeof(coalesce(p_images, 'null'::jsonb)) <> 'array' then
    raise exception 'Invalid submission review images';
  end if;

  select count(*), count(*) filter (
    where coalesce((image ->> 'is_hero')::boolean, false)
  ) into v_image_count, v_hero_count
  from jsonb_array_elements(p_images) as selected(image);

  if v_image_count > 7 then
    raise exception 'Submission review supports at most 7 images';
  end if;
  if (v_image_count = 0 and v_hero_count <> 0)
    or (v_image_count > 0 and v_hero_count <> 1) then
    raise exception 'Submission review must select exactly one hero image';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_images) as selected(image)
    where (image ->> 'sort_order')::integer not between 0 and 6
      or (coalesce((image ->> 'is_hero')::boolean, false)
        and (image ->> 'sort_order')::integer <> 0)
  ) then
    raise exception 'Invalid submission review image ordering';
  end if;
  if (
    select count(distinct image ->> 'id') <> count(*)
      or count(distinct (image ->> 'sort_order')::integer) <> count(*)
    from jsonb_array_elements(p_images) as selected(image)
  ) then
    raise exception 'Duplicate submission review image selection';
  end if;

  perform 1 from public.submission_images
  where submission_id = p_submission_id for update;

  if (
    select count(*)
    from public.submission_images as image
    where image.submission_id = p_submission_id
      and image.id in (
        select (selected.image ->> 'id')::uuid
        from jsonb_array_elements(p_images) as selected(image)
      )
      and image.status in ('active', 'draft')
  ) <> v_image_count then
    raise exception 'Submission review contains unavailable images';
  end if;
  if exists (
    select 1
    from public.submission_images as image
    where image.submission_id = p_submission_id
      and image.origin_brand_image_id is not null
      and image.source in ('owner', 'admin')
      and image.id not in (
        select (selected.image ->> 'id')::uuid
        from jsonb_array_elements(p_images) as selected(image)
      )
  ) then
    raise exception 'Owner and admin images must be preserved';
  end if;

  update public.submission_images as image
  set status = 'rejected'
  where image.submission_id = p_submission_id
    and image.status in ('active', 'draft')
    and image.id not in (
      select (selected.image ->> 'id')::uuid
      from jsonb_array_elements(p_images) as selected(image)
    );

  update public.submission_images as image
  set status = 'active', sort_order = (selected.image ->> 'sort_order')::integer
  from jsonb_array_elements(p_images) as selected(image)
  where image.submission_id = p_submission_id
    and image.id = (selected.image ->> 'id')::uuid;

  update public.brand_submissions
  set review_overrides = p_review_data
  where id = p_submission_id;
end;
$$;

revoke all on function public.save_submission_review(uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_submission_review(uuid, jsonb, jsonb)
  to service_role;

create or replace function public.apply_brand_refresh(
  p_submission_id uuid,
  p_reviewer_id uuid
)
returns text[]
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_submission public.brand_submissions%rowtype;
  v_brand public.brands%rowtype;
  v_latest_target_status text;
  v_latest_job_id uuid;
  v_current_image_snapshot jsonb;
  v_effective jsonb;
  v_enrichment_patch jsonb;
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
      using errcode = '40001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', image.id,
    'storage_path', image.storage_path,
    'url', image.url,
    'source', image.source,
    'tags', image.tags,
    'score', image.score,
    'alt_zh', image.alt_zh,
    'alt_en', image.alt_en,
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
      using errcode = '40001';
  end if;

  if exists (
    select 1
    from jsonb_each(coalesce(v_submission.enriched_data, '{}'::jsonb)) as entry
    join public.brand_field_state as state
      on state.brand_id = v_brand.id and state.field = entry.key
    where (state.admin_locked or state.source in ('owner', 'admin', 'submitted'))
      and entry.key = any(array[
        'description', 'description_en', 'blurb', 'blurb_en', 'city',
        'category_attributes', 'reputation_summary', 'retail_locations',
        'mit_evidence', 'site_content', 'founding_year', 'hero_image_url',
        'product_type', 'price_range', 'product_tags', 'product_tags_en',
        'social_instagram', 'social_threads', 'social_facebook',
        'purchase_website', 'purchase_pinkoi', 'purchase_shopee', 'other_urls'
      ])
  ) then
    raise exception 'Refresh is stale: field protection changed after enrichment'
      using errcode = '40001';
  end if;

  select coalesce(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
  into v_enrichment_patch
  from jsonb_each(coalesce(v_submission.enriched_data, '{}'::jsonb)) as entry
  where entry.key = any(array[
    'description', 'description_en', 'blurb', 'blurb_en', 'city',
    'category_attributes', 'reputation_summary', 'retail_locations',
    'mit_evidence', 'site_content', 'founding_year', 'hero_image_url',
    'product_type', 'price_range', 'product_tags', 'product_tags_en',
    'social_instagram', 'social_threads', 'social_facebook',
    'purchase_website', 'purchase_pinkoi', 'purchase_shopee', 'other_urls'
  ]);
  select coalesce(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
  into v_admin_patch
  from jsonb_each(coalesce(v_submission.review_overrides, '{}'::jsonb)) as entry
  where entry.key = any(array[
    'name', 'description', 'description_en', 'blurb', 'blurb_en', 'city',
    'category_attributes', 'reputation_summary', 'retail_locations',
    'mit_evidence', 'site_content', 'founding_year', 'hero_image_url',
    'product_type', 'price_range', 'product_tags', 'product_tags_en',
    'social_instagram', 'social_threads', 'social_facebook',
    'purchase_website', 'purchase_pinkoi', 'purchase_shopee', 'other_urls'
  ]);
  v_effective := (v_submission.base_brand_data - '_active_images')
    || v_enrichment_patch || v_admin_patch;

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
    or nullif(btrim(v_effective ->> 'purchase_website'), '') is null
    or (v_effective ->> 'purchase_website') !~*
      '^https?://[^/@[:space:]]+([/:?#][^[:space:]]*)?$'
    or nullif(btrim(v_effective ->> 'hero_image_url'), '') is null
    or (
      select count(*)
      from public.submission_images as image
      where image.submission_id = p_submission_id and image.status = 'active'
    ) not between 2 and 7
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
        and image.sort_order not between 0 and 6
    )
    or (
      select count(*)
      from public.submission_images as image
      where image.submission_id = p_submission_id and image.status = 'active'
        and image.sort_order = 0
    ) <> 1
    or (
      select count(*)
      from public.submission_images as image
      where image.submission_id = p_submission_id and image.status = 'active'
        and image.sort_order = 0
        and image.url = v_effective ->> 'hero_image_url'
    ) <> 1
  then
    raise exception 'Refresh must satisfy publishable core before apply';
  end if;

  for v_entry in select key, value from jsonb_each(v_enrichment_patch)
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
      alt_zh = reference.alt_zh, alt_en = reference.alt_en,
      tags = reference.tags, score = reference.score
  from public.submission_images as reference
  where reference.submission_id = p_submission_id
    and reference.origin_brand_image_id = image.id
    and reference.status = 'active';

  insert into public.brand_images (
    brand_id, storage_path, url, source, status, tags, score, alt_zh, alt_en,
    width, height, dominant_color, sort_order, source_url, phash, created_at
  )
  select
    v_brand.id, image.storage_path, image.url, image.source, 'active',
    image.tags, image.score, image.alt_zh, image.alt_en, image.width,
    image.height, image.dominant_color, image.sort_order, image.source_url,
    image.phash, image.created_at
  from public.submission_images as image
  where image.submission_id = p_submission_id
    and image.status = 'active'
    and image.origin_brand_image_id is null
  on conflict (brand_id, source_url) do update set
    storage_path = excluded.storage_path, url = excluded.url,
    source = excluded.source, status = 'active', tags = excluded.tags,
    score = excluded.score, alt_zh = excluded.alt_zh, alt_en = excluded.alt_en,
    width = excluded.width, height = excluded.height,
    dominant_color = excluded.dominant_color, sort_order = excluded.sort_order,
    phash = excluded.phash;

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
  set brand_enriched_at = now(), status = v_brand.status
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
$$;

revoke all on function public.apply_brand_refresh(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.apply_brand_refresh(uuid, uuid)
  to service_role;

create or replace function public.reject_submission(
  p_submission_id uuid,
  p_reviewer_id uuid,
  p_denial_reason text,
  p_reviewer_notes text
)
returns text[]
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_storage_paths text[];
begin
  perform 1 from public.brand_submissions
  where id = p_submission_id and status = 'pending'
  for update;
  if not found then
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;
  if exists (
    select 1
    from public.curation_job_targets as target
    join public.curation_jobs as job on job.id = target.job_id
    where target.target_type = 'submission'
      and target.target_id = p_submission_id
      and target.status in ('pending', 'running')
      and job.status in ('pending', 'running')
      and job.dispatch_status <> 'failed'
  ) then
    raise exception 'Submission enrichment is still active';
  end if;

  select coalesce(array_agg(storage_path) filter (where storage_path is not null), '{}'::text[])
  into v_storage_paths
  from public.submission_images
  where submission_id = p_submission_id and origin_brand_image_id is null;

  delete from public.submission_images where submission_id = p_submission_id;
  update public.brand_submissions
  set status = 'rejected', reviewed_at = now(), reviewed_by = p_reviewer_id,
      denial_reason = p_denial_reason,
      reviewer_notes = nullif(p_reviewer_notes, '')
  where id = p_submission_id and status = 'pending';
  if not found then
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;
  return v_storage_paths;
end;
$$;

revoke all on function public.reject_submission(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.reject_submission(uuid, uuid, text, text)
  to service_role;

commit;
