-- MIT Map: Expand taxonomy — add 'value' category + more product types
-- Safe to run multiple times (idempotent via ON CONFLICT)

-- =============================================================================
-- 1. Expand category CHECK constraint to include 'value'
-- =============================================================================
ALTER TABLE taxonomy_tags DROP CONSTRAINT IF EXISTS taxonomy_tags_category_check;
ALTER TABLE taxonomy_tags ADD CONSTRAINT taxonomy_tags_category_check
CHECK (
    category IN ('product_type', 'material', 'price_range', 'region', 'value')
);

-- =============================================================================
-- 2. Upsert full set of 23 product_type tags
--    ON CONFLICT (slug) updates name/name_zh to canonical values
-- =============================================================================
INSERT INTO taxonomy_tags (name, name_zh, slug, category, is_active)
VALUES
('Clothing', '服飾', 'clothing', 'product_type', true),
('Footwear', '鞋履', 'footwear', 'product_type', true),
('Bags & Leather', '包袋皮件', 'bags', 'product_type', true),
('Jewelry', '飾品', 'jewelry', 'product_type', true),
('Accessories', '配件', 'accessories', 'product_type', true),
('Food & Snacks', '食品', 'food', 'product_type', true),
('Beverages', '飲品', 'beverages', 'product_type', true),
('Agriculture', '農產', 'agriculture', 'product_type', true),
('Beauty & Skincare', '美妝保養', 'beauty', 'product_type', true),
('Bath & Body Care', '洗沐清潔', 'bath-body', 'product_type', true),
('Home & Living', '居家生活', 'home', 'product_type', true),
('Kitchen & Cookware', '廚房', 'kitchen', 'product_type', true),
('Furniture', '家具', 'furniture', 'product_type', true),
('Stationery & Design', '文具設計', 'stationery', 'product_type', true),
('Art & Creative', '藝術創作', 'art', 'product_type', true),
('Outdoor & Sports', '戶外運動', 'outdoor', 'product_type', true),
('Tech & Electronics', '3C科技', 'tech', 'product_type', true),
('Pets', '寵物', 'pets', 'product_type', true),
('Baby & Kids', '母嬰', 'baby-kids', 'product_type', true),
('Crafts & Handmade', '手作工藝', 'crafts', 'product_type', true),
('Fragrance', '香氛', 'fragrance', 'product_type', true),
('Gardening', '園藝植栽', 'gardening', 'product_type', true),
('Experiences', '體驗觀光', 'experiences', 'product_type', true)
ON CONFLICT (slug) DO UPDATE
    SET
        name = excluded.name,
        name_zh = excluded.name_zh,
        category = excluded.category,
        is_active = excluded.is_active;

-- =============================================================================
-- 3. Insert 8 value tags (skip old slugs that don't exist)
-- =============================================================================
INSERT INTO taxonomy_tags (name, name_zh, slug, category, is_active)
VALUES
('Sustainability', '永續', 'sustainability', 'value', true),
('Local Revitalization', '地方創生', 'local-revitalization', 'value', true),
('Social Enterprise', '社會企業', 'social-enterprise', 'value', true),
('Local Culture', '在地文化', 'local-culture', 'value', true),
('Fair Trade', '公平貿易', 'fair-trade', 'value', true),
('Handmade', '手作', 'handmade', 'value', true),
('Organic', '有機', 'organic', 'value', true),
('Eco-Friendly', '環保', 'eco-friendly', 'value', true)
ON CONFLICT (slug) DO UPDATE
    SET
        name = excluded.name,
        name_zh = excluded.name_zh,
        category = excluded.category,
        is_active = excluded.is_active;
