-- Rename product_highlights to brand_highlights and change type from JSONB to text
ALTER TABLE brands RENAME COLUMN product_highlights TO brand_highlights;
ALTER TABLE brands ALTER COLUMN brand_highlights TYPE text USING NULL;
ALTER TABLE brands ALTER COLUMN brand_highlights SET DEFAULT NULL;
COMMENT ON COLUMN brands.brand_highlights IS 'Free-form text describing what makes this brand special';
