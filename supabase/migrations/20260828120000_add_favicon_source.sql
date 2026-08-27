-- DEV-1628: allow 'favicon' as a brand_images source and add a unique index
-- for the (brand_id, source) upsert key.

ALTER TABLE public.brand_images
  DROP CONSTRAINT IF EXISTS brand_images_source_check;

ALTER TABLE public.brand_images
  ADD CONSTRAINT brand_images_source_check
    CHECK (source IN ('scrape', 'google_image', 'owner', 'admin', 'legacy', 'json_ld', 'favicon'));

CREATE UNIQUE INDEX brand_images_brand_id_source_uniq
  ON public.brand_images (brand_id, source);
