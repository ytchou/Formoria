-- Widen brand_ai_results.phase for the three-call split of the detail step.
--
-- The single `description` call becomes three: `facts` (taxonomy, price, city,
-- year, MIT signals, listing verdict), `descriptions` (prose + FAQ), and
-- `reputation` (renamed from `expansion`).
--
-- This must land before the code ships. `insertAiCallResult` swallows insert
-- errors by design — an audit failure must never fail the enrichment call it
-- was recording — so a rejected CHECK would silently drop every audit row and,
-- with it, all token and cost tracking. The failure mode is invisible.
--
-- Legacy values stay permitted: historical rows already carry `description`
-- and `expansion`, and this migration must not orphan them.

ALTER TABLE brand_ai_results DROP CONSTRAINT IF EXISTS brand_ai_results_phase_check;

ALTER TABLE brand_ai_results
ADD CONSTRAINT brand_ai_results_phase_check
CHECK (
  phase IN (
    -- current
    'triage',
    'detect',
    'classification',
    'classify_images',
    'facts',
    'descriptions',
    'reputation',
    -- legacy, retained so historical rows stay valid
    'description',
    'expansion'
  )
);
