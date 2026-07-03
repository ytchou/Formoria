ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS reputation_summary jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS manufacturing jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS certifications jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS policies jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS category_attributes jsonb DEFAULT NULL;

ALTER TABLE brand_ai_results
  DROP CONSTRAINT IF EXISTS brand_ai_results_phase_check;
ALTER TABLE brand_ai_results
  ADD CONSTRAINT brand_ai_results_phase_check
  CHECK (phase IN ('triage', 'description', 'classification', 'expansion'));
