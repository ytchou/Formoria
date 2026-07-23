begin;

create function public.apply_brand_refresh_locations(
  p_submission_ids uuid[],
  p_reviewer_id uuid
)
returns table(applied_submission_id uuid, applied_brand_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_expected_count integer;
  v_submission public.brand_submissions%rowtype;
  v_brand public.brands%rowtype;
  v_latest_target_status text;
  v_latest_job_id uuid;
  v_base_image_snapshot jsonb;
  v_submission_image_snapshot jsonb;
  v_old_locations jsonb;
  v_new_locations jsonb;
begin
  select count(distinct id)
  into v_expected_count
  from unnest(coalesce(p_submission_ids, '{}'::uuid[])) as ids(id);

  if v_expected_count = 0
    or v_expected_count <> cardinality(p_submission_ids) then
    raise exception 'Location refresh apply requires unique submission ids';
  end if;

  perform submission.id
  from public.brand_submissions as submission
  where submission.id = any(p_submission_ids)
  order by submission.id
  for update;

  if (select count(*) from public.brand_submissions where id = any(p_submission_ids))
    <> v_expected_count then
    raise exception 'Location refresh submission not found' using errcode = 'P0002';
  end if;

  perform brand.id
  from public.brands as brand
  join public.brand_submissions as submission on submission.brand_id = brand.id
  where submission.id = any(p_submission_ids)
  order by brand.id
  for update of brand;

  for v_submission in
    select submission.*
    from public.brand_submissions as submission
    where submission.id = any(p_submission_ids)
    order by submission.id
  loop
    if v_submission.status <> 'pending'
      or v_submission.intent <> 'refresh'
      or v_submission.brand_id is null then
      raise exception 'Location refresh submission already processed';
    end if;

    select target.status, target.job_id
    into v_latest_target_status, v_latest_job_id
    from public.curation_job_targets as target
    where target.target_type = 'submission'
      and target.target_id = v_submission.id
    order by target.created_at desc, target.id desc
    limit 1;
    if v_latest_target_status is distinct from 'succeeded' then
      raise exception 'Location refresh requires a successful enrichment run';
    end if;

    select *
    into v_brand
    from public.brands
    where id = v_submission.brand_id;
    if not found or v_brand.status not in ('approved', 'hidden') then
      raise exception 'Location refresh brand is no longer approved or hidden';
    end if;
    if v_brand.updated_at is distinct from v_submission.base_brand_updated_at then
      raise exception 'Location refresh is stale: brand changed after request'
        using errcode = '40001';
    end if;

    if jsonb_typeof(v_submission.enriched_data -> 'retail_locations') <> 'array'
      or jsonb_array_length(v_submission.enriched_data -> 'retail_locations') = 0
      or exists (
        select 1
        from jsonb_object_keys(coalesce(v_submission.enriched_data, '{}'::jsonb)) as key
        where key <> 'retail_locations'
      )
      or coalesce(v_submission.review_overrides, '{}'::jsonb) <> '{}'::jsonb then
      raise exception 'Location-only refresh contains non-location changes';
    end if;

    if exists (
      select 1
      from public.submission_images as image
      where image.submission_id = v_submission.id
        and (image.origin_brand_image_id is null or image.status <> 'active')
    ) then
      raise exception 'Location-only refresh contains image changes';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'id', image.origin_brand_image_id,
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
    ) order by image.origin_brand_image_id::text), '[]'::jsonb)
    into v_submission_image_snapshot
    from public.submission_images as image
    where image.submission_id = v_submission.id
      and image.status = 'active'
      and image.origin_brand_image_id is not null;
    select coalesce(jsonb_agg(image.value - 'storage_path'
      order by image.value ->> 'id'), '[]'::jsonb)
    into v_base_image_snapshot
    from jsonb_array_elements(
      coalesce(v_submission.base_brand_data -> '_active_images', '[]'::jsonb)
    ) as image(value);
    if v_submission_image_snapshot is distinct from v_base_image_snapshot then
      raise exception 'Location-only refresh contains image changes';
    end if;

    v_old_locations := coalesce(v_brand.retail_locations, '[]'::jsonb);
    v_new_locations := v_submission.enriched_data -> 'retail_locations';

    if exists (
      select 1
      from jsonb_array_elements(v_new_locations) as incoming(location)
      where incoming.location ->> 'kind' = 'location'
        and incoming.location ->> 'confirmationStatus' = 'owner_confirmed'
        and not exists (
          select 1
          from jsonb_array_elements(v_old_locations) as current(location)
          where current.location ->> 'kind' = 'location'
            and current.location ->> 'confirmationStatus' = 'owner_confirmed'
            and regexp_replace(lower(coalesce(current.location ->> 'name', '')), '[[:space:]]', '', 'g')
              = regexp_replace(lower(coalesce(incoming.location ->> 'name', '')), '[[:space:]]', '', 'g')
            and regexp_replace(lower(coalesce(current.location ->> 'address', '')), '[[:space:]]', '', 'g')
              = regexp_replace(lower(coalesce(incoming.location ->> 'address', '')), '[[:space:]]', '', 'g')
            and coalesce(current.location ->> 'relationshipType', 'stockist')
              = coalesce(incoming.location ->> 'relationshipType', 'stockist')
            and regexp_replace(btrim(lower(coalesce(current.location ->> 'venueName', ''))), '[[:space:]]+', ' ', 'g')
              = regexp_replace(btrim(lower(coalesce(incoming.location ->> 'venueName', ''))), '[[:space:]]+', ' ', 'g')
            and regexp_replace(btrim(lower(coalesce(current.location ->> 'floorOrCounter', ''))), '[[:space:]]+', ' ', 'g')
              = regexp_replace(btrim(lower(coalesce(incoming.location ->> 'floorOrCounter', ''))), '[[:space:]]+', ' ', 'g')
            and nullif(current.location ->> 'latitude', '')::numeric
              is not distinct from nullif(incoming.location ->> 'latitude', '')::numeric
            and nullif(current.location ->> 'longitude', '')::numeric
              is not distinct from nullif(incoming.location ->> 'longitude', '')::numeric
        )
    ) then
      raise exception 'Location enrichment cannot grant owner confirmation';
    end if;

    if v_new_locations is distinct from v_old_locations then
      update public.brands
      set retail_locations = v_new_locations,
          brand_enriched_at = now()
      where id = v_brand.id;

      insert into public.brand_field_state (
        brand_id, field, source, updated_by, updated_at
      ) values (
        v_brand.id, 'retail_locations', 'enriched', null, now()
      ) on conflict (brand_id, field) do nothing;

      insert into public.brand_field_events (
        brand_id, field, old_value, new_value, source, actor, job_id
      ) values (
        v_brand.id, 'retail_locations', v_old_locations, v_new_locations,
        'enriched', null, v_latest_job_id
      );
    end if;

    delete from public.submission_images
    where submission_id = v_submission.id;

    update public.brand_ai_results
    set brand_id = v_brand.id, submission_id = null
    where submission_id = v_submission.id;
    update public.brand_search_results
    set brand_id = v_brand.id, submission_id = null
    where submission_id = v_submission.id;

    update public.brand_submissions
    set status = 'approved', reviewed_at = now(), reviewed_by = p_reviewer_id
    where id = v_submission.id and status = 'pending';
    if not found then
      raise exception 'Location refresh submission not found' using errcode = 'P0002';
    end if;

    applied_submission_id := v_submission.id;
    applied_brand_id := v_brand.id;
    return next;
  end loop;
end;
$$;

revoke all on function public.apply_brand_refresh_locations(uuid[], uuid)
  from public, anon, authenticated;
grant execute on function public.apply_brand_refresh_locations(uuid[], uuid)
  to service_role;

commit;
