-- @formoria-script
-- purpose: Removes the fixed-id demo brand and every child row referencing it.
-- class: operator
-- invoke: supabase db query --db-url "$SUPABASE_DB_URL" --file scripts/demo-brand-drop.sql
-- target: none
-- safety: writes
-- owner: engineering

-- ============================================================
-- Formoria — Demo / test brand TEARDOWN
-- ------------------------------------------------------------
-- Removes the demo brand (id dddddddd-...-dddd) and EVERY child
-- row that references it, so you can re-seed from a clean slate.
-- Covers FK tables pointing at brands.brand_id, including
-- anything created while testing (claim attempts, ownership,
-- analytics and reports).
--
--   Run: supabase db query --linked --file scripts/demo-brand-drop.sql
-- ============================================================

begin;

-- Child rows first (FK constraints) --------------------------------
delete from claim_requests    where brand_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
delete from brand_owners      where brand_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
delete from brand_submissions where brand_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
delete from brand_taxonomy    where brand_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
delete from brand_analytics   where brand_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
delete from brand_link_clicks where brand_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
delete from brand_reports     where brand_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

-- Parent row -------------------------------------------------------
delete from brands where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

commit;

-- Confirmation (expect 0 rows)
select id, name from brands where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
