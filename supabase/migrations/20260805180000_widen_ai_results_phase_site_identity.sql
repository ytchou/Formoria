-- Widen brand_ai_results.phase for the DEV-1309 brand-identity ladder.
--
-- The `site_identity` phase is a new batched LLM call slotted between `names`
-- and `image-search`. It judges whether a candidate `purchase_website` or a
-- scraped source page actually belongs to the brand, and releases or revokes
-- the quarantine the links phase built. Every one of its calls writes
-- `phase: 'site_identity'` through the standard audited path.
--
-- This must land before the code ships. `insertAiCallResult` swallows insert
-- errors by design — an audit failure must never fail the enrichment call it
-- was recording — so a rejected CHECK would silently drop every audit row and,
-- with it, all token and cost tracking. The failure mode is invisible: the
-- enrichment succeeds, the ledger is simply empty.
--
-- Legacy values stay permitted: historical rows already carry `description`
-- and `expansion`, and this migration must not orphan them.
--
-- `external_call_audit` needs no migration — its only CHECKs are on `kind` and
-- `status`; `provider` and `operation` are plain `text`.
--
-- VERSION NOTE (2026-08-06): this file was originally numbered
-- 20260805140000, which collided with 20260805140000_brand_faq_entries.sql
-- once DEV-1317 landed on main. It was renumbered to sort after every
-- migration currently on main. The renumber is load-bearing, not cosmetic:
-- 20260805140100_widen_ai_results_phase_faq.sql rewrites this same constraint,
-- so at the old number THIS migration ran first and the faq one ran last,
-- dropping `site_identity` from the CHECK with no error. The two allow-lists
-- are now unioned below, and this file must remain the LAST migration that
-- touches brand_ai_results_phase_check.

-- Anchor guard. This migration rewrites a constraint it expects
-- 20260805140100_widen_ai_results_phase_faq.sql to have left in place. If that
-- anchor has drifted — the constraint renamed, dropped, or replaced by
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
      'brand_ai_results_phase_check is missing; the phase CHECK anchor drifted — reconcile with 20260805140100_widen_ai_results_phase_faq.sql before rerunning';
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
    -- added by 20260805140100_widen_ai_results_phase_faq.sql; retained here
    -- because this migration rewrites the whole constraint
    'faq',
    'site_identity',
    -- legacy, retained so historical rows stay valid
    'description',
    'expansion'
  )
);
