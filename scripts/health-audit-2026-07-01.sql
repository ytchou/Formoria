-- DEV-919: Directory health audit 2026-07-01
-- Fixes broken/suspicious brand URLs and runs DB maintenance.
-- 2 brands corrected, 10 flagged for manual verification.

BEGIN;

-- ============================================================
-- 1. URL corrections — Possible Broken (2)
--    Brands with confirmed new/correct URLs from audit.
-- ============================================================

-- Enjoy Caster: real domain is enjoycaster.com; the .com.tw variant has no indexed pages
UPDATE brands SET purchase_website = 'https://enjoycaster.com' WHERE slug = 'enjoy-caster';

-- 福灣巧克力: shop migrated from shop.fuwanchocolate.com to fuwanshop.com
UPDATE brands SET purchase_website = 'https://fuwanshop.com' WHERE slug = 'fuwan-chocolate';

-- ============================================================
-- 2. Manual verification — HTTP/HTTPS issues (2)
--    Indexed URLs use HTTP only; HTTPS may not be served.
--    Verify HTTPS works before updating.
-- ============================================================

-- BoingBoing (boingboing): https://www.boing.com.tw
--   All indexed URLs use HTTP only; HTTPS may not be served correctly.
--   Action: manually verify HTTPS, update if confirmed.

-- FYE (fye): https://foryourearth.com
--   Brand active on Pinkoi/social but all indexed URLs show HTTP; HTTPS unconfirmed.
--   Action: manually verify HTTPS, update if confirmed.

-- ============================================================
-- 3. Manual verification — Suspicious third-party URLs (3)
--    URLs point to third-party hosting rather than brand-owned domains.
-- ============================================================

-- 1973 Furniture (1973-furniture): https://1973home.myshopify.com
--   Correct brand content, but URL is a Shopify-hosted subdomain.
--   Action: check if brand has a custom domain (e.g. 1973home.com).

-- S Pantyhose (s-pantyhose): https://majimeowcutiesportsday.com.tw
--   URL bears no relation to brand name; likely a campaign/event site.
--   Action: find brand's actual website or NULL if none exists.

-- 我很醜可是我很 Natural+ (natural): https://uglybuthealthy.weebly.com
--   Brand content present but hosted on Weebly free subdomain; no custom domain.
--   Action: check if brand has migrated to a custom domain.

-- ============================================================
-- 4. Manual verification — Unknown / Unverified (5)
--    Domains have zero indexed content; existence unconfirmed.
-- ============================================================

-- Journey of Sole (journey-of-sole): https://journeyofsole.com
--   Zero indexed search results; domain existence unconfirmed.
--   Action: verify domain is live, NULL if dead.

-- MONOCEAN (monocean): https://monocean.co
--   .co domain has no indexed content; .com is parked for sale.
--   Action: verify domain is live, NULL if dead.

-- Re:Nrob Lab (renrob-lab): https://shop.renroblab.com
--   Brand exists (Instagram traces) but shop URL returned no indexed pages.
--   Action: verify shop is live, check for alternate URL.

-- Sammm._.Studio (sammm-studio): https://sammm.store
--   No indexed content found; store URL unconfirmed as live.
--   Action: verify domain is live, NULL if dead.

-- YUMOR Original (yumor-original): https://yumor-original.framer.website
--   Brand confirmed on Instagram (@yumor.original) but Framer subdomain not indexed.
--   Action: verify site is live, check for custom domain.

COMMIT;

-- ============================================================
-- 5. DB maintenance — VACUUM ANALYZE
--    Must run outside transaction block.
-- ============================================================

VACUUM ANALYZE brands;
VACUUM ANALYZE brand_owners;
VACUUM ANALYZE brand_saves;
VACUUM ANALYZE brand_submissions;
VACUUM ANALYZE owner_email_preferences;
VACUUM ANALYZE newsletter_subscribers;
VACUUM ANALYZE claim_requests;
VACUUM ANALYZE profiles;
