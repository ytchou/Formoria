begin;

-- Active image ordering is the source of truth for hero identity. The brands
-- column remains a list-view cache and zero-image legacy fallback.
do $migration$
declare
  v_definition text;
  v_updated_definition text;
begin
  select pg_get_functiondef(
    'public.save_submission_review(uuid,jsonb,jsonb)'::regprocedure
  ) into v_definition;

  v_updated_definition := replace(
    v_definition,
    $old$  v_image_count integer;
  v_hero_count integer;$old$,
    $new$  v_image_count integer;$new$
  );
  v_updated_definition := replace(
    v_updated_definition,
    $old$  select count(*), count(*) filter (
    where coalesce((image ->> 'is_hero')::boolean, false)
  ) into v_image_count, v_hero_count
  from jsonb_array_elements(p_images) as selected(image);$old$,
    $new$  select count(*) into v_image_count
  from jsonb_array_elements(p_images) as selected(image);$new$
  );
  v_updated_definition := replace(
    v_updated_definition,
    $old$  if (v_image_count = 0 and v_hero_count <> 0)
    or (v_image_count > 0 and v_hero_count <> 1) then
    raise exception 'Submission review must select exactly one hero image';
  end if;
$old$,
    $new$$new$
  );
  v_updated_definition := replace(
    v_updated_definition,
    $old$    where (image ->> 'sort_order')::integer not between 0 and 6
      or (coalesce((image ->> 'is_hero')::boolean, false)
        and (image ->> 'sort_order')::integer <> 0)$old$,
    $new$    where (image ->> 'sort_order')::integer not between 0 and 6$new$
  );
  v_updated_definition := replace(
    v_updated_definition,
    $old$  set review_overrides = p_review_data$old$,
    $new$  set review_overrides = p_review_data - 'hero_image_url'$new$
  );
  if v_updated_definition = v_definition
    or position('v_hero_count' in v_updated_definition) > 0
    or position('is_hero' in v_updated_definition) > 0
    or position(
      'set review_overrides = p_review_data - ''hero_image_url'''
      in v_updated_definition
    ) = 0 then
    raise exception 'save_submission_review hero guards were not found';
  end if;
  execute v_updated_definition;

  select pg_get_functiondef(
    'public.approve_submission(uuid,uuid,jsonb)'::regprocedure
  ) into v_definition;

  v_updated_definition := replace(
    v_definition,
    $old$  v_hero_url := nullif(btrim(p_brand_data ->> 'hero_image_url'), '');$old$,
    $new$  select image.url
  into v_hero_url
  from public.submission_images as image
  where image.submission_id = p_submission_id
    and image.status = 'active'
  order by image.sort_order, image.created_at, image.id
  limit 1;

  p_brand_data := p_brand_data - 'hero_image_url';$new$
  );
  v_updated_definition := replace(
    v_updated_definition,
    $old$    or v_hero_url is null
$old$,
    $new$$new$
  );
  v_updated_definition := replace(
    v_updated_definition,
    $old$    or (
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
$old$,
    $new$$new$
  );
  v_updated_definition := replace(
    v_updated_definition,
    $old$  order by image.sort_order, image.created_at, image.id;

  delete from public.submission_images$old$,
    $new$  order by image.sort_order, image.created_at, image.id;

  update public.brands
  set hero_image_url = v_hero_url
  where id = v_brand_id;

  delete from public.submission_images$new$
  );
  if v_updated_definition = v_definition
    or position(
      'v_hero_url := nullif(btrim(p_brand_data ->> ''hero_image_url''), '''')'
      in v_updated_definition
    ) > 0
    or position('and image.sort_order = 0' in v_updated_definition) > 0
    or position('set hero_image_url = v_hero_url' in v_updated_definition) = 0
    or position('p_brand_data := p_brand_data - ''hero_image_url''' in v_updated_definition) = 0 then
    raise exception 'approve_submission hero derivation points were not found';
  end if;
  execute v_updated_definition;

  select pg_get_functiondef(
    'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure
  ) into v_definition;

  v_updated_definition := replace(
    v_definition,
    $old$        'mit_evidence', 'site_content', 'founding_year', 'hero_image_url',$old$,
    $new$        'mit_evidence', 'site_content', 'founding_year',$new$
  );
  v_updated_definition := replace(
    v_updated_definition,
    $old$    'mit_evidence', 'site_content', 'founding_year', 'hero_image_url',$old$,
    $new$    'mit_evidence', 'site_content', 'founding_year',$new$
  );
  v_updated_definition := replace(
    v_updated_definition,
    $old$  if not (
    coalesce(v_submission.review_overrides, '{}'::jsonb) ? 'hero_image_url'
  ) then
    select image.url
    into v_selected_hero_url
    from public.submission_images as image
    where image.submission_id = p_submission_id
      and image.status = 'active'
      and image.sort_order = 0
    limit 1;
    if found then
      v_enrichment_patch := jsonb_set(
        v_enrichment_patch,
        '{hero_image_url}',
        to_jsonb(v_selected_hero_url),
        true
      );
      v_effective := jsonb_set(
        v_effective,
        '{hero_image_url}',
        to_jsonb(v_selected_hero_url),
        true
      );
    end if;
  end if;$old$,
    $new$  select image.url
  into v_selected_hero_url
  from public.submission_images as image
  where image.submission_id = p_submission_id
    and image.status = 'active'
  order by image.sort_order, image.created_at, image.id
  limit 1;$new$
  );
  v_updated_definition := replace(
    v_updated_definition,
    $old$    or nullif(btrim(v_effective ->> 'hero_image_url'), '') is null
$old$,
    $new$$new$
  );
  v_updated_definition := replace(
    v_updated_definition,
    $old$    or (
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
$old$,
    $new$$new$
  );
  v_updated_definition := replace(
    v_updated_definition,
    $old$  set brand_enriched_at = now(), status = v_brand.status$old$,
    $new$  set brand_enriched_at = now(), status = v_brand.status,
      hero_image_url = v_selected_hero_url$new$
  );
  if v_updated_definition = v_definition
    or position('and image.sort_order = 0' in v_updated_definition) > 0
    or position(
      'nullif(btrim(v_effective ->> ''hero_image_url''), '''') is null'
      in v_updated_definition
    ) > 0
    or position(
      '''mit_evidence'', ''site_content'', ''founding_year'', ''hero_image_url'''
      in v_updated_definition
    ) > 0
    or position('hero_image_url = v_selected_hero_url' in v_updated_definition) = 0 then
    raise exception 'apply_brand_refresh hero derivation points were not found';
  end if;
  execute v_updated_definition;
end
$migration$;

commit;
