-- Microsite content seed (DEV-767)
-- Populates brands.site_content so that brand.formoria.com/<slug> renders a
-- personalized standalone 官網. A brand renders ONLY when:
--   site_content IS NOT NULL  AND  status = 'approved'   (see getMicrositeSlugs).
--
-- site_content JSONB shape (matches normalizeSiteContent — extra keys are dropped):
--   {
--     "template":  "default",                       -- template registry id
--     "tokens":    { "accent": "#RRGGBB",           -- per-brand swappable accent
--                    "accentForeground": "#RRGGBB" },-- text/icon color on the accent
--     "tagline":   "短句標語",
--     "story":     "品牌故事，2–4 句。",
--     "products":  [ { "name": "品名",
--                      "caption": "一句說明",
--                      "imageUrl": "https://<project>.supabase.co/storage/...", -- OPTIONAL; MUST be a
--                                                                              -- Supabase-Storage / allow-listed host
--                      "url": "https://shopee.tw/..." } ],                       -- OPTIONAL buy link
--     "ctaType":   "mailto",
--     "ctaValue":  "contact@brand.tw"               -- defaults to the brand contact email if omitted
--   }
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ FOUNDER ACTION REQUIRED BEFORE SEEDING (DEV-767 handoff gate):
--   1. Confirm the 3–5 real approved catalog slugs to feature (this file ships
--      only the `warmwood-living` demo brand as a worked example).
--   2. For each, author tagline/story/products and pick `tokens.accent` from the
--      brand's identity. `imageUrl` MUST be a Supabase-Storage URL — if a source
--      image is external, run `pnpm backfill-images` to rehost it first, otherwise
--      next/image rejects the host. Omitting imageUrl renders a clean text card.
--   3. Apply (do NOT use the broken `seed` target):
--        supabase db query --linked --file scripts/microsite-seed.sql
--   4. Verify getMicrositeSlugs() returns the seeded slugs.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Demo brand: warmwood-living (Warmwood 溫木) ──────────────────────────────
-- Requires the demo brand to exist (scripts/demo-brand-seed.sql) and be approved.
-- Accent #7C5C3E = walnut/warm-wood tone. Product imageUrl intentionally omitted
-- (no rehosted Storage assets for the demo brand yet) → renders text+caption cards.
UPDATE brands
SET site_content = jsonb_build_object(
  'template', 'default',
  'tokens', jsonb_build_object(
    'accent', '#7C5C3E',
    'accentForeground', '#FFFFFF'
  ),
  'tagline', '溫潤木作，日常的溫度',
  'story',   '我們在台中的小工坊，用台灣在地的木料，一刀一刨地做出每天都想拿在手裡的器物。'
          || '不追求完美的工業線條，而是保留木頭的紋理與手作的痕跡——因為那才是時間與溫度的證明。',
  'products', jsonb_build_array(
    jsonb_build_object('name', '核桃木托盤',   'caption', '手工打磨，盛裝早晨的第一杯咖啡'),
    jsonb_build_object('name', '橡木餐具組',   'caption', '三件式，越用越溫潤的天然色澤'),
    jsonb_build_object('name', '檜木香氛座',   'caption', '台灣檜木殘料再製，淡淡的森林氣息'),
    jsonb_build_object('name', '胡桃木壁掛架', 'caption', '簡約的線條，收納也是一種風景')
  ),
  'ctaType',  'mailto',
  'ctaValue', 'hi@warmwood.tw'
)
WHERE slug = 'warmwood-living';

-- ── Template block — duplicate per confirmed real brand, then fill + uncomment ──
-- UPDATE brands
-- SET site_content = jsonb_build_object(
--   'template', 'default',
--   'tokens',   jsonb_build_object('accent', '#______', 'accentForeground', '#FFFFFF'),
--   'tagline',  '____',
--   'story',    '____',
--   'products', jsonb_build_array(
--     jsonb_build_object('name', '____', 'caption', '____',
--                        'imageUrl', 'https://<project>.supabase.co/storage/v1/object/public/____',
--                        'url', 'https://____')
--   ),
--   'ctaType',  'mailto',
--   'ctaValue', '____@____'
-- )
-- WHERE slug = '____';
