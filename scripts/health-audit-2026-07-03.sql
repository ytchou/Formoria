-- DEV-941: Directory health audit 2026-07-03
-- Fix brand name placeholder (Landingdream 網站標題), flag 22 unverified purchase_website URLs for manual review, VACUUM 9 tables.
-- 1 brand name corrected, 22 unverified URLs flagged (no automated change — manual spot-check required).

BEGIN;

-- ============================================================
-- 1. Data quality fix — brand name placeholder (1)
--    "landingdream 網站標題" contains CMS artifact "網站標題" (website title).
--    Fix name and slug to canonical form.
-- ============================================================

-- Landingdream: name is "landingdream 網站標題" (CMS placeholder) — fix name and slug
UPDATE brands SET name = 'Landingdream', slug = 'landingdream' WHERE slug = 'landingdream-網站標題';

-- ============================================================
-- 2. URL health — 22 unverified purchase_website domains (manual review required)
--    Audit search returned no indexed web presence for the domains below.
--    Note: some may be active but not indexed. Manual spot-check recommended before
--    nulling. Review each in the admin panel and clear if confirmed dead.
--
-- aceka.com.tw
-- aisaniea.com.tw
-- ccw-official.com
-- eat-akuriru.com
-- immugoat.com
-- journeyofsole.com
-- jswood.com.tw
-- mattress-maker.com
-- monocean.co
-- mufurniture.com.tw
-- mypoint.com.tw
-- 9dulan.com
-- orangejohoo.com
-- reusenewlife.com.tw
-- robber925silver.com
-- sammm.store
-- shop.renroblab.com
-- shuristory.com.tw
-- stronglove9d.com
-- tianbenjam.com
-- tomu.tw
-- yongyu.tw
-- ============================================================

COMMIT;

-- ============================================================
-- 3. DB maintenance — VACUUM ANALYZE
--    Must run outside transaction block.
--    9 tables exceed dead row threshold (brands at 25.1% — warning level).
-- ============================================================

VACUUM ANALYZE brands;
VACUUM ANALYZE brand_owners;
VACUUM ANALYZE brand_saves;
VACUUM ANALYZE brand_submissions;
VACUUM ANALYZE newsletter_subscribers;
VACUUM ANALYZE profiles;
VACUUM ANALYZE pending_brand_edits;
VACUUM ANALYZE moderation_flags;
VACUUM ANALYZE brand_reports;
