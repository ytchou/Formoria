-- Reverse of DEV-1733: restore the product_embedding_documents view to the
-- original six-field concat_ws body from 20260903100200_situation_search.sql,
-- removing the seventh material-labels field.
--
-- Applying it for real, against a target confirmed by hand, in a fresh session:
--
--   psql "$SUPABASE_DB_URL" --single-transaction \
--     -f supabase/migrations/reverse/20260915130000_revert_embedding_document_materials.sql
--
-- The next nightly embedding refresh will re-embed the ~730 rows whose
-- source_hash reverts to the six-field value.
--
-- `supabase/migrations/reverse/` is a rollback holding area, NOT part of the
-- forward ledger. `scripts/db-deploy.ts` enumerates `supabase/migrations`
-- non-recursively and keeps only `*.sql`, so nothing in here is ever applied
-- by `pnpm db:migrate` or counted by `db:verify`.

begin;

create or replace view public.product_embedding_documents as
select
  p.id as product_id,
  p.brand_id,
  concat_ws(
    chr(10),
    b.name,
    b.blurb,
    l1.name_zh,
    l2.name_zh,
    p.name_zh,
    p.product_description_zh
  ) as document,
  encode(extensions.digest(
    concat_ws(
      chr(10),
      b.name,
      b.blurb,
      l1.name_zh,
      l2.name_zh,
      p.name_zh,
      p.product_description_zh
    ),
    'sha256'
  ), 'hex') as source_hash
from public.curated_products p
join public.brands b on b.id = p.brand_id
left join public.taxonomy_terms l1
  on l1.axis = 'l1' and l1.slug = p.category
left join public.taxonomy_terms l2
  on l2.axis = 'l2' and l2.slug = p.subcategory
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
  'one provenance row. The document is the concatenation fed to the embedding '
  'model; source_hash drives selective re-embedding.';

commit;
