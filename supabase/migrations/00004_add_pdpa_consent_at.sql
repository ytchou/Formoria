-- Add PDPA consent timestamp to brand_submissions
ALTER TABLE brand_submissions
ADD COLUMN pdpa_consent_at timestamptz;

-- Comment for documentation
COMMENT ON COLUMN brand_submissions.pdpa_consent_at IS 'Timestamp when submitter agreed to PDPA consent';
