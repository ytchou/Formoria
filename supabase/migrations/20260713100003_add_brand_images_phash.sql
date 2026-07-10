-- Add perceptual hash column for image deduplication
ALTER TABLE brand_images ADD COLUMN IF NOT EXISTS phash text;
