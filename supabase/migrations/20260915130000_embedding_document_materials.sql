-- DEV-1733 -- Add material labels as the seventh concat_ws field in the
-- product_embedding_documents view.
--
-- SEVEN-FIELD HASH INPUT ORDER
-- ---------------------------------------------------------------------------
-- 1. b.name              (brand name)
-- 2. b.blurb             (brand blurb)
-- 3. l1.name_zh          (L1 category zh label)
-- 4. l2.name_zh          (L2 subcategory zh label)
-- 5. p.name_zh           (product name zh)
-- 6. p.product_description_zh (product description zh)
-- 7. material labels     (space-joined zh labels from taxonomy_terms, gated)
--
-- The material field is gated to five L1 categories:
--   home, fashion, bags-accessories, jewelry, stationery
-- This list mirrors MATERIAL_APPLICABLE_CATEGORIES in
-- src/lib/taxonomy/ontology.ts. Keep them in sync.
--
-- NULL-WHEN-EMPTY: products outside the gated categories, or with no material
-- array entries, produce NULL for the seventh field. concat_ws skips NULLs, so
-- hashes remain identical for material-less products.
--
-- EXPECTED STALE ROWS: approximately 730 rows will have a changed source_hash
-- once this view is applied and the nightly cron re-embeds.
--
-- APPLYING ON PRODUCTION: Railway runs no migrations against production, so
-- this file is applied BY HAND after the staging -> main promotion.
-- The nightly cron re-embeds rows whose source_hash has drifted.

begin;

create or replace view public.product_embedding_documents as
select
  p.id as product_id,
  p.brand_id,
  d.document_text as document,
  encode(extensions.digest(d.document_text, 'sha256'), 'hex') as source_hash
from public.curated_products p
join public.brands b on b.id = p.brand_id
left join public.taxonomy_terms l1 on l1.axis = 'l1' and l1.slug = p.category
left join public.taxonomy_terms l2 on l2.axis = 'l2' and l2.slug = p.subcategory
cross join lateral (
  select concat_ws(
    chr(10),
    b.name,
    b.blurb,
    l1.name_zh,
    l2.name_zh,
    p.name_zh,
    p.product_description_zh,
    case
      when p.category in ('home','fashion','bags-accessories','jewelry','stationery')
      then nullif((
        select string_agg(t.name_zh, ' ' order by m.ord)
        from unnest(p.material) with ordinality as m(slug, ord)
        join public.taxonomy_terms t on t.axis = 'material' and t.slug = m.slug
      ), '')
    end
  ) as document_text
) d
where b.status = 'approved'
  and not b.is_demo
  and p.visible
  and p.official_url is not null
  and p.source_checked_at is not null
  and exists (select 1 from curated_product_sources s where s.product_id = p.id);

revoke all on public.product_embedding_documents from PUBLIC, anon, authenticated;
grant select on public.product_embedding_documents to service_role;

comment on view public.product_embedding_documents is
  'Canonical eligibility view for product embeddings. Gates: approved brand, '
  'not demo, visible product, has official URL, has source check, has at least '
  'one provenance row. The document is the concatenation of seven fields '
  '(brand name, blurb, L1 zh, L2 zh, product name zh, product description zh, '
  'material labels zh) fed to the embedding model; source_hash drives '
  'selective re-embedding.';

commit;
