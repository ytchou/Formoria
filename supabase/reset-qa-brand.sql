-- ============================================================================
-- RESET QA TEST BRAND  (DEV-734)
-- ----------------------------------------------------------------------------
-- Removes ownership + claim history for the QA fixture brand so it becomes
-- claimable again. Run `make reset-qa-brand`, which executes THIS file and then
-- re-runs seed-qa-brand.sql to restore all field values (mit_status='unverified').
--
-- Run standalone:
--   npx supabase db query --linked --file supabase/reset-qa-brand.sql
--   # or:  psql $DATABASE_URL -f supabase/reset-qa-brand.sql
-- ============================================================================

DELETE FROM brand_owners
  WHERE brand_id = (SELECT id FROM brands WHERE slug = 'test-brand-qa');

DELETE FROM claim_requests
  WHERE brand_id = (SELECT id FROM brands WHERE slug = 'test-brand-qa');
