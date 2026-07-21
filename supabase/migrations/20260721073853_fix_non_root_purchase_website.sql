-- Fix brands whose purchase_website points to a subpage instead of the root domain.
-- Categories: /about pages, Threads URLs misclassified, twrr.org.tw partner pages, other subpages.

BEGIN;

-- Category 1 & 4: Normalize to root URL (brands that have their own domain)
UPDATE brands SET purchase_website = 'https://www.kevinmccartney.com', updated_at = now()
  WHERE id = '0044c7ba-f808-4f92-baeb-19a6cbc30068' AND purchase_website = 'https://www.kevinmccartney.com/about';

UPDATE brands SET purchase_website = 'https://www.tagathergoods.net', updated_at = now()
  WHERE id = '047bd704-3e35-46c8-95f4-3ce863f2e7b5' AND purchase_website = 'https://www.tagathergoods.net/about';

UPDATE brands SET purchase_website = 'https://www.homedesyne.com', updated_at = now()
  WHERE id = 'a0afcb4b-e8b2-4eb5-8b63-c0b12e75e779' AND purchase_website = 'https://www.homedesyne.com/pages/about-home-desyne';

UPDATE brands SET purchase_website = 'https://www.dtbbag.com', updated_at = now()
  WHERE id = '03369361-cb86-446d-9b79-4090439877c7' AND purchase_website = 'https://www.dtbbag.com/about';

UPDATE brands SET purchase_website = 'https://www.gusta.com.tw', updated_at = now()
  WHERE id = 'be43ba3e-a258-4dde-b47a-445d45bad02b' AND purchase_website = 'https://www.gusta.com.tw/categories/legustamade';

UPDATE brands SET purchase_website = 'https://www.hh-tw.com', updated_at = now()
  WHERE id = 'f8ada194-d5da-4ed4-ad1a-d16e6f5611ce' AND purchase_website = 'https://www.hh-tw.com/pages/journal';

UPDATE brands SET purchase_website = 'https://www.tiwonder.com.tw', updated_at = now()
  WHERE id = 'e5a1dbbe-5f29-4c50-aefe-a50b0d5efca5' AND purchase_website = 'https://www.tiwonder.com.tw/pages/recommendation';

-- Category 3: twrr.org.tw partner page — has own website discovered via research
UPDATE brands SET purchase_website = 'https://www.matsu.live', updated_at = now()
  WHERE id = 'ba1dc3e5-2c6a-4e40-8575-da876553dbb3' AND purchase_website = 'https://twrr.org.tw/zh-TW/partner/472';

UPDATE brands SET purchase_website = 'https://explorematsu.myboostime.app', updated_at = now()
  WHERE id = 'c24e763a-b7cc-44b9-8fa8-0cb13a435556' AND purchase_website = 'https://twrr.org.tw/zh-TW/partner/542';

-- Category 2: Threads URLs in purchase_website — already duplicated in social_threads, just null out
UPDATE brands SET purchase_website = NULL, updated_at = now()
  WHERE id = 'e3133514-d724-4184-b01c-2f483b428824' AND purchase_website = 'https://www.threads.com/@gee.show.tw';

UPDATE brands SET purchase_website = NULL, updated_at = now()
  WHERE id = 'a20a9a17-a773-40fc-b457-4bd84b05a88e' AND purchase_website = 'https://www.threads.com/@wuairconshokujin';

-- Category 3: twrr.org.tw partner pages — no own website exists
UPDATE brands SET purchase_website = NULL, updated_at = now()
  WHERE id = '3157f1b0-18e4-415a-b842-3755ba1d81b8' AND purchase_website = 'https://twrr.org.tw/zh-TW/partner/414';

UPDATE brands SET purchase_website = NULL, updated_at = now()
  WHERE id = '609dfd78-96f1-4b3f-9ece-daa4c7266148' AND purchase_website = 'https://twrr.org.tw/zh-TW/partner/443';

UPDATE brands SET purchase_website = NULL, updated_at = now()
  WHERE id = '208d9d95-6d15-4194-8932-2fbc88c4c9eb' AND purchase_website = 'https://twrr.org.tw/zh-TW/partner/345';

UPDATE brands SET purchase_website = NULL, updated_at = now()
  WHERE id = '2f716230-4273-4524-9842-50d4b61ee138' AND purchase_website = 'https://twrr.org.tw/zh-TW/partner/517';

COMMIT;
