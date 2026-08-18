-- SYNTHETIC CI SUPPLY — NOT demo content, NOT publishable editorial.
--
-- These twelve rows exist only so staging and CI have enough published curated
-- products to clear the homepage supply floor (MIN_HOME_CURATED_PRODUCTS = 6)
-- and to give the discovery trail cards to render. Real authored products are
-- entered through the admin curation surface and never live in this file.
--
-- Every id sits in the '53000000-0000-4000-8000-%' range. That range is how the
-- production replay excludes seed rows and how a future migration can purge
-- them in one statement — never seed a curated product outside it.
--
-- Runs after supabase/fixtures/staging.sql: brand_id carries an FK to the
-- brands that file seeds, identified by their own '51000000-…' fixture ids.
--
-- Descriptions carry durable facts only — material, size, use, made-where.
-- Never price, stock, discount, variants or delivery: those change from a
-- transaction and Formoria does not store commerce truth.
--
-- Every image_url is an existing public brand-images object: next/image only
-- renders *.supabase.co (src/lib/images/allowed-image-hosts.ts), so a URL on a
-- brand's own site would silently fall back to the placeholder tile.
--
-- Every wall_position below is deliberately null: pins sort ahead of the
-- homepage wall's daily shuffle, and those slots belong to hand-authored
-- products. This synthetic supply fills in behind them, never leads.

with fixture(
  id, brand_id, key, name_zh, l1, official_url, image_url,
  product_description_zh, product_position, wall_position
) as (
  values
    (
      '53000000-0000-4000-8000-000000000001'::uuid,
      '51000000-0000-4000-8000-000000000008'::uuid,
      'miniature-bread-case', '迷你麵包標本盒', 'crafts',
      'https://1cmhandmade.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/be843530-20e2-44f8-a21c-413a9a66806b/92e670cb-84cf-4194-868d-c996370702e0.webp',
      '黏土捏製的迷你麵包，收在可以直立擺放的透明盒裡，深度留給麵包的立體厚度。', 1, null
    ),
    (
      '53000000-0000-4000-8000-000000000002'::uuid,
      '51000000-0000-4000-8000-000000000009'::uuid,
      'sirius-figurine', '陶製角色公仔', 'crafts',
      'https://www.instagram.com/91art.studio/',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/6b547f78-7469-43ff-bf47-16a83b680a05/35ccded8-cfd9-48e5-af75-1fcbca25d1d2.webp',
      '手捏陶土燒製的角色公仔，高度大約一個手掌，適合放在書桌或層架上。', 1, null
    ),
    (
      '53000000-0000-4000-8000-000000000003'::uuid,
      '51000000-0000-4000-8000-000000000010'::uuid,
      'illustrated-tote', '插畫托特包', 'crafts',
      'https://www.acuiart.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/a401f742-1c41-4d9c-8a69-97fd58129665/68feae0a-1631-4546-bcb0-9eedff27518f.webp',
      '棉布托特包，裝得下 A4 尺寸，插畫由工作室自己繪製，同一組圖有三種底色。', 1, null
    ),
    (
      '53000000-0000-4000-8000-000000000004'::uuid,
      '51000000-0000-4000-8000-000000000010'::uuid,
      'felt-keyrings', '不織布鑰匙圈', 'crafts',
      'https://www.acuiart.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/a401f742-1c41-4d9c-8a69-97fd58129665/58d1303b-5913-4ab0-9b0a-99be76b8dd7f.webp',
      '不織布手縫的小吊飾，縫線外露，可以扣在鑰匙圈或背包拉鍊上。', 2, null
    ),
    (
      '53000000-0000-4000-8000-000000000005'::uuid,
      '51000000-0000-4000-8000-000000000021'::uuid,
      'solid-wood-dining-set', '實木餐桌椅組', 'home',
      'https://1973home.myshopify.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/5935ad14-8b78-4c7a-aae4-b0021e2d8256/38080c9c-8434-4756-8bc8-1de9077c4e29.webp',
      '實木餐桌搭配同系列餐椅，桌面保留木紋，椅子可以單獨搬動。', 1, null
    ),
    (
      '53000000-0000-4000-8000-000000000006'::uuid,
      '51000000-0000-4000-8000-000000000021'::uuid,
      'fabric-sofa', '布面沙發', 'home',
      'https://1973home.myshopify.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/5935ad14-8b78-4c7a-aae4-b0021e2d8256/731b31d1-df69-496f-b2bd-a7417ce8750f.webp',
      '雙人布面沙發，坐墊可以拆下清洗，淺色布面放在靠窗的位置不會把光線吃掉。', 2, null
    ),
    (
      '53000000-0000-4000-8000-000000000007'::uuid,
      '51000000-0000-4000-8000-000000000022'::uuid,
      'paper-animal-sculptures', '摺紙動物擺飾', 'home',
      'https://store.25togo.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/feb9a616-bad0-4e39-af9e-df12f08d3dbc/503c0197-0fc2-4886-88e5-676a38305d2c.webp',
      '紙材摺成的動物擺飾，體積小，放在層架或窗台都不會擋到伸手的動線。', 1, null
    ),
    (
      '53000000-0000-4000-8000-000000000008'::uuid,
      '51000000-0000-4000-8000-000000000022'::uuid,
      'hanging-scent-sachet', '香氛掛袋', 'home',
      'https://store.25togo.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/feb9a616-bad0-4e39-af9e-df12f08d3dbc/0b9ee5d3-fdc9-4a89-9dfa-61090e506967.webp',
      '布面香氛掛袋，可以掛在衣櫃或門把上，不必固定佔一個平面位置。', 2, null
    ),
    (
      '53000000-0000-4000-8000-000000000009'::uuid,
      '51000000-0000-4000-8000-000000000034'::uuid,
      'wooden-stamp-set', '木頭印章組', 'stationery',
      'https://www.asteroidb610.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/c4060da5-4e4a-4478-894e-8717dc05af98/73dd349b-3021-4c55-913b-21e53906d1e0.webp',
      '木頭刻製的印章組，一組多款圖樣，章面尺寸適合蓋在手帳邊緣。', 1, null
    ),
    (
      '53000000-0000-4000-8000-000000000010'::uuid,
      '51000000-0000-4000-8000-000000000034'::uuid,
      'stone-dish-stamp', '石皿木章', 'stationery',
      'https://www.asteroidb610.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/572d510d-fbcd-4974-9795-81170b71851b/a254305d-f06c-40e0-87de-e949b4fb5ffb.webp',
      '單顆木章，章面刻的是短句而不是圖樣，握柄保留原本的木頭紋理。', 2, null
    ),
    (
      '53000000-0000-4000-8000-000000000011'::uuid,
      '51000000-0000-4000-8000-000000000036'::uuid,
      'straw-tumbler', '吸管隨行杯', 'stationery',
      'https://s.shopee.tw/70FhByEaQd',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/dcf860cf-4522-4ae3-9a8c-589078d64e74/36d90c02-2a87-47b9-bbe1-ff1b941bbaa9.webp',
      '杯身透明的吸管隨行杯，貼紙可以自己更換，杯蓋與吸管都能拆下清洗。', 1, null
    ),
    (
      '53000000-0000-4000-8000-000000000012'::uuid,
      '51000000-0000-4000-8000-000000000036'::uuid,
      'tumbler-lid-set', '杯蓋配件組', 'stationery',
      'https://s.shopee.tw/70FhByEaQd',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/dcf860cf-4522-4ae3-9a8c-589078d64e74/947e0618-8a04-421e-a0de-bf1f69cb1f94.webp',
      '同系列隨行杯的替換杯蓋，吸管蓋與直飲蓋可以互換，杯口尺寸相同。', 2, null
    )
)
insert into public.curated_products (
  id, brand_id, key, name_zh, l1, official_url, image_url, image_usage,
  lifecycle, link_state, link_checked_at, source_checked_at,
  product_description_zh, product_position, wall_position, proposed_by
)
select
  id,
  brand_id,
  key,
  name_zh,
  l1,
  official_url,
  image_url,
  'permitted',
  'published',
  'ok',
  '2026-08-18T00:00:00Z'::timestamptz,
  '2026-08-18T00:00:00Z'::timestamptz,
  product_description_zh,
  product_position,
  wall_position,
  'admin'
from fixture
on conflict (brand_id, key) do update set
  name_zh = excluded.name_zh,
  l1 = excluded.l1,
  official_url = excluded.official_url,
  image_url = excluded.image_url,
  image_usage = excluded.image_usage,
  lifecycle = excluded.lifecycle,
  link_state = excluded.link_state,
  link_checked_at = excluded.link_checked_at,
  source_checked_at = excluded.source_checked_at,
  product_description_zh = excluded.product_description_zh,
  product_position = excluded.product_position,
  wall_position = excluded.wall_position,
  proposed_by = excluded.proposed_by;

-- The homepage read embeds curated_product_sources with !inner, so a product
-- without an active source row disappears from the wall entirely.
with fixture as (
  select id as product_id, official_url
  from public.curated_products
  where id::text like '53000000-0000-4000-8000-%'
)
insert into public.curated_product_sources (
  id, product_id, url, source_type, checked_at, state
)
select
  ('54000000-0000-4000-8000-' || lpad(row_number() over (order by product_id)::text, 12, '0'))::uuid,
  product_id,
  official_url,
  'official',
  '2026-08-18T00:00:00Z'::timestamptz,
  'active'
from fixture
on conflict (product_id, url) do update set
  source_type = excluded.source_type,
  checked_at = excluded.checked_at,
  state = excluded.state;

-- Trail placements for the four home products, so the discovery trail has
-- cards in each of its three sections. The selection carries placement only —
-- position and state. Why a product belongs in a section is said in the trail
-- prose, never stored per product.
with fixture(product_id, section_key, position) as (
  values
    ('53000000-0000-4000-8000-000000000006'::uuid, 'light-first', 0),
    ('53000000-0000-4000-8000-000000000007'::uuid, 'beside-seat', 0),
    ('53000000-0000-4000-8000-000000000008'::uuid, 'beside-seat', 1),
    ('53000000-0000-4000-8000-000000000005'::uuid, 'moveable-setup', 0)
)
insert into public.curated_product_selections (
  product_id, trail_slug, section_key, position, state
)
select
  product_id,
  'small-space-reading-corner',
  section_key,
  position,
  'active'
from fixture
on conflict (product_id, trail_slug, section_key) do update set
  position = excluded.position,
  state = excluded.state;
