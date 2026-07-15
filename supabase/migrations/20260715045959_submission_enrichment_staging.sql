begin;

create table public.submission_images (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.brand_submissions(id) on delete cascade,
  storage_path text,
  url text not null,
  source text not null check (source in ('scrape', 'google_image', 'owner', 'admin', 'legacy', 'json_ld')),
  status text not null default 'active' check (status in ('active', 'rejected')),
  tags text[],
  score numeric,
  alt_zh text,
  alt_en text,
  width integer,
  height integer,
  dominant_color text,
  sort_order integer not null default 0,
  source_url text,
  phash text,
  created_at timestamptz not null default now(),
  unique (submission_id, source_url)
);

create index submission_images_active_idx
  on public.submission_images (submission_id, status, sort_order);

alter table public.submission_images enable row level security;
revoke all on table public.submission_images from public, anon, authenticated;
grant select, insert, update, delete on table public.submission_images to service_role;

alter table public.brand_ai_results
  alter column brand_id drop not null,
  add column submission_id uuid references public.brand_submissions(id) on delete cascade;

alter table public.brand_ai_results
  add constraint brand_ai_results_single_target_check
  check (num_nonnulls(brand_id, submission_id) = 1);

create index brand_ai_results_submission_phase_idx
  on public.brand_ai_results (submission_id, phase, created_at desc)
  where submission_id is not null;

alter table public.brand_search_results
  alter column brand_id drop not null,
  add column submission_id uuid references public.brand_submissions(id) on delete cascade;

alter table public.brand_search_results
  add constraint brand_search_results_single_target_check
  check (num_nonnulls(brand_id, submission_id) = 1);

create index brand_search_results_submission_type_idx
  on public.brand_search_results (submission_id, search_type, created_at desc)
  where submission_id is not null;

alter table public.brand_ai_results enable row level security;
alter table public.brand_search_results enable row level security;
revoke all on table public.brand_ai_results from public, anon, authenticated;
revoke all on table public.brand_search_results from public, anon, authenticated;
grant select, insert, update, delete on table public.brand_ai_results to service_role;
grant select, insert, update, delete on table public.brand_search_results to service_role;

create or replace function public.reject_submission(
  p_submission_id uuid,
  p_reviewer_id uuid,
  p_denial_reason text,
  p_reviewer_notes text
)
returns text[]
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_storage_paths text[];
begin
  perform 1
  from public.brand_submissions
  where id = p_submission_id
    and status = 'pending'
  for update;

  if not found then
    raise exception 'Submission not found'
      using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.curation_job_targets as target
    join public.curation_jobs as job on job.id = target.job_id
    where target.target_type = 'submission'
      and target.target_id = p_submission_id
      and target.status in ('pending', 'running')
      and job.status in ('pending', 'running')
      and job.dispatch_status <> 'failed'
  ) then
    raise exception 'Submission enrichment is still active';
  end if;

  select coalesce(array_agg(storage_path) filter (where storage_path is not null), '{}'::text[])
  into v_storage_paths
  from public.submission_images
  where submission_id = p_submission_id;

  delete from public.submission_images
  where submission_id = p_submission_id;

  update public.brand_submissions
  set status = 'rejected',
      reviewed_at = now(),
      reviewed_by = p_reviewer_id,
      denial_reason = p_denial_reason,
      reviewer_notes = nullif(p_reviewer_notes, '')
  where id = p_submission_id
    and status = 'pending';

  if not found then
    raise exception 'Submission not found'
      using errcode = 'P0002';
  end if;

  return v_storage_paths;
end;
$$;

revoke all on function public.reject_submission(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.reject_submission(uuid, uuid, text, text)
  to service_role;

commit;
