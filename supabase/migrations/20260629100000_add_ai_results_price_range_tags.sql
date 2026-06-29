ALTER TABLE brand_ai_results ADD COLUMN price_range smallint;
ALTER TABLE brand_ai_results ADD COLUMN product_tags text[];

ALTER TABLE brand_ai_results DROP CONSTRAINT brand_ai_results_phase_check;
ALTER TABLE brand_ai_results ADD CONSTRAINT brand_ai_results_phase_check
  CHECK (phase IN ('triage', 'description', 'classification'));
