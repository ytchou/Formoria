-- =============================================================================
-- Hide Real Brands (Demo Mode Helper)
-- =============================================================================
-- PURPOSE: Sets all real (non-demo) approved brands to 'hidden' so that only
--          demo brands appear in public-facing views during partner pitches.
--
-- WARNING: This is a DESTRUCTIVE operation. Running this on a production
--          database will hide all real approved brands from public listing.
--
-- UNDO:    To restore hidden real brands:
--          UPDATE brands SET status = 'approved'
--          WHERE is_demo = false AND status = 'hidden';
--
-- WHEN TO USE: Run this only after seed-demo.sql has been applied and you
--              want a clean demo environment showing only demo brands.
-- =============================================================================

UPDATE brands SET status = 'hidden'
WHERE is_demo = false AND status = 'approved';
