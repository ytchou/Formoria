-- Widen phase CHECK to include 'detect' (renamed from triage) and 'classify_images'
ALTER TABLE brand_ai_results
DROP CONSTRAINT brand_ai_results_phase_check;

ALTER TABLE brand_ai_results
ADD CONSTRAINT brand_ai_results_phase_check
CHECK (phase IN ('triage', 'detect', 'description', 'classification', 'expansion', 'classify_images'));
