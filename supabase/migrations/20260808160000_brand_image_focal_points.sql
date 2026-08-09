-- Focal points for brand images (DEV-1406).
--
-- Images render into fixed aspect-ratio boxes with `object-cover`, which crops
-- from the centre. For the ~9% of heroes that lose more than a quarter of their
-- area to that crop, centring is what cuts the subject out of frame. `focal_x`
-- / `focal_y` record where the subject actually is, as a 0-1 point, so the
-- renderer can emit `object-position` instead of accepting the centre.
--
-- The stored asset is never cropped. This is a measurement, not a transform:
-- one point serves every render ratio (4/3, 1/1, 16/9) simultaneously, and
-- nulling both columns restores centred rendering with no deploy.
--
-- Shape copied from 20260801150000_image_quality_signals.sql: nullable columns,
-- no inline backfill (the value is pixel-derived and cannot be computed in SQL
-- — scripts/backfill-image-focal-points.ts owns it), plus the same patching of
-- the two functions that copy image columns across submission approval.

begin;

alter table public.brand_images
  add column if not exists focal_x double precision,
  add column if not exists focal_y double precision;

alter table public.submission_images
  add column if not exists focal_x double precision,
  add column if not exists focal_y double precision;

-- Range guard. Cheap, and the only defence against a bad backfill writing an
-- out-of-range value across thousands of rows — `object-position: 120%` fails
-- silently as a visual bug rather than an error.
do $constraints$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'brand_images_focal_range'
  ) then
    alter table public.brand_images
      add constraint brand_images_focal_range check (
        (focal_x is null or (focal_x >= 0 and focal_x <= 1))
        and (focal_y is null or (focal_y >= 0 and focal_y <= 1))
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'submission_images_focal_range'
  ) then
    alter table public.submission_images
      add constraint submission_images_focal_range check (
        (focal_x is null or (focal_x >= 0 and focal_x <= 1))
        and (focal_y is null or (focal_y >= 0 and focal_y <= 1))
      );
  end if;
end
$constraints$;

comment on column public.brand_images.focal_x is
  'Normalized 0-1 horizontal subject position for object-position. Null means never measured; the renderer falls back to centre.';
comment on column public.brand_images.focal_y is
  'Normalized 0-1 vertical subject position for object-position. Null means never measured; the renderer falls back to centre.';

-- Carry the new columns across the submission -> brand copy sites.
--
-- These function bodies have no canonical source file, so each replace is
-- asserted individually. 20260801150000 checked only that the definition
-- changed *at all*, which passes even when some anchors have drifted and the
-- column is silently dropped on approve — the exact failure the guard exists to
-- catch. Per-replace assertions make a partial match abort the migration.
--
-- Two sites are deliberately NOT patched, matching that precedent:
--   1. The in-place refresh UPDATE (`... = reference.<col>`). It copies from a
--      reference row that may itself never have been measured; propagating a
--      null focal there would ERASE a good measurement on the target.
--   2. The `_active_images` jsonb fingerprints. Those keys must stay
--      byte-identical across migrations or in-flight refreshes abort on a
--      changed fingerprint.
do $migration$
declare
  v_definition text;
  v_updated text;
  v_before text;
begin
  -- approve_submission: plain insert ... select, no on-conflict clause.
  select pg_get_functiondef('public.approve_submission(uuid,uuid,jsonb)'::regprocedure)
    into v_definition;
  v_updated := v_definition;

  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $old$    alt_en, width, height, dominant_color, sort_order, source_url, phash,
    sharpness, entropy, created_at$old$,
    $new$    alt_en, width, height, dominant_color, sort_order, source_url, phash,
    sharpness, entropy, focal_x, focal_y, created_at$new$
  );
  if v_updated = v_before then
    raise exception 'approve_submission: brand_images insert column list anchor not found';
  end if;

  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $old$    image.phash, image.sharpness, image.entropy, image.created_at$old$,
    $new$    image.phash, image.sharpness, image.entropy, image.focal_x,
    image.focal_y, image.created_at$new$
  );
  if v_updated = v_before then
    raise exception 'approve_submission: brand_images select list anchor not found';
  end if;

  execute v_updated;

  -- apply_brand_refresh_with_protected_location_gate: insert ... select with an
  -- on-conflict update, so three sites rather than two.
  select pg_get_functiondef(
      'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure
    )
    into v_definition;
  v_updated := v_definition;

  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $old$    width, height, dominant_color, sort_order, source_url, phash, sharpness,
    entropy, created_at$old$,
    $new$    width, height, dominant_color, sort_order, source_url, phash, sharpness,
    entropy, focal_x, focal_y, created_at$new$
  );
  if v_updated = v_before then
    raise exception 'apply_brand_refresh gate: brand_images insert column list anchor not found';
  end if;

  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $old$    image.phash, image.sharpness, image.entropy, image.created_at$old$,
    $new$    image.phash, image.sharpness, image.entropy, image.focal_x,
    image.focal_y, image.created_at$new$
  );
  if v_updated = v_before then
    raise exception 'apply_brand_refresh gate: brand_images select list anchor not found';
  end if;

  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $old$    phash = excluded.phash, sharpness = excluded.sharpness,
    entropy = excluded.entropy;$old$,
    $new$    phash = excluded.phash, sharpness = excluded.sharpness,
    entropy = excluded.entropy, focal_x = excluded.focal_x,
    focal_y = excluded.focal_y;$new$
  );
  if v_updated = v_before then
    raise exception 'apply_brand_refresh gate: brand_images on-conflict set list anchor not found';
  end if;

  execute v_updated;
end
$migration$;

commit;
