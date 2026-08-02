begin;

-- Raise the per-brand active image cap from 7 to 10.
--
-- The cap was arbitrary and measurably harmful: sampling 50 brands, 16 of them
-- had more surviving images than the cap allowed, so good images were being
-- demoted purely to fit an invented ceiling. Image quality is enforced by the
-- acquisition-time gates in src/lib/services/image-download.ts (short-edge
-- >= 480px, aspect <= 2.0, sharpness, entropy) and by the classifier's
-- keep/reject disposition -- not by counting.
--
-- The cap is enforced in three places and all of them must agree:
--   * TypeScript      -- MAX_BRAND_ACTIVE_IMAGES in src/lib/constants/brand-images.ts
--   * sort_order range guards in save_submission_review and
--     apply_brand_refresh_with_protected_location_gate (patched below)
--   * the active-count guard in apply_brand_refresh_with_protected_location_gate
--
-- sort_order is 0-based, so a cap of 10 means the valid range is 0..9.
--
-- Patched by text replacement against the live definitions rather than by
-- editing the historical migration files, following
-- 20260730120000_allow_single_image_publishable_core.sql. These bodies have
-- been amended by four prior migrations, so the file text no longer matches
-- what is deployed. Every replace is guarded: if an anchor has drifted the
-- migration aborts loudly instead of silently leaving a stale bound behind.
--
-- Deliberately NOT touched: the `_active_images` jsonb fingerprints built by
-- jsonb_build_object in 20260720140736_scheduled_brand_refresh.sql. Those
-- column lists must stay byte-identical to each other or every in-flight
-- refresh aborts with SQLSTATE 40001.

do $migration$
declare
  v_definition text;
  v_updated_definition text;
begin
  -- 1. save_submission_review: image count ceiling and sort_order range.
  select pg_get_functiondef(
    'public.save_submission_review(uuid,jsonb,jsonb)'::regprocedure
  ) into v_definition;

  v_updated_definition := replace(
    v_definition,
    $old$if v_image_count > 7 then$old$,
    $new$if v_image_count > 10 then$new$
  );

  if v_updated_definition = v_definition then
    raise exception
      'save_submission_review: image-count guard anchor not found; the live definition has drifted';
  end if;

  v_definition := v_updated_definition;

  v_updated_definition := replace(
    v_definition,
    $old$where (image ->> 'sort_order')::integer not between 0 and 6$old$,
    $new$where (image ->> 'sort_order')::integer not between 0 and 9$new$
  );

  if v_updated_definition = v_definition then
    raise exception
      'save_submission_review: sort_order range anchor not found; the live definition has drifted';
  end if;

  -- The operator-facing message states the old number.
  v_updated_definition := replace(
    v_updated_definition,
    $old$Submission review supports at most 7 images$old$,
    $new$Submission review supports at most 10 images$new$
  );

  execute v_updated_definition;

  -- 2. apply_brand_refresh_with_protected_location_gate: active-count ceiling
  --    and sort_order range.
  select pg_get_functiondef(
    'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure
  ) into v_definition;

  v_updated_definition := replace(
    v_definition,
    $old$) not between 1 and 7$old$,
    $new$) not between 1 and 10$new$
  );

  if v_updated_definition = v_definition then
    raise exception
      'apply_brand_refresh: active-count guard anchor not found; the live definition has drifted';
  end if;

  v_definition := v_updated_definition;

  v_updated_definition := replace(
    v_definition,
    $old$and image.sort_order not between 0 and 6$old$,
    $new$and image.sort_order not between 0 and 9$new$
  );

  if v_updated_definition = v_definition then
    raise exception
      'apply_brand_refresh: sort_order range anchor not found; the live definition has drifted';
  end if;

  execute v_updated_definition;
end
$migration$;

-- 3. approve_submission has never had an upper bound at all, so a first-time
--    submission could carry any number of images past approval while a refresh
--    of the same brand was capped. Close the asymmetry at the same number.
--
--    Safe to add: verified before writing this migration that no submission
--    currently has more than 10 active images, so nothing that approves today
--    starts failing.
do $migration$
declare
  v_definition text;
  v_updated_definition text;
begin
  select pg_get_functiondef(
    'public.approve_submission(uuid,uuid,jsonb)'::regprocedure
  ) into v_definition;

  -- The image floor is one clause in the publishable-core `or` chain, which
  -- raises a single shared error. Extend that chain rather than adding a
  -- separate guard, so the cap is enforced by the same check and reports the
  -- same way apply_brand_refresh's count guard already does.
  v_updated_definition := replace(
    v_definition,
    $old$    or (
      select count(distinct image.url)
      from public.submission_images as image
      where image.submission_id = p_submission_id
        and image.status = 'active'
    ) < 1
  then$old$,
    $new$    or (
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
  then$new$
  );

  if v_updated_definition = v_definition then
    raise exception
      'approve_submission: publishable-core image clause not found; the live definition has drifted';
  end if;

  execute v_updated_definition;
end
$migration$;

commit;
