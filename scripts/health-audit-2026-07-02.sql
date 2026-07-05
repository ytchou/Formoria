-- DEV-920: Directory health audit 2026-07-02
-- Clears suspicious third-party purchase_website URLs; runs DB maintenance.
-- 4 brands corrected, 1 flagged for manual verification.

BEGIN;

-- ============================================================
-- 1. URL corrections — Suspicious Third-party (4)
--    Brands with third-party platform URLs that should not be listed
--    as purchase destinations. Cleared until brand-owned domains are found.
-- ============================================================

-- 我很醜可是我很 Natural+ (natural): https://uglybuthealthy.weebly.com
--   Action: NULL — Weebly platform page, not a brand-owned domain
UPDATE brands SET purchase_website = NULL WHERE slug = 'natural';

-- 頭嵙山香菇 (toukeshan-mushroom): https://keshan-sianggu.weebly.com
--   Action: NULL — Weebly platform page, not a brand-owned domain
UPDATE brands SET purchase_website = NULL WHERE slug = 'toukeshan-mushroom';

-- 質物園 Zhioo Studio (zhioo-studio): https://zhiwuyuan-zhioo-studio8.webnode.tw
--   Action: NULL — Webnode platform page, not a brand-owned domain
UPDATE brands SET purchase_website = NULL WHERE slug = 'zhioo-studio';

-- YUMOR Original (yumor-original): https://yumor-original.framer.website
--   Action: NULL — Framer platform page, not a brand-owned domain
UPDATE brands SET purchase_website = NULL WHERE slug = 'yumor-original';

-- ============================================================
-- 2. Manual verification — Possible Broken (1)
--    HTTP-only URL; HTTPS may not be served. Verify manually and update
--    to https:// if valid, or NULL if domain is dead/unreachable.
-- ============================================================

-- BoingBoing (boingboing): http://www.boing.com.tw
--   Action: Verify if https://www.boing.com.tw resolves; update or NULL accordingly

COMMIT;

-- ============================================================
-- 3. DB maintenance — VACUUM ANALYZE
--    Must run outside transaction block.
--    5 tables exceed 20% dead row threshold; brands at 13.8% (monitor).
-- ============================================================

VACUUM ANALYZE pending_brand_edits;
VACUUM ANALYZE brands;
VACUUM ANALYZE brand_owners;
VACUUM ANALYZE brand_saves;
VACUUM ANALYZE brand_submissions;
VACUUM ANALYZE owner_email_preferences;
VACUUM ANALYZE newsletter_subscribers;
VACUUM ANALYZE claim_requests;
VACUUM ANALYZE profiles;
