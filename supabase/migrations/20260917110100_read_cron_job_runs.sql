-- DEV-1748 -- expose pg_cron job status to the health agent via service_role.
--
-- WHY: the new cron-health detector needs to read cron.job and
-- cron.job_run_details. Those tables live in the `cron` schema, which is
-- inaccessible to application roles. A SECURITY DEFINER function with
-- search_path set to `cron, public, pg_temp` gives the health agent a
-- narrow, read-only window into the job schedule and recent failures.
--
-- ROLLBACK: DROP FUNCTION public.read_cron_job_runs(timestamptz);

CREATE OR REPLACE FUNCTION public.read_cron_job_runs(p_since timestamptz)
RETURNS TABLE(
  jobname text,
  schedule text,
  active boolean,
  last_end timestamptz,
  last_status text,
  failed_runs integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = cron, public, pg_temp
AS $$
  SELECT
    j.jobname,
    j.schedule,
    j.active,
    MAX(d.end_time) AS last_end,
    (ARRAY_AGG(d.status ORDER BY d.end_time DESC))[1] AS last_status,
    COUNT(*) FILTER (WHERE d.status = 'failed')::integer AS failed_runs
  FROM cron.job AS j
  LEFT JOIN cron.job_run_details AS d
    ON d.jobid = j.jobid
    AND d.end_time >= p_since
  GROUP BY j.jobid, j.jobname, j.schedule, j.active;
$$;

REVOKE ALL ON FUNCTION public.read_cron_job_runs(timestamptz)
  FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.read_cron_job_runs(timestamptz)
      TO service_role;
  END IF;
END;
$$;
