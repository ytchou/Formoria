ALTER TABLE brand_images DROP CONSTRAINT brand_images_source_check;
ALTER TABLE brand_images ADD CONSTRAINT brand_images_source_check
  CHECK (source IN ('scrape','google_image','owner','admin','legacy','json_ld'));
