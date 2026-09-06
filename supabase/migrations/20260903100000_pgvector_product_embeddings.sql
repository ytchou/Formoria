-- DEV-1680 -- pgvector extension, product_embeddings table, embedding price row.
--
-- THE DEFECT THIS PREVENTS
-- ---------------------------------------------------------------------------
-- Without a dedicated embeddings table, product vectors would either live on
-- the curated_products row (bloating every read) or be untracked entirely.
-- Separating embeddings into a 1:1 table keeps the main table lean and lets
-- the model + source_hash columns drive selective re-embedding.
--
-- APPLYING THIS ON PRODUCTION: Railway runs no migrations against production,
-- so this file is applied BY HAND after the staging -> main promotion. The
-- pgvector extension must already be available in the Supabase project; on the
-- free/pro plan it is pre-installed but not enabled. The version check below
-- will abort if the installed version is below 0.8.

-- Enable pgvector in the extensions schema (idempotent).
create extension if not exists vector with schema extensions;

-- Verify minimum version for HNSW support.
do $$ begin
  if (select extversion from pg_extension where extname = 'vector') < '0.8' then
    raise exception 'pgvector >= 0.8 required for HNSW indexes; found %',
      (select extversion from pg_extension where extname = 'vector');
  end if;
end $$;

create table public.product_embeddings (
  product_id uuid primary key
    references public.curated_products (id) on delete cascade,
  model text not null,
  source_hash text not null,
  embedding extensions.vector(1536) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger product_embeddings_updated_at
  before update on public.product_embeddings
  for each row execute function set_updated_at();

-- At 971 rows the HNSW index is for parity with production practice;
-- hnsw.iterative_scan is set by the RPC at query time.
create index product_embeddings_embedding_hnsw
  on public.product_embeddings
  using hnsw (embedding extensions.vector_cosine_ops);

alter table public.product_embeddings enable row level security;
revoke all on table public.product_embeddings from anon, authenticated;

-- Embedding model price row for audit cost tracking.
insert into public.llm_model_prices
  (model, input_per_m, cached_input_per_m, output_per_m, effective_from, source)
values
  ('text-embedding-3-small', 0.02, 0.02, 0,
   '2024-01-25T00:00:00Z',
   'openai public pricing, captured 2026-09-02')
on conflict (model, effective_from) do nothing;

comment on table public.product_embeddings is
  'Vector embeddings for curated products, one row per product. The model and '
  'source_hash columns drive selective re-embedding on document change.';
