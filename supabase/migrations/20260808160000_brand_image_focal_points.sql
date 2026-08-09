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

commit;

-- Deliberately a SECOND transaction. The column adds above are what the deployed
-- app reads on every brand page; the function patch below only matters at
-- submission-approval time. Sharing one transaction meant any failure in the
-- patch rolled the columns back too, leaving an operator with a failed push, no
-- columns, and code already deployed that selects them. Committing the DDL first
-- makes the worst case "columns present, functions unpatched" — degraded
-- approval behaviour, not a broken site — and re-running the migration then
-- retries only the part that failed.

begin;

-- `replace()` is global: it rewrites every occurrence while the old guards only
-- asserted that at least one changed. These functions are patched from their
-- LIVE definitions (they have no canonical source file and are known to drift),
-- so a second, unexpected occurrence of an anchor would silently inject focal_x
-- into another insert whose target table has no such column. Requiring exactly
-- one occurrence turns that into a loud failure.
create or replace function pg_temp.patch_once(
  v_body text,
  v_old text,
  v_new text,
  v_label text
) returns text as $patch_once$
declare
  v_count int;
begin
  v_count := (length(v_body) - length(replace(v_body, v_old, ''))) / length(v_old);
  if v_count = 0 then
    raise exception '%: anchor not found', v_label;
  end if;
  if v_count > 1 then
    raise exception '%: anchor found % times, expected exactly 1', v_label, v_count;
  end if;
  return replace(v_body, v_old, v_new);
end
$patch_once$ language plpgsql;

-- Carry the new columns across the submission -> brand copy sites.
--
-- These function bodies have no canonical source file, so each replace is
-- asserted individually. 20260801150000 checked only that the definition
-- changed *at all*, which passes even when some anchors have drifted and the
-- column is silently dropped on approve — the exact failure the guard exists to
-- catch. Per-replace assertions make a partial match abort the migration.
--
-- Each function is skipped when it is ALREADY patched, so re-application (a
-- repaired ledger row, or `supabase db push --linked --include-all` after the
-- functions were patched) is a no-op instead of an exception. "Already applied"
-- and "anchor missing" are different failures and only the second may raise. The
-- presence test cannot see a half-patched body, and does not need to: every
-- replace for a function happens before its single `execute`, so a partial patch
-- can never be committed.
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
begin
  -- approve_submission: plain insert ... select, no on-conflict clause.
  select pg_get_functiondef('public.approve_submission(uuid,uuid,jsonb)'::regprocedure)
    into v_definition;

  if position('focal_x' in v_definition) > 0 then
    raise notice 'approve_submission: already carries focal_x; skipping';
  else
    v_updated := pg_temp.patch_once(
      v_definition,
      $old$    alt_en, width, height, dominant_color, sort_order, source_url, phash,
    sharpness, entropy, created_at$old$,
      $new$    alt_en, width, height, dominant_color, sort_order, source_url, phash,
    sharpness, entropy, focal_x, focal_y, created_at$new$,
      'approve_submission: brand_images insert column list'
    );

    v_updated := pg_temp.patch_once(
      v_updated,
      $old$    image.phash, image.sharpness, image.entropy, image.created_at$old$,
      $new$    image.phash, image.sharpness, image.entropy, image.focal_x,
    image.focal_y, image.created_at$new$,
      'approve_submission: brand_images select list'
    );

    execute v_updated;
  end if;

  -- apply_brand_refresh_with_protected_location_gate: insert ... select with an
  -- on-conflict update, so three sites rather than two.
  select pg_get_functiondef(
      'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure
    )
    into v_definition;

  if position('focal_x' in v_definition) > 0 then
    raise notice 'apply_brand_refresh gate: already carries focal_x; skipping';
  else
    v_updated := pg_temp.patch_once(
      v_definition,
      $old$    width, height, dominant_color, sort_order, source_url, phash, sharpness,
    entropy, created_at$old$,
      $new$    width, height, dominant_color, sort_order, source_url, phash, sharpness,
    entropy, focal_x, focal_y, created_at$new$,
      'apply_brand_refresh gate: brand_images insert column list'
    );

    v_updated := pg_temp.patch_once(
      v_updated,
      $old$    image.phash, image.sharpness, image.entropy, image.created_at$old$,
      $new$    image.phash, image.sharpness, image.entropy, image.focal_x,
    image.focal_y, image.created_at$new$,
      'apply_brand_refresh gate: brand_images select list'
    );

    v_updated := pg_temp.patch_once(
      v_updated,
      $old$    phash = excluded.phash, sharpness = excluded.sharpness,
    entropy = excluded.entropy;$old$,
      $new$    phash = excluded.phash, sharpness = excluded.sharpness,
    entropy = excluded.entropy, focal_x = excluded.focal_x,
    focal_y = excluded.focal_y;$new$,
      'apply_brand_refresh gate: brand_images on-conflict set list'
    );

    execute v_updated;
  end if;
end
$migration$;

drop function pg_temp.patch_once(text, text, text, text);

commit;
