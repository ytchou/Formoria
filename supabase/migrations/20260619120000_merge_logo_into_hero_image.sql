-- Step 1: Backfill hero_image_url from logo_url where hero is empty
UPDATE brands
SET hero_image_url = logo_url
WHERE (hero_image_url IS NULL OR hero_image_url = '')
  AND logo_url IS NOT NULL
  AND logo_url != '';

-- Step 2: Drop the logo_url column
ALTER TABLE brands DROP COLUMN IF EXISTS logo_url;

-- Step 3: Delete approved brands with no images at all
DELETE FROM brands
WHERE status = 'approved'
  AND (hero_image_url IS NULL OR hero_image_url = '')
  AND (product_photos IS NULL OR product_photos = '[]'::jsonb OR jsonb_array_length(product_photos) = 0);
