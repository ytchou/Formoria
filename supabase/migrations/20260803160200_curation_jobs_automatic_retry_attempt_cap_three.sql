alter table public.curation_jobs
  drop constraint if exists curation_jobs_automatic_retry_check;

alter table public.curation_jobs
  add constraint curation_jobs_automatic_retry_check
    check (
      trigger <> 'automatic_retry'
      or (parent_job_id is not null and attempt between 2 and 3)
    );
