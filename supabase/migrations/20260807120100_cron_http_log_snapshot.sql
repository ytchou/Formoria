-- DEV-1377 -- durable outcome log for the pg_cron HTTP jobs.
--
-- WHY: a green scheduler is not a green job -- `cron.job_run_details` reports on
-- the enqueue, not the outcome. `net.http_post` returns a request id the instant
-- the request is queued, so the job's SQL succeeds whether the server answered
-- 200, 401, or never answered at all. That is how four cron jobs 401'd for seven
-- weeks with a clean scheduler history.
--
-- The real outcome lands in `net._http_response`, which is unusable as a
-- monitoring surface for two reasons:
--
--   * pg_net.ttl is 6 hours. Rows are pruned. A nightly or weekly monitor
--     reading it directly is structurally blind to a job that ran at 03:00 UTC
--     or last Sunday -- the evidence is already gone when it looks.
--   * It has no url column, so a response cannot be attributed to a job. That
--     mapping only exists in public.cron_http_dispatch, captured at post time by
--     the companion migration.
--
-- So: snapshot the join every 15 minutes into a table that keeps 30 days. Two
-- deliberate design choices:
--
--   * The snapshot job is PURE SQL. It makes no HTTP call. A monitor that
--     depends on the mechanism it monitors fails silently in exactly the
--     scenario it exists to catch.
--   * A pg_net timeout is recorded as its OWN signal (`timed_out`), separate
--     from a non-2xx. net.http_post's timeout means "pg_net stopped waiting",
--     not "the work failed" -- the route may well have finished. Collapsing the
--     two would turn a slow-route tuning problem into a fake outage.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The durable log.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cron_http_log (
  request_id bigint PRIMARY KEY,
  job_name   text NOT NULL,
  -- NULL means pg_net recorded no status: the request errored or timed out.
  -- A dispatch that was never answered at all has no row here at all --
  -- absence is detected downstream from an expected-job list with a per-job
  -- max age, not synthesized into this table.
  status_code int,
  -- Distinct from a non-2xx on purpose. pg_net gave up waiting; the route may
  -- have completed successfully on the other side.
  timed_out  boolean NOT NULL DEFAULT false,
  error_msg  text,
  -- net._http_response.created: when pg_net recorded the response.
  created    timestamptz,
  -- When the snapshot job wrote or last refreshed this row.
  logged_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cron_http_log IS
  'DEV-1377: durable 30-day outcome log for pg_cron HTTP jobs, snapshotted from net._http_response before pg_net TTL (6h) prunes it. cron.job_run_details reports the enqueue, not the outcome -- this table is the outcome.';

COMMENT ON COLUMN public.cron_http_log.timed_out IS
  'pg_net stopped waiting for a response. NOT the same as a failed job -- the route may have completed. Alert on it separately from a non-2xx status_code.';

-- Every real query filters on logged_at: the collector reads
-- `logged_at=gte.<cutoff>` and retention deletes `WHERE logged_at < ...`.
-- Nothing filters on `created` (which is NULL whenever no response was
-- recorded) or on `job_name` -- grouping by job happens in TypeScript after the
-- rows are fetched. One index, on the only column with a predicate.
CREATE INDEX IF NOT EXISTS cron_http_log_logged_at_idx
  ON public.cron_http_log (logged_at);

DROP INDEX IF EXISTS public.cron_http_log_created_desc_idx;
DROP INDEX IF EXISTS public.cron_http_log_job_name_idx;

-- RLS on, with one narrow exception: health_agent_reader is the role the
-- GitHub Actions health-agent collector authenticates as over PostgREST, and
-- this table is its input. Both halves are required -- the GRANT alone is
-- denied by RLS, the policy alone is denied by the missing table privilege.
-- service_role bypasses RLS; anon/authenticated get nothing.
ALTER TABLE public.cron_http_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cron_http_log FROM anon, authenticated;

-- Mirrors the sibling grants in
-- 20260722200000_github_health_agent_foundations.sql. Guarded on role existence
-- because health_agent_reader is provisioned manually in production and does
-- not exist in local/CI Supabase.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'health_agent_reader') THEN
    GRANT SELECT ON TABLE public.cron_http_log TO health_agent_reader;

    DROP POLICY IF EXISTS health_agent_reader_cron_http_log ON public.cron_http_log;
    CREATE POLICY health_agent_reader_cron_http_log
      ON public.cron_http_log FOR SELECT TO health_agent_reader
      USING (true);
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. The snapshot job -- pure SQL, every 15 minutes.
-- ---------------------------------------------------------------------------
-- 15 minutes comfortably beats the 6-hour TTL: a response would have to be
-- pruned within a quarter-hour of being written to escape this, which cannot
-- happen.
--
-- This job does ONE thing: snapshot outcomes. Retention is a separate job
-- (below) on purpose -- bundling them puts both in one transaction, so a
-- failing INSERT would roll back the DELETEs and leave the monitor blind AND
-- both tables growing unbounded, with the only evidence in cron.job_run_details
-- (the surface nobody watches, which is why this ticket exists).
DO $$ BEGIN
  PERFORM cron.unschedule('cron-http-snapshot');
EXCEPTION WHEN others THEN
  NULL;
END $$;

SELECT cron.schedule(
  'cron-http-snapshot',
  '*/15 * * * *',
  $job$
  -- Answered dispatches. Upsert, not insert: a dispatch can be snapshotted
  -- while pg_net still has it pending and resolve afterwards, so the later run
  -- must be able to correct the row.
  INSERT INTO public.cron_http_log (request_id, job_name, status_code, timed_out, error_msg, created)
  SELECT
    dispatch.request_id,
    dispatch.job_name,
    response.status_code,
    coalesce(response.timed_out, false),
    response.error_msg,
    response.created
  FROM public.cron_http_dispatch AS dispatch
  JOIN net._http_response AS response ON response.id = dispatch.request_id
  ON CONFLICT (request_id) DO UPDATE SET
    status_code = excluded.status_code,
    timed_out   = excluded.timed_out,
    error_msg   = excluded.error_msg,
    created     = excluded.created,
    logged_at   = now();
  $job$
);

-- ---------------------------------------------------------------------------
-- 3. Retention -- its own job, deliberately.
-- ---------------------------------------------------------------------------
-- 30 days on both tables. The dispatch ledger only exists to survive pg_net's
-- 6-hour TTL window; once a row is snapshotted it is dead weight, and 30 days
-- is far more slack than that needs.
--
-- Separate from the snapshot job so the two failure modes stay independent: a
-- broken snapshot must not also stop retention, and a broken retention sweep
-- must not also blind the monitor. Pure SQL, daily -- neither table accumulates
-- fast enough to need more.
DO $$ BEGIN
  PERFORM cron.unschedule('cron-http-retention');
EXCEPTION WHEN others THEN
  NULL;
END $$;

SELECT cron.schedule(
  'cron-http-retention',
  '40 3 * * *',
  $job$
  DELETE FROM public.cron_http_log WHERE logged_at < now() - interval '30 days';
  DELETE FROM public.cron_http_dispatch WHERE dispatched_at < now() - interval '30 days';
  $job$
);

COMMIT;
