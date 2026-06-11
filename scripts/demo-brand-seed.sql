-- ============================================================
-- Formoria — Demo / test brand SEED
-- ------------------------------------------------------------
-- A realistic-looking, fully-rendered brand for testing the
-- brand-OWNER features end to end (claim flow -> dashboard ->
-- draft/preview). It is intentionally NOT pre-claimed: no row is
-- inserted into brand_owners, so you can exercise "claim this
-- brand" from scratch as patrick.ytchou@gmail.com.
--
--   Seed:  supabase db query --linked --file scripts/demo-brand-seed.sql
--   Drop:  supabase db query --linked --file scripts/demo-brand-drop.sql
--
-- Safe-teardown markers (see drop script):
--   * fixed id : dddddddd-dddd-dddd-dddd-dddddddddddd
--   * is_demo  : true        -> shows a "demo" badge in /admin/brands
--   * source   : 'demo_seed' -> on the brands row
--
-- Images are PLACEHOLDERS pointing at an existing brand's Storage
-- objects (allowlisted *.supabase.co host) so they render without
-- uploading anything new. Swap the URLs anytime.
-- Idempotent: re-running re-seeds the same row cleanly.
-- ============================================================

begin;

insert into brands (
  id, name, slug, description, status, category, founding_year,
  hero_image_url, product_photos, social_links, purchase_links,
  retail_locations, contact_email, tag_slugs, source, is_demo,
  mit_status, submitted_at, approved_at
) values (
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  '暖木家居 Warmwood Living',
  'warmwood-living',
  '暖木家居是來自台中的手作木質家居品牌，專注以台灣在地木材製作溫潤耐用的生活用品。從餐桌器皿到收納小物，每件作品都在工作室手工打磨完成，希望把自然的溫度帶進日常生活。',
  'approved',
  'Home & Living',
  2018,
  'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/brands/0938d015-2b6a-4a5d-86fb-0421b253ee0f/3d337da3-c295-4b83-82ca-0204f16a0a3a.png',
  '[
    "https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/brands/0938d015-2b6a-4a5d-86fb-0421b253ee0f/08c88db3-1b39-4ac6-8249-20d02755f60c.png",
    "https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/brands/0938d015-2b6a-4a5d-86fb-0421b253ee0f/a1e78bc8-d528-4b5b-a19e-da10093921a6.png",
    "https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/brands/0938d015-2b6a-4a5d-86fb-0421b253ee0f/996ba7db-e161-4185-9997-07a451995ba5.png"
  ]'::jsonb,
  '{"instagram":"@warmwood.living","threads":"@warmwood.living","website":"https://warmwoodliving.tw"}'::jsonb,
  '[{"label":"官方網站","url":"https://warmwoodliving.tw"},{"label":"線上商店","url":"https://warmwoodliving.tw/shop"}]'::jsonb,
  '[]'::jsonb,
  'hello@warmwoodliving.tw',
  ARRAY['home','handmade','local-culture'],
  'demo_seed',
  true,
  'unverified',
  now(),
  now()
)
on conflict (id) do update set
  name           = excluded.name,
  slug           = excluded.slug,
  description    = excluded.description,
  status         = excluded.status,
  category       = excluded.category,
  founding_year  = excluded.founding_year,
  hero_image_url = excluded.hero_image_url,
  product_photos = excluded.product_photos,
  social_links   = excluded.social_links,
  purchase_links = excluded.purchase_links,
  retail_locations = excluded.retail_locations,
  contact_email  = excluded.contact_email,
  tag_slugs      = excluded.tag_slugs,
  source         = excluded.source,
  is_demo        = excluded.is_demo,
  mit_status     = excluded.mit_status,
  updated_at     = now();

-- Taxonomy join rows (category chip + filter sidebar). Delete-then-insert
-- keeps this idempotent regardless of the (brand_id, tag_id) primary key.
delete from brand_taxonomy where brand_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
insert into brand_taxonomy (brand_id, tag_id, source) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd','af47f2d8-ea7a-412a-9f45-628561fe2030','manual'), -- home / 居家生活 (product_type)
  ('dddddddd-dddd-dddd-dddd-dddddddddddd','4a2c96b7-541c-48c6-9c69-b7052389181e','manual'), -- handmade / 手作 (value)
  ('dddddddd-dddd-dddd-dddd-dddddddddddd','9d197f76-a020-404c-9595-ca65a76cc648','manual'); -- local-culture / 在地文化 (value)

commit;

-- Confirmation
select id, name, slug, status, is_demo, mit_status
from brands
where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
