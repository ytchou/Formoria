-- Curated product candidates (DEV-1610): scored candidate pool for product-led curation.
--
-- One row per candidate per run (append-only, no upsert), so a ranking shift
-- after a prompt change is visible run-over-run. Gates, LLM scores and
-- rationale are persisted for every candidate including the ones that were
-- gated out.

create table public.curated_product_candidates (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  submission_id uuid references public.brand_submissions(id) on delete set null,
  job_id uuid,
  url text not null,
  normalized_url text not null,
  title text,
  image_url text,
  supplier text not null,
  url_class text not null,
  search_position integer,
  gate_result text not null,
  llm_score numeric,
  llm_rationale text,
  final_rank integer,
  created_at timestamptz not null default now()
);

create index curated_product_candidates_brand_created_idx
  on public.curated_product_candidates (brand_id, created_at desc);
create index curated_product_candidates_job_idx
  on public.curated_product_candidates (job_id);

alter table public.curated_product_candidates enable row level security;
revoke all on public.curated_product_candidates from anon, authenticated;
