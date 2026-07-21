ALTER TABLE brand_reports ADD COLUMN reported_field TEXT NULL;
COMMENT ON COLUMN brand_reports.reported_field IS 'Optional field name the report targets (e.g., description, website)';
