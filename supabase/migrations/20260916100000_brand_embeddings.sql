-- DEV-1734 -- brand_embeddings table + search_brands_by_centroid RPC.
--
-- Stores brand centroids (mean of product embedding vectors) for kNN
-- related-brand recommendations. At ~170 rows, exact scan is <1ms;
-- add an HNSW index when the table exceeds ~2,000 rows.

create table public.brand_embeddings (
  brand_id uuid primary key
    references public.brands(id) on delete cascade,
  model text not null,
  source_hash text not null,
  embedding extensions.vector(1536) not null,
  product_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger brand_embeddings_updated_at
  before update on public.brand_embeddings
  for each row execute function set_updated_at();

alter table public.brand_embeddings enable row level security;
revoke all on table public.brand_embeddings from anon, authenticated;

comment on table public.brand_embeddings is
  'Brand centroids — element-wise mean of product embedding vectors, one row '
  'per brand. Refreshed nightly by the product-embeddings cron. No HNSW index '
  'at ~170 rows; add when the table exceeds ~2,000.';

-- ---------------------------------------------------------------------------
-- RPC: search_brands_by_centroid
-- ---------------------------------------------------------------------------
-- Exact-scan cosine kNN over brand centroids, filtered to a single L1
-- category and excluding a source brand. Returns (brand_id, brand_slug,
-- distance) ordered by ascending cosine distance.

create or replace function public.search_brands_by_centroid(
  query_embedding extensions.vector,
  filter_category text,
  exclude_brand_id uuid,
  match_count int
)
returns table(brand_id uuid, brand_slug text, distance real)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select
    be.brand_id,
    b.slug as brand_slug,
    (be.embedding <=> query_embedding)::real as distance
  from public.brand_embeddings be
  join public.brands b on b.id = be.brand_id
  where b.status = 'approved'
    and not b.is_demo
    and b.category = filter_category
    and be.brand_id != exclude_brand_id
  order by be.embedding <=> query_embedding
  limit match_count;
$$;

revoke all on function public.search_brands_by_centroid(extensions.vector, text, uuid, int)
  from public, anon, authenticated;
grant execute on function public.search_brands_by_centroid(extensions.vector, text, uuid, int)
  to postgres, service_role;

comment on function public.search_brands_by_centroid is
  'Exact-scan cosine kNN over brand centroids for related-brand recommendations. '
  'Filtered to one L1 category; excludes the source brand.';
