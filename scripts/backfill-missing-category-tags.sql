-- Backfill: create the 3 missing localized product_type categories and tag the
-- orphaned approved brands (Tools & Hardware / Health & Wellness / Others).
--
-- Root cause: these legacy free-text brand.category values had no canonical
-- taxonomy_tags row, so getBrandCategoryLabel fell back to the raw English string
-- AND the brands were invisible to every category filter/nav tab (which are fed
-- only by product_type tags with >= 1 approved brand).
--
-- Idempotent: safe to re-run. Run with:
--   pnpm exec supabase db query --linked --file scripts/backfill-missing-category-tags.sql

-- 1. Create the 3 canonical localized product_type categories (skip if slug exists)
insert into taxonomy_tags (name, name_zh, slug, category, is_active)
select v.name, v.name_zh, v.slug, 'product_type', true
from (values
  ('Tools & Hardware', '工具五金', 'tools-hardware'),
  ('Health & Wellness', '健康保健', 'health-wellness'),
  ('Others', '其他', 'others')
) as v(name, name_zh, slug)
where not exists (
  select 1 from taxonomy_tags t where t.slug = v.slug
);

-- 2. Link each orphaned approved brand to the matching new category tag
insert into brand_taxonomy (brand_id, tag_id, source)
select b.id, t.id, 'manual'
from brands b
join taxonomy_tags t on t.name = b.category and t.category = 'product_type'
where b.status = 'approved'
  and not exists (
    select 1 from brand_taxonomy bt
    join taxonomy_tags pt on pt.id = bt.tag_id
    where bt.brand_id = b.id and pt.category = 'product_type'
  )
  and not exists (
    select 1 from brand_taxonomy bt2
    where bt2.brand_id = b.id and bt2.tag_id = t.id
  );
