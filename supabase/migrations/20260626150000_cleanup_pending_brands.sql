-- Phase 3: Clean up pending brands and narrow constraints
-- 1. Backfill enriched_data for any remaining pending brands (belt-and-suspenders)
UPDATE brand_submissions bs
SET enriched_data = jsonb_build_object(
  'description', b.description,
  'hero_image_url', b.hero_image_url,
  'product_photos', b.product_photos,
  'product_type', b.product_type,
  'brand_highlights', b.brand_highlights,
  'social_instagram', b.social_instagram,
  'social_threads', b.social_threads,
  'social_facebook', b.social_facebook,
  'purchase_website', b.purchase_website,
  'purchase_pinkoi', b.purchase_pinkoi,
  'purchase_shopee', b.purchase_shopee,
  'other_urls', b.other_urls
)
FROM brands b
WHERE bs.brand_id = b.id
  AND b.status = 'pending'
  AND bs.enriched_data IS NULL;

-- 2. NULL out brand_submissions.brand_id for pending brand references
UPDATE brand_submissions
SET brand_id = NULL
WHERE brand_id IN (SELECT id FROM brands WHERE status = 'pending');

-- 3. Delete all pending brands (also deletes brand_taxonomy via CASCADE)
DELETE FROM brands WHERE status = 'pending';

-- 4. NULL out brand_submissions.brand_id for rejected brand references, then delete
UPDATE brand_submissions
SET brand_id = NULL
WHERE brand_id IN (SELECT id FROM brands WHERE status = 'rejected');

DELETE FROM brands WHERE status = 'rejected';

-- 5. Alter FK to ON DELETE SET NULL
ALTER TABLE brand_submissions
  DROP CONSTRAINT IF EXISTS brand_submissions_brand_id_fkey,
  ADD CONSTRAINT brand_submissions_brand_id_fkey
    FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL;

-- 6. Add CHECK constraint for brand status (approved/hidden only)
ALTER TABLE brands
  DROP CONSTRAINT IF EXISTS brands_status_check,
  ADD CONSTRAINT brands_status_check CHECK (status IN ('approved', 'hidden'));
