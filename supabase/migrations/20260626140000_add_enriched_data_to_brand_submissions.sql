ALTER TABLE brand_submissions ADD COLUMN enriched_data JSONB DEFAULT NULL;

COMMENT ON COLUMN brand_submissions.enriched_data IS 'Pre-approval enrichment results. Flat JSONB matching brands table column names. Merged into brands row on approval.';
