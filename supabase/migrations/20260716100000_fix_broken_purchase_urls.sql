-- DEV-1057 + DEV-1064: fix broken/stale purchase_website URLs
-- Verified via live fetch on 2026-07-16

-- Stale blog post → brand root domain (live e-commerce site)
UPDATE brands SET purchase_website = 'https://www.uffy.life'
WHERE slug = 'uffy' AND purchase_website LIKE '%uffy.life/blog/posts/%';

-- /main.php → root domain (path correction)
UPDATE brands SET purchase_website = 'https://www.fishbar.com.tw'
WHERE slug = 'fish-bar' AND purchase_website LIKE '%fishbar.com.tw/main.php%';

-- Wrong TLD: .com → .jp (brand uses hanamikoji.jp)
UPDATE brands SET purchase_website = 'https://www.hanamikoji.jp'
WHERE slug = 'hanamikoji' AND purchase_website LIKE '%hanamikojis.com%';

-- Date-prefixed blog path → root domain (live tea shop)
UPDATE brands SET purchase_website = 'https://yoosheetea.com'
WHERE slug = 'yoo-shee-tea' AND purchase_website LIKE '%yoosheetea.com/2025/%';

-- Dead shop subdomain → parent domain (live brand site)
UPDATE brands SET purchase_website = 'https://kiko2050.com'
WHERE slug = 'kiko' AND purchase_website LIKE '%shop.kiko2050.com%';

-- Broken sub-page → root domain (live e-commerce)
UPDATE brands SET purchase_website = 'https://www.dawoko.com.tw'
WHERE slug = 'rewood' AND purchase_website LIKE '%dawoko.com.tw/pages/%';

-- CDN subdomain used as search URL — not a purchase page
UPDATE brands SET purchase_website = NULL
WHERE slug = 'major-pleasure' AND purchase_website LIKE '%img.mamibuy.com.tw%';

-- Pre-launch password-protected Shopify — no usable content
UPDATE brands SET purchase_website = NULL
WHERE slug = 'monocean' AND purchase_website LIKE '%monocean.co%';
