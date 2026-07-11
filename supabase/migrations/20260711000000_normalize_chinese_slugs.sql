-- Migration: Normalize non-kebab brand slugs to ASCII
-- NOTE: This migration requires manual review before applying.
-- Each brand below needs a verified romanized slug.
-- The pinyin-pro library generates candidates, but human review is needed
-- for brand-name transliterations that may have preferred romanizations.

-- Step 1: Insert redirects for old slugs BEFORE renaming
-- (Uncomment and fill in actual new slugs after review)

-- INSERT INTO brand_slug_redirects (old_slug, new_slug) VALUES
--   ('遇合', 'yu-he'),
--   ('新北坪林阿純茶園', 'a-chun-cha-yuan'),
--   ('廣源良-mit', 'guang-yuan-liang')
-- ON CONFLICT (old_slug) DO NOTHING;

-- Step 2: Rename slugs
-- UPDATE brands SET slug = 'yu-he' WHERE slug = '遇合';
-- UPDATE brands SET slug = 'a-chun-cha-yuan' WHERE slug = '新北坪林阿純茶園';
-- UPDATE brands SET slug = 'guang-yuan-liang' WHERE slug = '廣源良-mit';
