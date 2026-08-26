-- Records WHY a brand left the public directory, alongside brands.status.
--
-- Without this, status='hidden' is indistinguishable between a brand that was
-- researched and found to have no listable products, and one that was never
-- researched at all. The first is a finished decision; the second is a work
-- queue. Re-research cost is the difference.
--
-- Free text rather than a CHECK constraint: the vocabulary below is expected to
-- grow as new categories are screened, and a constraint would turn each new
-- reason into a migration. Ceiling: if the values start drifting in spelling,
-- promote this to an enum or a lookup table.
--
-- Current vocabulary:
--   'no_products_found'   - screened; no listable products located
--   'no_origin_disclosed' - screened; brand states no manufacturing origin
--
-- Not cleared automatically when a brand returns to status='approved'. Callers
-- that un-hide a brand are responsible for nulling this column.

ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS hidden_reason text;

COMMENT ON COLUMN brands.hidden_reason IS
  'Why the brand is not public. Set alongside status=''hidden''. NULL for approved brands. Vocabulary: no_products_found, no_origin_disclosed.';

CREATE INDEX IF NOT EXISTS idx_brands_hidden_reason
  ON brands (hidden_reason)
  WHERE hidden_reason IS NOT NULL;

-- Preserve the review decisions in deployable history. The backup copy is
-- intentionally gitignored and is not available to the release path.
UPDATE brands b
SET hidden_reason = a.reason
FROM (VALUES
  ('siangapato', 'no_products_found'),
  ('suii-suii-lab', 'no_products_found'),
  ('potato-sofa', 'no_products_found'),
  ('reusenewlife', 'no_products_found'),
  ('quemoy-memory-creative-studio', 'no_products_found'),
  ('tongle', 'no_products_found'),
  ('yshinoki', 'no_products_found'),
  ('yudean', 'no_products_found'),
  ('yueatgreen', 'no_products_found'),
  ('yuj', 'no_products_found'),
  ('yuwu-design', 'no_products_found'),
  ('yvonne-collection', 'no_products_found'),
  ('凡爾賽', 'no_products_found'),
  ('客製化空間搭配', 'no_products_found'),
  ('尾八', 'no_products_found'),
  ('我適文創', 'no_products_found'),
  ('未來居', 'no_products_found'),
  ('清潔抗菌-安心呵護', 'no_products_found'),
  ('源作木坊', 'no_products_found'),
  ('烏金報報', 'no_products_found'),
  ('阿媽牌生鐵鍋', 'no_products_found'),
  ('fartech', 'no_products_found'),
  ('duri', 'no_products_found'),
  ('arsenal-tool-inc', 'no_products_found'),
  ('dawn-creative', 'no_products_found'),
  ('countess', 'no_products_found'),
  ('goanywheredesign', 'no_products_found'),
  ('cindy-chien', 'no_products_found'),
  ('dodu', 'no_products_found'),
  ('bonnie-lu', 'no_products_found'),
  ('91art-studio', 'no_products_found'),
  ('evies-drawing-daily', 'no_products_found'),
  ('auspicious-pattern-archeology', 'no_products_found'),
  ('atw-studio', 'no_products_found'),
  ('a-plant-studio', 'no_products_found'),
  ('dumbradio', 'no_products_found'),
  ('glassriver', 'no_products_found'),
  ('dong-tang', 'no_products_found'),
  ('circular', 'no_products_found'),
  ('essence-design-craft', 'no_products_found'),
  ('drunkfoodsss', 'no_products_found'),
  ('decentplanting', 'no_products_found'),
  ('1cmhandmake', 'no_products_found'),
  ('glowis', 'no_products_found'),
  ('bamboola-1980', 'no_products_found'),
  ('che-ho', 'no_products_found'),
  ('celement-lab', 'no_products_found'),
  ('celebrate-today', 'no_products_found'),
  ('elephant-cuppa', 'no_products_found'),
  ('fu-guan-fabric', 'no_products_found'),
  ('acera', 'no_products_found'),
  ('ching-tu-tatami', 'no_products_found'),
  ('float-living', 'no_origin_disclosed'),
  ('25togo', 'no_products_found'),
  ('chang-che', 'no_products_found'),
  ('fumi-towel', 'no_products_found'),
  ('decus', 'no_products_found'),
  ('chih-yu-kuang', 'no_products_found'),
  ('cypress-house', 'no_products_found'),
  ('bosswell-air', 'no_products_found'),
  ('dasuit', 'no_products_found'),
  ('lin-tsao-kung-fang', 'no_products_found'),
  ('hualien-stone-workshop', 'no_products_found'),
  ('moodplant', 'no_products_found'),
  ('kaka', 'no_products_found'),
  ('good-good-goods', 'no_products_found'),
  ('olivia-bedding', 'no_products_found'),
  ('mousheng', 'no_origin_disclosed'),
  ('jswood', 'no_products_found'),
  ('medgear', 'no_products_found'),
  ('papir-lab', 'no_products_found'),
  ('mingshun-glass', 'no_products_found'),
  ('pachi-pachi-workshop', 'no_products_found'),
  ('min-young-workshop', 'no_products_found'),
  ('mufun-design', 'no_products_found'),
  ('oranpeel', 'no_products_found'),
  ('one-wood', 'no_products_found'),
  ('osun-i', 'no_products_found'),
  ('my-girl-aiko', 'no_products_found'),
  ('kamei-brush', 'no_products_found'),
  ('hands', 'no_products_found'),
  ('jt-home', 'no_products_found'),
  ('heima-living', 'no_products_found'),
  ('multi', 'no_products_found'),
  ('jia-er-shi', 'no_products_found'),
  ('muyutowel', 'no_products_found'),
  ('huiaio-studio', 'no_products_found'),
  ('kiko', 'no_products_found'),
  ('olive', 'no_products_found'),
  ('mxm', 'no_products_found'),
  ('lifedecor', 'no_products_found'),
  ('guitar-player', 'no_origin_disclosed'),
  ('mattress-maker', 'no_products_found'),
  ('kaishodo-calligraphy', 'no_products_found'),
  ('hokii', 'no_products_found'),
  ('guan-gou', 'no_products_found'),
  ('goblin-elder', 'no_products_found'),
  ('mattan', 'no_products_found'),
  ('naw-object', 'no_products_found'),
  ('hong-yew', 'no_products_found'),
  ('kom', 'no_products_found'),
  ('the-venusians', 'no_origin_disclosed'),
  ('unmelt', 'no_products_found'),
  ('pikang', 'no_products_found'),
  ('perfect', 'no_products_found'),
  ('tshapeof', 'no_products_found'),
  ('rewood', 'no_products_found'),
  ('peng-lu-pottery', 'no_products_found'),
  ('sheep-craft', 'no_products_found'),
  ('taiwan-acheng', 'no_products_found'),
  ('sincerecraft-tw', 'no_products_found'),
  ('tranquil-island', 'no_products_found'),
  ('washcan', 'no_products_found'),
  ('strong-love', 'no_products_found'),
  ('wm-craft-studio', 'no_products_found'),
  ('v-j-studio', 'no_products_found'),
  ('sanaxillu', 'no_products_found'),
  ('rainbow-creative', 'no_products_found'),
  ('su3', 'no_products_found'),
  ('piper-piper-illu', 'no_products_found'),
  ('sense-road', 'no_products_found'),
  ('step-cultural-and-creative', 'no_products_found'),
  ('wtfff-morning', 'no_products_found'),
  ('penpenpen-studio', 'no_products_found'),
  ('skycoffee-studio', 'no_origin_disclosed'),
  ('sf-igusa', 'no_products_found'),
  ('umami', 'no_products_found'),
  ('takeneko', 'no_products_found'),
  ('tatung-chinaware', 'no_products_found'),
  ('tabbi-l', 'no_products_found'),
  ('su-felting', 'no_products_found'),
  ('phenshyshy', 'no_products_found'),
  ('shichang-sofa', 'no_products_found'),
  ('playzu', 'no_products_found'),
  ('roomix', 'no_products_found')
) AS a(slug, reason)
WHERE b.slug = a.slug
  AND b.status = 'hidden';

-- Remove three known cross-brand matches. Slug and host guards make this a
-- no-op for deleted rows and for any row corrected after the review.
UPDATE brands
SET purchase_website = NULL, updated_at = now()
WHERE (slug = 'flat-135' AND purchase_website ~* '^https?://(www\.)?flatoutmotorcycles\.com(/|$)')
   OR (slug = 'halfor' AND purchase_website ~* '^https?://(www\.)?halfords\.com(/|$)')
   OR (slug = 'chi-bee' AND purchase_website ~* '^https?://(www\.)?campingbar2016\.com(/|$)');

-- AGAPE's reviewed products are made outside Taiwan, so brand-level MIT
-- evidence and copy cannot remain published.
UPDATE brands
SET mit_status = 'unverified',
    mit_verified_at = NULL,
    mit_evidence = NULL,
    mit_story = NULL,
    mit_declared_scope = NULL,
    mit_declared_at = NULL,
    mit_declared_by = NULL,
    updated_at = now()
WHERE slug = 'agape'
  AND (
    mit_status <> 'unverified'
    OR mit_evidence IS NOT NULL
    OR mit_story IS NOT NULL
    OR mit_declared_scope IS NOT NULL
  );

-- Repair the named non-shop routes only when the reviewed bad value is still
-- present. These roots expose purchasable products as of the review date.
UPDATE brands
SET purchase_website = CASE slug
      WHEN 'lulus' THEN 'https://www.lulus.com.tw'
      WHEN 'nui' THEN 'https://www.nui.com.tw'
      WHEN 'one-shoe' THEN 'https://www.oneshoe.cc'
      WHEN 'cucare' THEN 'https://www.cucare.com.tw'
      WHEN 'musen-socks' THEN 'https://www.musensocks.com'
    END,
    updated_at = now()
WHERE (slug = 'lulus' AND purchase_website ~* '/about/?([?#].*)?$')
   OR (slug = 'nui' AND purchase_website ~* '/pages/about-nui/?([?#].*)?$')
   OR (slug = 'one-shoe' AND purchase_website ~* '/blog')
   OR (slug = 'cucare' AND purchase_website ~* '/pages/blog0222222222/?([?#].*)?$')
   OR (slug = 'musen-socks' AND purchase_website ~* '^https?://(www\.)?instagram\.com/');

UPDATE brands
SET purchase_website = NULL, updated_at = now()
WHERE slug IN ('333-slippers', 'mtl-shoes')
  AND purchase_website ~* '^https?://apps\.apple\.com/';
