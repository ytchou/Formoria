ALTER TABLE brand_submissions
  ADD COLUMN romanized_name TEXT;

COMMENT ON COLUMN brand_submissions.romanized_name IS
  'Owner-provided English/romanized brand name for URL slug generation';
