-- Widen brand_ai_results.phase for the DEV-1317 FAQ preset catalog.
--
-- The catalog introduces `faq` as its own `ENRICH_PHASES` member, appended
-- last so it can read the facts the `descriptions` phase settles and the
-- summary the `reputation` phase produces. Every audited call in that phase
-- writes `phase: 'faq'`, so the CHECK has to admit it before that code ships.
--
-- This must land before the code ships. `insertAiCallResult` swallows insert
-- errors by design (src/lib/services/llm-audit.ts:73-77) — an audit failure
-- must never fail the enrichment call it was recording — so a rejected CHECK
-- would silently drop every FAQ audit row and, with it, all token and cost
-- tracking for the phase. The failure mode is invisible.
--
-- Legacy values stay permitted: historical rows already carry `description`
-- and `expansion`, and this migration must not orphan them.

-- Anchor guard. This migration rewrites a constraint it expects
-- 20260804090000_widen_ai_results_phase_names.sql to have left in place. If
-- that anchor has drifted — the constraint renamed, dropped, or replaced by
-- something else — recreating it blindly would silently narrow whatever the
-- current definition allows. Fail loudly instead.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS c
    JOIN pg_class AS t ON t.oid = c.conrelid
    WHERE t.relname = 'brand_ai_results'
      AND c.conname = 'brand_ai_results_phase_check'
  ) THEN
    RAISE EXCEPTION
      'brand_ai_results_phase_check is missing; the phase CHECK anchor drifted — reconcile with 20260804090000_widen_ai_results_phase_names.sql before rerunning';
  END IF;
END;
$$;

ALTER TABLE brand_ai_results DROP CONSTRAINT brand_ai_results_phase_check;

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
    'names',
    'faq',
    -- legacy, retained so historical rows stay valid
    'description',
    'expansion'
  )
);
