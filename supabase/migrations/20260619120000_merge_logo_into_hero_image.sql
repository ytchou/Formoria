-- Step 1: Backfill hero_image_url from logo_url where hero is empty (idempotent)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'brands' AND column_name = 'logo_url'
  ) THEN
    UPDATE brands
    SET hero_image_url = logo_url
    WHERE (hero_image_url IS NULL OR hero_image_url = '')
      AND logo_url IS NOT NULL
      AND logo_url != '';
  END IF;
END $$;

-- Step 2: Drop the logo_url column
ALTER TABLE brands DROP COLUMN IF EXISTS logo_url;

-- Step 3: Delete approved brands with no images at all
-- First clean up all FK references to the brands being deleted
DELETE FROM brand_submissions WHERE brand_id IN (
  SELECT id FROM brands WHERE status = 'approved'
    AND (hero_image_url IS NULL OR hero_image_url = '')
    AND (product_photos IS NULL OR product_photos = '[]'::jsonb OR jsonb_array_length(product_photos) = 0)
);
DELETE FROM brand_taxonomy WHERE brand_id IN (
  SELECT id FROM brands WHERE status = 'approved'
    AND (hero_image_url IS NULL OR hero_image_url = '')
    AND (product_photos IS NULL OR product_photos = '[]'::jsonb OR jsonb_array_length(product_photos) = 0)
);
DELETE FROM brand_analytics WHERE brand_id IN (
  SELECT id FROM brands WHERE status = 'approved'
    AND (hero_image_url IS NULL OR hero_image_url = '')
    AND (product_photos IS NULL OR product_photos = '[]'::jsonb OR jsonb_array_length(product_photos) = 0)
);
DELETE FROM brand_link_clicks WHERE brand_id IN (
  SELECT id FROM brands WHERE status = 'approved'
    AND (hero_image_url IS NULL OR hero_image_url = '')
    AND (product_photos IS NULL OR product_photos = '[]'::jsonb OR jsonb_array_length(product_photos) = 0)
);
DELETE FROM brand_owners WHERE brand_id IN (
  SELECT id FROM brands WHERE status = 'approved'
    AND (hero_image_url IS NULL OR hero_image_url = '')
    AND (product_photos IS NULL OR product_photos = '[]'::jsonb OR jsonb_array_length(product_photos) = 0)
);
DELETE FROM brand_reports WHERE brand_id IN (
  SELECT id FROM brands WHERE status = 'approved'
    AND (hero_image_url IS NULL OR hero_image_url = '')
    AND (product_photos IS NULL OR product_photos = '[]'::jsonb OR jsonb_array_length(product_photos) = 0)
);
DELETE FROM brand_saves WHERE brand_id IN (
  SELECT id FROM brands WHERE status = 'approved'
    AND (hero_image_url IS NULL OR hero_image_url = '')
    AND (product_photos IS NULL OR product_photos = '[]'::jsonb OR jsonb_array_length(product_photos) = 0)
);
DELETE FROM claim_requests WHERE brand_id IN (
  SELECT id FROM brands WHERE status = 'approved'
    AND (hero_image_url IS NULL OR hero_image_url = '')
    AND (product_photos IS NULL OR product_photos = '[]'::jsonb OR jsonb_array_length(product_photos) = 0)
);
DELETE FROM moderation_flags WHERE brand_id IN (
  SELECT id FROM brands WHERE status = 'approved'
    AND (hero_image_url IS NULL OR hero_image_url = '')
    AND (product_photos IS NULL OR product_photos = '[]'::jsonb OR jsonb_array_length(product_photos) = 0)
);
DELETE FROM pending_brand_edits WHERE brand_id IN (
  SELECT id FROM brands WHERE status = 'approved'
    AND (hero_image_url IS NULL OR hero_image_url = '')
    AND (product_photos IS NULL OR product_photos = '[]'::jsonb OR jsonb_array_length(product_photos) = 0)
);

DELETE FROM brands
WHERE status = 'approved'
  AND (hero_image_url IS NULL OR hero_image_url = '')
  AND (product_photos IS NULL OR product_photos = '[]'::jsonb OR jsonb_array_length(product_photos) = 0);
