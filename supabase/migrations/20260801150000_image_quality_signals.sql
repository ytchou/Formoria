begin;

-- Persist the two sharp-derived quality signals the download stage now gates
-- on (sharp `stats().sharpness` and `stats().entropy`) so the thresholds in
-- src/lib/services/image-download.ts can be calibrated against stored rows
-- instead of being re-measured from the original bytes.
--
-- Both columns are nullable: every row written before this migration, and
-- every owner/admin upload path that does not run the enrichment download,
-- legitimately has no measurement.

alter table public.brand_images
  add column if not exists sharpness double precision,
  add column if not exists entropy double precision;

alter table public.submission_images
  add column if not exists sharpness double precision,
  add column if not exists entropy double precision;

-- Add the new columns to the two image column-copy sites that carry
-- pixel-derived values across submission approval and brand refresh, so the
-- measurements survive instead of being dropped on approve.
--
-- Patched by text replacement against the live definitions, the same way
-- 20260730120000_allow_single_image_publishable_core.sql does, because both
-- copy sites live inside large function bodies that several migrations have
-- already amended. Each replace is guarded: if the anchor text has drifted the
-- migration fails loudly rather than silently skipping the column.
--
-- Deliberately NOT patched:
--   * the in-place `update public.brand_images ... from submission_images as
--     reference` in apply_brand_refresh_with_protected_location_gate. That
--     statement copies only curation fields (status, sort_order, alt, tags,
--     score) and no pixel-derived column, because it targets images the brand
--     already owns — the brand_images row already holds the correct sharpness
--     and entropy, and copying from the reference row would overwrite them
--     with null.
--   * the `_active_images` jsonb fingerprints built by jsonb_build_object in
--     20260720140736_scheduled_brand_refresh.sql. Those column lists must stay
--     byte-identical to each other; adding a key to one aborts every in-flight
--     refresh with SQLSTATE 40001.
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
    $old$    alt_en, width, height, dominant_color, sort_order, source_url, phash,
    created_at
  )$old$,
    $new$    alt_en, width, height, dominant_color, sort_order, source_url, phash,
    sharpness, entropy, created_at
  )$new$
  );

  v_updated_definition := replace(
    v_updated_definition,
    $old$    image.phash, image.created_at
  from public.submission_images as image$old$,
    $new$    image.phash, image.sharpness, image.entropy, image.created_at
  from public.submission_images as image$new$
  );

  if v_updated_definition = v_definition then
    raise exception 'approve_submission brand_images copy list was not found';
  end if;
  execute v_updated_definition;

  select pg_get_functiondef(
    'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure
  ) into v_definition;

  v_updated_definition := replace(
    v_definition,
    $old$    width, height, dominant_color, sort_order, source_url, phash, created_at
  )$old$,
    $new$    width, height, dominant_color, sort_order, source_url, phash, sharpness,
    entropy, created_at
  )$new$
  );

  v_updated_definition := replace(
    v_updated_definition,
    $old$    image.phash, image.created_at
  from public.submission_images as image$old$,
    $new$    image.phash, image.sharpness, image.entropy, image.created_at
  from public.submission_images as image$new$
  );

  v_updated_definition := replace(
    v_updated_definition,
    $old$    phash = excluded.phash;$old$,
    $new$    phash = excluded.phash, sharpness = excluded.sharpness,
    entropy = excluded.entropy;$new$
  );

  if v_updated_definition = v_definition then
    raise exception 'apply_brand_refresh brand_images copy list was not found';
  end if;
  execute v_updated_definition;
end
$migration$;

commit;
