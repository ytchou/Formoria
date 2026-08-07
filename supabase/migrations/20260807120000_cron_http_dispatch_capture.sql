-- DEV-1377 -- repair how the pg_cron HTTP jobs are scheduled.
--
-- WHY: all four pg_cron HTTP jobs returned 401 for roughly seven weeks and
-- nothing noticed. Two independent causes, both fixed here:
--
--   1. `app_secrets.site_url` pointed at the Cloudflare-fronted public host, and
--      Cloudflare unconditionally overwrites the `x-origin-verify` header. Every
--      request reached the route with the wrong secret and was rejected.
--
--   2. Nothing could see it. A green scheduler is not a green job --
--      `cron.job_run_details` reports on the enqueue, not the outcome.
--      `net.http_post` only queues the request and returns a request id, so the
--      job's SQL succeeds no matter what the server answers. Seven weeks of 401s
--      show up as seven weeks of `succeeded`.
--
-- Ground truth for an HTTP cron job lives in `net._http_response`, which has no
-- url column -- a response row cannot be attributed to a job after the fact.
-- Attribution has to be captured at dispatch time, from the request id
-- `net.http_post` returns. That is what `public.cron_http_dispatch` is for; the
-- companion migration snapshots the join into a durable log before pg_net's
-- 6-hour TTL prunes the responses.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Retire the pg_cron copy of link-health.
-- ---------------------------------------------------------------------------
-- The GitHub Actions health agent already invokes POST /api/cron/link-health at
-- the Railway origin nightly (scripts/health-agent/orchestrator.ts:365) with a
-- valid body. The pg_cron copy sends {triggered_by, run_at}, which that route's
-- allow-list rejects with a 400 -- and if it ever did get through, the two
-- callers would race on the same `health_agent_run_ledger` claim. One flow, one
-- caller: the health agent keeps it, pg_cron drops it.
DO $$ BEGIN
  PERFORM cron.unschedule('link-health-daily');
EXCEPTION WHEN others THEN
  NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Rename the base-url secret to say what it actually is.
-- ---------------------------------------------------------------------------
-- `site_url` invited exactly the mistake that caused this incident: it reads
-- like "the site's URL", so it got set to the public host. It is not that. It is
-- an origin that deliberately bypasses Cloudflare, because Cloudflare rewrites
-- the `x-origin-verify` header these jobs authenticate with. `cron_base_url`
-- names the constraint, so nobody restores the public host without meeting it.
--
-- Production value is already the Railway origin
-- (https://mitmap-production.up.railway.app), applied as containment before this
-- migration. This copies whatever is live rather than hardcoding a host.
INSERT INTO public.app_secrets (key, value)
SELECT 'cron_base_url', value FROM public.app_secrets WHERE key = 'site_url'
ON CONFLICT (key) DO NOTHING;

DELETE FROM public.app_secrets WHERE key = 'site_url';

-- Re-running after the rename is a no-op (the SELECT finds nothing and
-- cron_base_url is left alone). But a database that had neither key would leave
-- the jobs building `NULL || '/api/cron/...'` -- warn loudly instead of
-- scheduling jobs that silently post nowhere.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_secrets WHERE key = 'cron_base_url') THEN
    RAISE WARNING 'app_secrets.cron_base_url is not set -- pg_cron HTTP jobs will post to a NULL url until it is inserted (must be the Railway origin, NOT the Cloudflare-fronted public host)';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Dispatch ledger: request id -> job name, captured at post time.
-- ---------------------------------------------------------------------------
-- `net._http_response` has no url column, so this is the only place the mapping
-- from a pg_net request id back to the job that made it can exist.
CREATE TABLE IF NOT EXISTS public.cron_http_dispatch (
  request_id    bigint PRIMARY KEY,
  job_name      text NOT NULL,
  dispatched_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cron_http_dispatch IS
  'DEV-1377: maps a pg_net request id to the pg_cron job that dispatched it. Written inline by each cron job; read by the cron-http-snapshot job before pg_net TTL prunes net._http_response.';

-- Retention sweep and "which dispatches are still unanswered" both scan by time.
CREATE INDEX IF NOT EXISTS cron_http_dispatch_dispatched_at_idx
  ON public.cron_http_dispatch (dispatched_at);

-- No policies, deliberately. service_role bypasses RLS; nothing else may read
-- operational dispatch records.
ALTER TABLE public.cron_http_dispatch ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cron_http_dispatch FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Reschedule the three surviving jobs.
-- ---------------------------------------------------------------------------
-- Schedules are unchanged. Three things change in each command:
--   * `cron_base_url` instead of `site_url`
--   * the request id is captured into cron_http_dispatch
--   * an explicit timeout_milliseconds derived from the route's maxDuration
--
-- That last one matters: net.http_post defaults to timeout_milliseconds = 5000,
-- so any route slower than five seconds records a pg_net timeout even when the
-- work on the other end completed. These jobs all run far longer than 5s.
--
-- Every table reference is schema-qualified -- cron runs with its own
-- search_path and will not find bare `app_secrets`.

DO $$ BEGIN
  PERFORM cron.unschedule('sync-mit-registry-weekly');
EXCEPTION WHEN others THEN
  NULL;
END $$;

-- timeout 60000ms = src/app/api/cron/sync-mit-registry/route.ts maxDuration 60.
SELECT cron.schedule(
  'sync-mit-registry-weekly',
  '0 2 * * 0',
  $job$
  INSERT INTO public.cron_http_dispatch (request_id, job_name)
  VALUES (
    (SELECT net.http_post(
       url := (SELECT value FROM public.app_secrets WHERE key = 'cron_base_url')
         || '/api/cron/sync-mit-registry',
       headers := jsonb_build_object(
         'x-origin-verify', (SELECT value FROM public.app_secrets WHERE key = 'origin_secret'),
         'Content-Type', 'application/json'
       ),
       body := jsonb_build_object('triggered_by', 'pg_cron', 'run_at', now()::text),
       timeout_milliseconds := 60000
     )),
    'sync-mit-registry-weekly'
  );
  $job$
);

DO $$ BEGIN
  PERFORM cron.unschedule('process-drips-daily');
EXCEPTION WHEN others THEN
  NULL;
END $$;

-- timeout 120000ms. src/app/api/cron/process-drips/route.ts exports no
-- maxDuration, so there is no declared ceiling to copy. The route loops over
-- every DRIP_TYPE and sends email per match, so its runtime scales with the
-- backlog: 5s would time out on any non-trivial day, and matching
-- claim-proof-cleanup's 300s would leave a genuinely wedged job hidden for five
-- minutes. Two minutes is the compromise -- raise it here and add an explicit
-- maxDuration to the route together if drip volume ever needs more.
SELECT cron.schedule(
  'process-drips-daily',
  '0 3 * * *',
  $job$
  INSERT INTO public.cron_http_dispatch (request_id, job_name)
  VALUES (
    (SELECT net.http_post(
       url := (SELECT value FROM public.app_secrets WHERE key = 'cron_base_url')
         || '/api/cron/process-drips',
       headers := jsonb_build_object(
         'x-origin-verify', (SELECT value FROM public.app_secrets WHERE key = 'origin_secret'),
         'Content-Type', 'application/json'
       ),
       body := jsonb_build_object('triggered_by', 'pg_cron', 'run_at', now()::text),
       timeout_milliseconds := 120000
     )),
    'process-drips-daily'
  );
  $job$
);

DO $$ BEGIN
  PERFORM cron.unschedule('claim-proof-cleanup-hourly');
EXCEPTION WHEN others THEN
  NULL;
END $$;

-- timeout 300000ms = src/app/api/cron/claim-proof-cleanup/route.ts
-- maxDuration 300. The job runs hourly, so a request that burns the full five
-- minutes still finishes long before the next tick.
SELECT cron.schedule(
  'claim-proof-cleanup-hourly',
  '17 * * * *',
  $job$
  INSERT INTO public.cron_http_dispatch (request_id, job_name)
  VALUES (
    (SELECT net.http_post(
       url := (SELECT value FROM public.app_secrets WHERE key = 'cron_base_url')
         || '/api/cron/claim-proof-cleanup',
       headers := jsonb_build_object(
         'x-origin-verify', (SELECT value FROM public.app_secrets WHERE key = 'origin_secret'),
         'Content-Type', 'application/json'
       ),
       body := jsonb_build_object('triggered_by', 'pg_cron', 'run_at', now()::text),
       timeout_milliseconds := 300000
     )),
    'claim-proof-cleanup-hourly'
  );
  $job$
);

COMMIT;
