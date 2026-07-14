-- DEV-1056: Directory health audit 2026-07-13
-- One confirmed URL correction; all other named domains were reachable or
-- require manual brand-owner review before changing purchase_website.

BEGIN;

-- BoingBoing's current www.boing.com.tw URL has an invalid certificate.
-- The official storefront is live at boingboing.shop2000.com.tw.
UPDATE public.brands
SET purchase_website = 'https://boingboing.shop2000.com.tw/'
WHERE slug = 'boingboing'
  AND purchase_website = 'https://www.boing.com.tw';

COMMIT;

-- Keep VACUUM outside the transaction block.
VACUUM (ANALYZE) public.brands;
VACUUM (ANALYZE) public.brand_analytics;
VACUUM (ANALYZE) public.brand_owners;
VACUUM (ANALYZE) public.brand_saves;
VACUUM (ANALYZE) public.brand_submissions;
VACUUM (ANALYZE) public.newsletter_subscribers;
VACUUM (ANALYZE) public.moderation_flags;
VACUUM (ANALYZE) public.profiles;
