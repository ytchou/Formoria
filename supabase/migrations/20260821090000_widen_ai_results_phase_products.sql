-- Widen brand_ai_results.phase for the DEV-1469 curated-product proposals.
--
-- The `products` phase is a new per-brand LLM call appended after `faq`. It
-- proposes at most five curated products from the brand's own site; the
-- proposals ride the submission's `enriched_data.products[]` until a moderator
-- ticks the keepers. Its call goes through the standard audited path
-- (`createProfiledOpenAIClient` with `phase: 'products'`), so the CHECK has to
-- admit that value before the code ships.
--
-- This must land before the code ships. `insertAiCallResult` swallows insert
-- errors by design — an audit failure must never fail the enrichment call it was
-- recording — so a rejected CHECK would silently drop every products audit row
-- and, with it, all token and cost tracking for the phase. The failure mode is
-- invisible: the enrichment succeeds, the ledger is simply empty.
--
-- Legacy values stay permitted: historical rows already carry `description` and
-- `expansion`, and this migration must not orphan them.
--
-- `external_call_audit` needs no migration — its only CHECKs are on `kind` and
-- `status`; `provider` and `operation` are plain `text`, so the newly registered
-- `enrich.runProductsPhase` span needs no DDL.
--
-- This file must remain the LAST migration that touches
-- brand_ai_results_phase_check: the constraint is rewritten whole every time, so
-- a later migration numbered before this one would silently drop `products`
-- again (exactly the accident the site_identity migration's VERSION NOTE
-- records).

-- Anchor guard. This migration rewrites a constraint it expects
-- 20260805180000_widen_ai_results_phase_site_identity.sql to have left in place.
-- If that anchor has drifted — the constraint renamed, dropped, or replaced by
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
      'brand_ai_results_phase_check is missing; the phase CHECK anchor drifted — reconcile with 20260805180000_widen_ai_results_phase_site_identity.sql before rerunning';
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
    'site_identity',
    -- added by this migration (DEV-1469)
    'products',
    -- legacy, retained so historical rows stay valid
    'description',
    'expansion'
  )
);
