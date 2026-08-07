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
  -- NULL means pg_net has no status: either the request errored/timed out, or
  -- it was never answered at all (see the silence marker below).
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

CREATE INDEX IF NOT EXISTS cron_http_log_created_desc_idx
  ON public.cron_http_log (created DESC);
CREATE INDEX IF NOT EXISTS cron_http_log_job_name_idx
  ON public.cron_http_log (job_name);

-- No policies, deliberately. service_role bypasses RLS; nothing else may read
-- operational cron records.
ALTER TABLE public.cron_http_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cron_http_log FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The snapshot job -- pure SQL, every 15 minutes.
-- ---------------------------------------------------------------------------
-- 15 minutes comfortably beats the 6-hour TTL: a response would have to be
-- pruned within a quarter-hour of being written to escape this, which cannot
-- happen. It also bounds how long a dispatch sits unresolved before the silence
-- marker fires.
DO $$ BEGIN
  PERFORM cron.unschedule('cron-http-snapshot');
EXCEPTION WHEN others THEN
  NULL;
END $$;

SELECT cron.schedule(
  'cron-http-snapshot',
  '*/15 * * * *',
  $job$
  -- (a) Answered dispatches. Upsert, not insert: a dispatch can be snapshotted
  -- while pg_net still has it pending (or already marked silent below) and
  -- resolve afterwards, so the later run must be able to correct the row.
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

  -- (b) Silence. A dispatch with no response row at all is a real failure mode
  -- -- pg_net's worker never recorded a result -- and it is invisible if
  -- represented by absence, because the dispatch row is itself deleted at 30
  -- days. Record it explicitly instead: status_code NULL with this exact
  -- error_msg prefix is the marker a downstream collector matches on.
  --
  -- 30 minutes is the threshold: the longest configured timeout is 300s, so
  -- anything unanswered after half an hour is never going to be answered.
  -- DO NOTHING, so a silence marker can never overwrite a real outcome that (a)
  -- already wrote -- while (a)'s DO UPDATE can still correct a silence marker.
  INSERT INTO public.cron_http_log (request_id, job_name, status_code, timed_out, error_msg, created)
  SELECT
    dispatch.request_id,
    dispatch.job_name,
    NULL,
    false,
    'cron_http_no_response: pg_net recorded no response within 30 minutes of dispatch',
    NULL
  FROM public.cron_http_dispatch AS dispatch
  WHERE dispatch.dispatched_at < now() - interval '30 minutes'
    AND NOT EXISTS (
      SELECT 1 FROM net._http_response AS response WHERE response.id = dispatch.request_id
    )
  ON CONFLICT (request_id) DO NOTHING;

  -- (c) Retention, 30 days on both tables. The dispatch ledger only exists to
  -- survive the 6-hour TTL window; once a row is snapshotted it is dead weight,
  -- and 30 days is far more slack than that needs.
  DELETE FROM public.cron_http_log WHERE logged_at < now() - interval '30 days';
  DELETE FROM public.cron_http_dispatch WHERE dispatched_at < now() - interval '30 days';
  $job$
);

COMMIT;
