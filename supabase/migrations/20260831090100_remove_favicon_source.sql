ALTER TABLE public.brand_images
  DROP CONSTRAINT IF EXISTS brand_images_source_check;

ALTER TABLE public.brand_images
  ADD CONSTRAINT brand_images_source_check
    CHECK (source IN ('scrape', 'google_image', 'owner', 'admin', 'legacy', 'json_ld'));
