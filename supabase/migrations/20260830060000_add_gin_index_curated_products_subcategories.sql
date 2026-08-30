CREATE INDEX IF NOT EXISTS idx_curated_products_subcategories ON curated_products USING gin (subcategories);
