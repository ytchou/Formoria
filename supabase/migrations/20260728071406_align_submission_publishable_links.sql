begin;

-- Keep the database publishability guard aligned with
-- getSubmissionReviewCompleteness: any public website, social profile, or
-- supported marketplace link satisfies the link requirement.
do $migration$
declare
  v_definition text;
  v_updated_definition text;
begin
  select pg_get_functiondef(
    'public.approve_submission(uuid,uuid,jsonb)'::regprocedure
  ) into v_definition;

  v_updated_definition := replace(
    v_definition,
    $old$
    or nullif(btrim(v_website_url), '') is null
    or v_website_url !~* '^https?://[^/@[:space:]]+([/:?#][^[:space:]]*)?$'$old$,
    $new$
    or not (
      coalesce(v_website_url ~* '^https?://[^/@[:space:]]+([/:?#][^[:space:]]*)?$', false)
      or nullif(btrim(p_brand_data ->> 'social_instagram'), '') is not null
      or nullif(btrim(p_brand_data ->> 'social_threads'), '') is not null
      or nullif(btrim(p_brand_data ->> 'social_facebook'), '') is not null
      or coalesce(
        (p_brand_data ->> 'purchase_pinkoi') ~*
          '^https?://[^/@[:space:]]+([/:?#][^[:space:]]*)?$',
        false
      )
      or coalesce(
        (p_brand_data ->> 'purchase_shopee') ~*
          '^https?://[^/@[:space:]]+([/:?#][^[:space:]]*)?$',
        false
      )
    )$new$
  );

  if v_updated_definition = v_definition then
    raise exception 'approve_submission publishable-link guard was not found';
  end if;
  execute v_updated_definition;

  select pg_get_functiondef(
    'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure
  ) into v_definition;

  v_updated_definition := replace(
    v_definition,
    $old$
    or nullif(btrim(v_effective ->> 'purchase_website'), '') is null
    or (v_effective ->> 'purchase_website') !~*
      '^https?://[^/@[:space:]]+([/:?#][^[:space:]]*)?$'$old$,
    $new$
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
    )$new$
  );

  if v_updated_definition = v_definition then
    raise exception 'apply_brand_refresh publishable-link guard was not found';
  end if;

  v_definition := v_updated_definition;
  v_updated_definition := replace(
    v_definition,
    $old$  v_effective jsonb;
  v_enrichment_patch jsonb;$old$,
    $new$  v_effective jsonb;
  v_selected_hero_url text;
  v_enrichment_patch jsonb;$new$
  );
  if v_updated_definition = v_definition then
    raise exception 'apply_brand_refresh hero declaration was not found';
  end if;

  v_definition := v_updated_definition;
  v_updated_definition := replace(
    v_definition,
    $old$  v_effective := (v_submission.base_brand_data - '_active_images')
    || v_enrichment_patch || v_admin_patch;$old$,
    $new$  v_effective := (v_submission.base_brand_data - '_active_images')
    || v_enrichment_patch || v_admin_patch;

  if not (
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
  end if;$new$
  );
  if v_updated_definition = v_definition then
    raise exception 'apply_brand_refresh selected-hero assignment was not found';
  end if;
  execute v_updated_definition;
end;
$migration$;

commit;
