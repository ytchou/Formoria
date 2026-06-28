-- Add new enrichment columns
ALTER TABLE brands ADD COLUMN price_range smallint CHECK (price_range BETWEEN 1 AND 3);
ALTER TABLE brands ADD COLUMN product_tags text[];

COMMENT ON COLUMN brands.price_range IS '1=$, 2=$$, 3=$$$. AI-classified from website pricing signals.';
COMMENT ON COLUMN brands.product_tags IS 'AI-extracted specific product types, e.g. ["massage devices", "small appliances"].';

-- Drop dead columns
ALTER TABLE brands DROP COLUMN IF EXISTS founder;
ALTER TABLE brands DROP COLUMN IF EXISTS brand_highlights;
