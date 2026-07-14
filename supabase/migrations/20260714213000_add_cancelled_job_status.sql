ALTER TABLE public.curation_jobs
  DROP CONSTRAINT IF EXISTS curation_jobs_status_check,
  ADD CONSTRAINT curation_jobs_status_check
    CHECK (status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text]));
