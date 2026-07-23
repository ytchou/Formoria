begin;

-- Keep the existing search table as the single evidence ledger. Legacy rows
-- remain readable while new adapters record a complete request lifecycle.
alter table public.brand_search_results
  add column if not exists provider text not null default 'legacy',
  add column if not exists endpoint text,
  add column if not exists input jsonb,
  add column if not exists call_status text not null default 'succeeded',
  add column if not exists http_status integer,
  add column if not exists error text,
  add column if not exists attempt smallint not null default 1;

alter table public.brand_search_results
  drop constraint if exists brand_search_results_search_type_check;

alter table public.brand_search_results
  add constraint brand_search_results_search_type_check
    check (search_type in ('serp', 'image', 'maps', 'scrape'));

alter table public.brand_search_results
  add constraint brand_search_results_call_status_check
    check (call_status in (
      'started', 'succeeded', 'empty', 'failed', 'malformed',
      'timeout', 'network_error'
    ));

alter table public.brand_search_results
  add constraint brand_search_results_attempt_check check (attempt > 0);

create index if not exists brand_search_results_status_idx
  on public.brand_search_results (call_status, created_at desc);

create table public.brand_location_candidates (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid references public.brands(id) on delete cascade,
  submission_id uuid references public.brand_submissions(id) on delete cascade,
  job_id uuid references public.curation_jobs(id) on delete set null,
  location jsonb not null,
  normalized_address text,
  normalized_identity text not null,
  verification_decision text not null
    check (verification_decision in ('verified', 'needs_review', 'rejected')),
  match_reason text not null,
  evidence jsonb not null default '[]'::jsonb,
  audit_result_ids uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brand_location_candidates_single_target_check
    check (num_nonnulls(brand_id, submission_id) = 1),
  constraint brand_location_candidates_location_object_check
    check (jsonb_typeof(location) = 'object'),
  constraint brand_location_candidates_evidence_array_check
    check (jsonb_typeof(evidence) = 'array')
);

create index brand_location_candidates_submission_idx
  on public.brand_location_candidates (submission_id, created_at desc)
  where submission_id is not null;

create index brand_location_candidates_brand_idx
  on public.brand_location_candidates (brand_id, created_at desc)
  where brand_id is not null;

create index brand_location_candidates_address_idx
  on public.brand_location_candidates (normalized_address)
  where normalized_address is not null;

alter table public.brand_location_candidates enable row level security;
revoke all on table public.brand_location_candidates from public, anon, authenticated;
grant select, insert, update, delete on table public.brand_location_candidates to service_role;

commit;
