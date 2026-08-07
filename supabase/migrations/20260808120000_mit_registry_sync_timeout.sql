-- DEV-1391 -- give the MIT registry sync a timeout it can actually finish in.
--
-- `mit_registry` has 0 rows and has never synced. DEV-1377 explained the seven
-- weeks of 401s, but the job was scheduled with `timeout_milliseconds := 60000`
-- to match the route's `maxDuration = 60`, and 60s was never a realistic budget
-- for this job:
--
--   * the upstream ZIP is ~3.8 MB and takes ~3.4s to fetch
--   * `011.csv` inside it is ~4.4 MB / 29,452 records (measured 2026-08-08)
--   * those land as ~60 sequential 500-row upserts, then a sweep
--
-- A pg_net timeout would also be invisible as a data problem: the route keeps
-- running server-side, so a truncated run could leave the table half-written
-- while the log records a timeout.
--
-- 300000ms = src/app/api/cron/sync-mit-registry/route.ts maxDuration 300, the
-- same pairing every other cron job uses. The job runs weekly, so a request
-- that burns the full five minutes finishes days before the next tick.
--
-- Everything else about the job is unchanged and deliberately copied verbatim
-- from 20260807120000_cron_http_dispatch_capture.sql, including the coupling of
-- net.http_post inside the INSERT INTO public.cron_http_dispatch -- see that
-- migration for why the dispatch record must gate the HTTP request.

BEGIN;

DO $$ BEGIN
  PERFORM cron.unschedule('sync-mit-registry-weekly');
EXCEPTION WHEN others THEN
  NULL;
END $$;

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
       timeout_milliseconds := 300000
     )),
    'sync-mit-registry-weekly'
  );
  $job$
);

COMMIT;
