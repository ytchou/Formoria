begin;

-- A refresh could add a field value and change a field value, but never empty
-- one. When a phase decides a field has no qualifying content it omits the key
-- from `enriched_data` rather than writing null, and the apply RPC builds its
-- patch with `jsonb_each(enriched_data)` — which only yields keys that exist —
-- so `base || patch` left the stale value live. Three of fifteen production
-- brands kept a `reputation_summary` the pipeline had already judged
-- unqualified, and no tightened prompt could ever remove it.
--
-- The fix is an explicit sentinel, not "write null instead of omitting": an
-- absent key still has to mean "no opinion", because a DETAIL-only or
-- IMAGE-only run omits every key the phases it skipped would own.
-- `enriched_data._cleared_fields` is a string[] of fields the enrichment RAN ON
-- and affirmatively determined should be empty. Only those are cleared.
do $migration$
declare
  v_definition text;
  v_anchor text;
  v_count integer;
  v_pos_effective integer;
  v_pos_loop integer;
begin
  select pg_get_functiondef(
    'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure
  ) into v_definition;

  -- The staleness re-check joins `brand_field_state` on `v_brand.id`; the
  -- cleared-field arm added below reuses that variable, so fail loudly here
  -- rather than emitting a body that will not compile.
  if position('state.brand_id = v_brand.id' in v_definition) = 0 then
    raise exception 'apply_brand_refresh protection re-check no longer joins brand_field_state on v_brand.id';
  end if;

  -- 1. Declare the cleared patch alongside the enrichment patch.
  v_anchor := $anchor$  v_enrichment_patch jsonb;$anchor$;
  v_count := (length(v_definition) - length(replace(v_definition, v_anchor, ''))) / length(v_anchor);
  if v_count <> 1 then
    raise exception 'Expected one v_enrichment_patch declaration, found %', v_count;
  end if;
  v_definition := replace(
    v_definition,
    v_anchor,
    $new$  v_enrichment_patch jsonb;
  v_cleared_patch jsonb;$new$
  );

  -- 2. Build the cleared patch and fold it into the effective row. It is
  -- filtered through the same allow-list the enrichment patch uses, so a
  -- sentinel naming an identity column can never empty it. Order matters:
  -- cleared first, so an explicit value in the enrichment patch still wins if a
  -- field somehow appears in both, and admin overrides win over both.
  v_anchor := $anchor$  v_effective := (v_submission.base_brand_data - '_active_images')
    || v_enrichment_patch || v_admin_patch;$anchor$;
  v_count := (length(v_definition) - length(replace(v_definition, v_anchor, ''))) / length(v_anchor);
  if v_count <> 1 then
    raise exception 'Expected one effective-row assembly, found %', v_count;
  end if;
  v_pos_effective := position(v_anchor in v_definition);
  v_definition := replace(
    v_definition,
    v_anchor,
    $new$  select coalesce(jsonb_object_agg(f.field, 'null'::jsonb), '{}'::jsonb)
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
    'purchase_website', 'purchase_pinkoi', 'purchase_shopee', 'other_urls'
  ]);

  v_effective := (v_submission.base_brand_data - '_active_images')
    || v_cleared_patch || v_enrichment_patch || v_admin_patch;$new$
  );

  -- 3. A cleared field has to update `brand_field_state` and provenance exactly
  -- as a changed field does, otherwise the row keeps claiming a value the brand
  -- no longer has.
  v_anchor := $anchor$  for v_entry in select key, value from jsonb_each(v_enrichment_patch)$anchor$;
  v_count := (length(v_definition) - length(replace(v_definition, v_anchor, ''))) / length(v_anchor);
  if v_count <> 1 then
    raise exception 'Expected one enrichment-patch provenance loop, found %', v_count;
  end if;
  v_pos_loop := position(v_anchor in v_definition);
  -- `v_cleared_patch` is assigned in step 2; if the provenance loop ever moves
  -- above that assignment it would read null and silently skip every clear.
  if v_pos_loop < v_pos_effective then
    raise exception 'Provenance loop now precedes the effective-row assembly; v_cleared_patch would be null';
  end if;
  v_definition := replace(
    v_definition,
    v_anchor,
    $new$  for v_entry in select key, value from jsonb_each(v_cleared_patch || v_enrichment_patch)$new$
  );

  -- 4. The protection re-check only looked at keys present in `enriched_data`.
  -- If a field became owner/admin-locked between enrichment and apply, a
  -- pending clear for it must abort the apply rather than empty a protected
  -- field. Same message, same errcode — this is one more arm of the existing
  -- condition. The allow-list is repeated rather than read from
  -- `v_cleared_patch`, which is not assigned until step 2's code runs, well
  -- after this guard.
  v_anchor := $anchor$  ) then
    raise exception 'Refresh is stale: field protection changed after enrichment'
      using errcode = 'P0001';
  end if;$anchor$;
  v_count := (length(v_definition) - length(replace(v_definition, v_anchor, ''))) / length(v_anchor);
  if v_count <> 1 then
    raise exception 'Expected one field-protection staleness guard, found %', v_count;
  end if;
  v_definition := replace(
    v_definition,
    v_anchor,
    $new$  ) or exists (
    select 1
    from jsonb_array_elements_text(
           coalesce(v_submission.enriched_data -> '_cleared_fields', '[]'::jsonb)
         ) as cleared(field)
    join public.brand_field_state as state
      on state.brand_id = v_brand.id and state.field = cleared.field
    where (state.admin_locked or state.source in ('owner', 'admin', 'submitted'))
      and cleared.field = any(array[
        'description', 'description_en', 'blurb', 'blurb_en', 'city',
        'category_attributes', 'reputation_summary', 'retail_locations',
        'mit_evidence', 'site_content', 'founding_year',
        'product_type', 'price_range', 'product_tags', 'product_tags_en',
        'social_instagram', 'social_threads', 'social_facebook',
        'purchase_website', 'purchase_pinkoi', 'purchase_shopee', 'other_urls'
      ])
  ) then
    raise exception 'Refresh is stale: field protection changed after enrichment'
      using errcode = 'P0001';
  end if;$new$
  );

  execute v_definition;
end
$migration$;

commit;
