-- Add new enrichment columns (IF NOT EXISTS for idempotency after repair)
ALTER TABLE brands ADD COLUMN IF NOT EXISTS price_range smallint;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'brands_price_range_check'
  ) THEN
    ALTER TABLE brands ADD CONSTRAINT brands_price_range_check CHECK (price_range BETWEEN 1 AND 3);
  END IF;
END $$;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS product_tags text[];

COMMENT ON COLUMN brands.price_range IS '1=$, 2=$$, 3=$$$. AI-classified from website pricing signals.';
COMMENT ON COLUMN brands.product_tags IS 'AI-extracted specific product types, e.g. ["massage devices", "small appliances"].';

-- Drop dead columns
ALTER TABLE brands DROP COLUMN IF EXISTS founder;
ALTER TABLE brands DROP COLUMN IF EXISTS brand_highlights;
