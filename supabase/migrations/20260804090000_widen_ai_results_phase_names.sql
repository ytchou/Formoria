-- Widen brand_ai_results.phase for the DEV-1321 name arbiter.
--
-- `name-arbiter.ts` already writes `phase: 'names'` on every audited call, but
-- the phase was registered as deferred and never executed, so the value never
-- reached the table. The DEV-1321 wiring makes `names` a real batched phase
-- between the links wave and the image search, so the CHECK has to admit it
-- before that code ships.
--
-- This must land before the code ships. `insertAiCallResult` swallows insert
-- errors by design — an audit failure must never fail the enrichment call it
-- was recording — so a rejected CHECK would silently drop every audit row and,
-- with it, all token and cost tracking. The failure mode is invisible.
--
-- Legacy values stay permitted: historical rows already carry `description`
-- and `expansion`, and this migration must not orphan them.

-- Anchor guard. This migration rewrites a constraint it expects
-- 20260803033000_widen_ai_results_phase_check.sql to have left in place. If
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
      'brand_ai_results_phase_check is missing; the phase CHECK anchor drifted — reconcile with 20260803033000_widen_ai_results_phase_check.sql before rerunning';
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
    -- legacy, retained so historical rows stay valid
    'description',
    'expansion'
  )
);
