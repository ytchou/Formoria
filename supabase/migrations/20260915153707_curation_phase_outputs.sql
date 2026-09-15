-- Curation phase outputs (DEV-1611): per-phase output storage for the block DAG runner.
--
-- One row per (job, target, phase). The unique constraint ensures at most one
-- output per phase per target per job. `persisted_at` is stamped by the
-- enriched_data write that merged this row; null = output not yet merged.
--
-- Deploy note: push to production by hand BEFORE the worker deploy (Railway
-- runs no migrations).

create table public.curation_phase_outputs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.curation_jobs(id) on delete cascade,
  target_type text not null check (target_type in ('submission', 'brand')),
  target_id uuid not null,
  phase text not null,
  status text not null check (status in ('succeeded', 'skipped', 'failed')),
  output jsonb,
  persisted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (job_id, target_type, target_id, phase)
);

create index curation_phase_outputs_latest_idx
  on public.curation_phase_outputs (target_type, target_id, phase, created_at desc);

comment on column public.curation_phase_outputs.persisted_at is
  'Set by the enriched_data write that merged this row; null = output not yet merged into brand_submissions.enriched_data.';

alter table public.curation_phase_outputs enable row level security;
revoke all on public.curation_phase_outputs from anon, authenticated;

-- Backfill from existing phase_results (succeeded rows only).
-- Maps legacy 'expansion' to 'reputation'; on conflict = idempotent re-run.
insert into public.curation_phase_outputs
  (job_id, target_type, target_id, phase, status, output, persisted_at, created_at)
select t.job_id, t.target_type, t.target_id,
       case when e->>'phase' = 'expansion' then 'reputation' else e->>'phase' end,
       'succeeded', null, t.created_at, t.created_at
from public.curation_job_targets t, jsonb_array_elements(t.phase_results) e
where e->>'status' = 'succeeded'
  and (e->>'phase') in ('clean','detect','slugs','tags','discover','links','acquire','names','site_identity',
                        'images','classify_images','descriptions','stockists','faq','products','expansion','reputation')
on conflict (job_id, target_type, target_id, phase) do nothing;

-- Widen brand_search_results search_type CHECK to include 'catalog' (decision 1).
alter table public.brand_search_results drop constraint brand_search_results_search_type_check;
alter table public.brand_search_results add constraint brand_search_results_search_type_check
  check (search_type in ('serp', 'image', 'maps', 'scrape', 'catalog'));
