-- DEV-906: Directory health audit 2026-06-29
-- Fixes broken, suspicious, and incorrect brand URLs identified by the health check routine.
-- 10 brands corrected, 4 verified OK (no changes).

BEGIN;

-- 1. MTSK 手工牛皮皮鞋 — bare reurl.cc shortener + wrong social links (scraping artifacts)
UPDATE brands SET
  purchase_website = 'https://mtskshoes.com',
  social_facebook = 'https://www.facebook.com/mtsk1223/',
  social_instagram = 'https://www.instagram.com/mtsk_shoesmaker/'
WHERE slug = 'mtsk-手工牛皮皮鞋';

-- 2. 京揚超細纖維 — bare threads.com homepage + missing social
UPDATE brands SET
  purchase_website = 'https://jingyang.net.tw',
  social_threads = 'https://www.threads.com/@jingyangtw55',
  social_instagram = 'https://www.instagram.com/jingyangtw55/'
WHERE slug = '京揚超細纖維';

-- 3. 微醺農場 — PeoPo news article + Facebook points to PeoPo, not the farm
UPDATE brands SET
  purchase_website = 'https://www.whfarm.com.tw',
  social_facebook = 'https://www.facebook.com/tipsyfarm/'
WHERE slug = 'tipsy-farm';

-- 4. 媽祖埔豆腐張 — TWRR partner page + Facebook points to TWRR Foundation
UPDATE brands SET
  purchase_website = 'https://www.mzp1991.com/',
  social_facebook = 'https://www.facebook.com/p/%E5%AA%BD%E7%A5%96%E5%9F%94%E8%B1%86%E8%85%90%E5%BC%B5%E8%99%8E%E5%B0%BE%E7%9B%B4%E7%87%9F%E5%BA%97-100063768372149/'
WHERE slug = '媽祖埔豆腐張-創生夥伴介紹-台灣地方創生基金會';

-- 5. 月光下友善農場 — TWRR partner page + wrong Facebook; no own website exists
UPDATE brands SET
  purchase_website = NULL,
  social_facebook = 'https://www.facebook.com/p/%E6%9C%88%E5%85%89%E4%B8%8B%E5%8F%8B%E5%96%84%E8%BE%B2%E5%A0%B4%E7%94%9F%E6%85%8B%E9%A4%8A%E8%9D%A6-100057390343688/'
WHERE slug = '月光下友善農場-創生夥伴介紹-台灣地方創生基金會';

-- 6. 李家蜂蜜 — TWRR partner page + wrong Facebook; no own website exists
UPDATE brands SET
  purchase_website = NULL,
  social_facebook = 'https://www.facebook.com/p/%E6%9D%8E%E5%AE%B6%E8%9C%82%E8%9C%9C-100057096084719/',
  social_instagram = 'https://www.instagram.com/leehoney7533967/'
WHERE slug = '李家蜂蜜-創生夥伴介紹-台灣地方創生基金會';

-- 7. 十甲有機農場 — third-party marketplace listing; social fields already correct
UPDATE brands SET
  purchase_website = NULL
WHERE slug = 'shi-jia-organic-farm';

-- 8. 烏金報報 — all URLs belong to 官田烏金 (Guantian Black Gold), not this brand
UPDATE brands SET
  purchase_website = NULL,
  social_instagram = NULL,
  social_facebook = NULL
WHERE slug = '烏金報報';

-- 9. 艾熙甜點 — all URLs pointed to food blogger suger25, not the dessert brand
UPDATE brands SET
  purchase_website = NULL,
  social_instagram = 'https://www.instagram.com/oi_siit_dessert/',
  social_facebook = NULL
WHERE slug = '艾熙甜點';

-- 10. 金旗山城 — community association site, not the brand itself
UPDATE brands SET
  purchase_website = NULL
WHERE slug = 'jin-qi-shan-cheng';

COMMIT;
