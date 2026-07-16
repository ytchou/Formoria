-- Normalize 3 legacy CJK slugs to Wade-Giles (DEV-1014)
-- Order matters: brands.slug must be updated BEFORE inserting redirect rows,
-- because brand_slug_redirects.new_slug REFERENCES brands(slug).

UPDATE brands SET slug = 'yu-ho' WHERE slug = '遇合';
UPDATE brands SET slug = 'a-chun-cha-yuan' WHERE slug = '新北坪林阿純茶園';
UPDATE brands SET slug = 'kuang-yuan-liang' WHERE slug = '廣源良-mit';

INSERT INTO brand_slug_redirects (old_slug, new_slug)
SELECT v.old_slug, v.new_slug
FROM (VALUES
  ('遇合', 'yu-ho'),
  ('新北坪林阿純茶園', 'a-chun-cha-yuan'),
  ('廣源良-mit', 'kuang-yuan-liang')
) AS v(old_slug, new_slug)
WHERE EXISTS (SELECT 1 FROM brands WHERE brands.slug = v.new_slug)
ON CONFLICT (old_slug) DO NOTHING;
