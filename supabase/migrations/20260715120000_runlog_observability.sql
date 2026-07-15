alter table brand_ai_results
  add column if not exists job_id uuid references curation_jobs(id) on delete set null;

alter table brand_search_results
  add column if not exists job_id uuid references curation_jobs(id) on delete set null;

create index if not exists brand_ai_results_job_idx
  on brand_ai_results (job_id) where job_id is not null;

create index if not exists brand_search_results_job_idx
  on brand_search_results (job_id) where job_id is not null;

-- Private bucket, service-role only. RLS denies anon and authenticated access.
insert into storage.buckets (id, name, public)
values ('run-logs', 'run-logs', false)
on conflict (id) do nothing;
