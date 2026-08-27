-- DEV-1628: allow 'favicon' as a brand_images source.
-- One favicon per brand enforced at application level (delete+insert),
-- not via a broad unique index — existing rows have legitimate duplicates
-- per (brand_id, source) for scrape/google_image/legacy.

ALTER TABLE public.brand_images
  DROP CONSTRAINT IF EXISTS brand_images_source_check;

ALTER TABLE public.brand_images
  ADD CONSTRAINT brand_images_source_check
    CHECK (source IN ('scrape', 'google_image', 'owner', 'admin', 'legacy', 'json_ld', 'favicon'));
