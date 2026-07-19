-- DEV-1092: Directory health audit 2026-07-19
-- Correct two brand URLs to their live first-party storefronts.

BEGIN;

UPDATE public.brands
SET purchase_website = 'https://shop.shihkuo.com/'
WHERE slug = 'medgear'
  AND purchase_website = 'https://shihkuo.com';

UPDATE public.brands
SET purchase_website = 'https://shop.snug.com.tw/'
WHERE slug = 'snug'
  AND purchase_website = 'https://www.snug.com.tw/u/index.php?p=socks3';

COMMIT;

-- Journey of Sole is serving its official Shopify store at the recorded URL.
-- RMC's recorded site matches the brand's embroidery business and social profiles.
-- No manual VACUUM is needed: autovacuum reduced brands dead tuples to 6.7%.
