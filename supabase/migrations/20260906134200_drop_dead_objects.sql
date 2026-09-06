-- DEV-1501: contract step — drop dead DB objects verified unreferenced in application code.
-- Expand step (code removal) shipped in prior deploys; no running container references these.

-- 1. pending_brand_edits table (includes its indexes, RLS policy, and FK constraints)
DROP TABLE IF EXISTS pending_brand_edits;

-- 2. curated_product_sources.claim_en column
ALTER TABLE curated_product_sources DROP COLUMN IF EXISTS claim_en;

-- 3. moderation_flags.previous_content column
ALTER TABLE moderation_flags DROP COLUMN IF EXISTS previous_content;
