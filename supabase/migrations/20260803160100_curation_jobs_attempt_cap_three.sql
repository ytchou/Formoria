alter table public.curation_jobs
  drop constraint if exists curation_jobs_attempt_check;

alter table public.curation_jobs
  add constraint curation_jobs_attempt_check check (attempt between 1 and 3);
