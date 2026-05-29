-- Seed value tags for demo brands.
-- Additive-only: existing rows are preserved via ON CONFLICT DO NOTHING.
-- source defaults to 'manual' per the brand_taxonomy column default.

-- 山霧茶坊 (shan-wu-tea-house): handmade, sustainability, local-revitalization
INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id FROM brands b, taxonomy_tags t
WHERE b.slug = 'shan-wu-tea-house' AND t.slug = 'handmade'
ON CONFLICT DO NOTHING;

INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id FROM brands b, taxonomy_tags t
WHERE b.slug = 'shan-wu-tea-house' AND t.slug = 'sustainability'
ON CONFLICT DO NOTHING;

INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id FROM brands b, taxonomy_tags t
WHERE b.slug = 'shan-wu-tea-house' AND t.slug = 'local-revitalization'
ON CONFLICT DO NOTHING;

-- 陶光工作室 (claylight-studio): handmade, local-culture, sustainability
INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id FROM brands b, taxonomy_tags t
WHERE b.slug = 'claylight-studio' AND t.slug = 'handmade'
ON CONFLICT DO NOTHING;

INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id FROM brands b, taxonomy_tags t
WHERE b.slug = 'claylight-studio' AND t.slug = 'local-culture'
ON CONFLICT DO NOTHING;

INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id FROM brands b, taxonomy_tags t
WHERE b.slug = 'claylight-studio' AND t.slug = 'sustainability'
ON CONFLICT DO NOTHING;

-- 織語 (woven-words): handmade, local-culture, social-enterprise, fair-trade
INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id FROM brands b, taxonomy_tags t
WHERE b.slug = 'woven-words' AND t.slug = 'handmade'
ON CONFLICT DO NOTHING;

INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id FROM brands b, taxonomy_tags t
WHERE b.slug = 'woven-words' AND t.slug = 'local-culture'
ON CONFLICT DO NOTHING;

INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id FROM brands b, taxonomy_tags t
WHERE b.slug = 'woven-words' AND t.slug = 'social-enterprise'
ON CONFLICT DO NOTHING;

INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id FROM brands b, taxonomy_tags t
WHERE b.slug = 'woven-words' AND t.slug = 'fair-trade'
ON CONFLICT DO NOTHING;

-- 島嶼食光 (island-season): sustainability, local-revitalization
INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id FROM brands b, taxonomy_tags t
WHERE b.slug = 'island-season' AND t.slug = 'sustainability'
ON CONFLICT DO NOTHING;

INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id FROM brands b, taxonomy_tags t
WHERE b.slug = 'island-season' AND t.slug = 'local-revitalization'
ON CONFLICT DO NOTHING;

-- 膚語 (skin-verse): organic, sustainability, eco-friendly
INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id FROM brands b, taxonomy_tags t
WHERE b.slug = 'skin-verse' AND t.slug = 'organic'
ON CONFLICT DO NOTHING;

INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id FROM brands b, taxonomy_tags t
WHERE b.slug = 'skin-verse' AND t.slug = 'sustainability'
ON CONFLICT DO NOTHING;

INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id FROM brands b, taxonomy_tags t
WHERE b.slug = 'skin-verse' AND t.slug = 'eco-friendly'
ON CONFLICT DO NOTHING;
