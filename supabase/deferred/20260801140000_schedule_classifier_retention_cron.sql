-- DEFERRED -- not in supabase/migrations/, so `db push` will not apply it.
-- See supabase/deferred/README.md.
--
-- Schedules the retention reaper that hard-deletes storage objects for images
-- rejected more than RETENTION_MS (7 days) ago, via
-- src/lib/services/image-retention.ts.
--
-- Held because scheduling it starts irreversible deletion. Two things must be
-- true before this moves into supabase/migrations/:
--
--   1. DEV-1279 has settled whether classifier rejection should delete storage
--      at all, or only mark rejected and let this reaper be the single deletion
--      path.
--   2. The backfill in 20260731174639 only stamped rejected_at on rows whose
--      tags intersect {promo, text_banner, irrelevant}. Production has ~1123
--      rejected rows with tags IS NULL and source='legacy' that this reaper will
--      never see. Decide whether they are swept or left orphaned before turning
--      the cron on.
--
-- The route it calls (/api/cron/purge-classifier-images) ships on this branch;
-- scheduling before that deploys is harmless but will log 404s every 6 hours.
--
-- DEV-1377: updated in place so this file cannot reintroduce the cron 401 bug if
-- it is ever un-deferred. It now uses app_secrets.cron_base_url (the Railway
-- origin -- the Cloudflare-fronted public host overwrites the x-origin-verify
-- header these jobs authenticate with), captures the pg_net request id into
-- public.cron_http_dispatch, and sets an explicit timeout. Both are required for
-- the job to be observable at all: a green scheduler is not a green job --
-- cron.job_run_details reports on the enqueue, not the outcome.
-- Prerequisites, both in supabase/migrations/: 20260807120000 (cron_base_url +
-- cron_http_dispatch) and 20260807120100 (cron_http_log + snapshot job).

BEGIN;

DO $$ BEGIN
  PERFORM cron.unschedule('classifier-image-retention-6h');
EXCEPTION WHEN others THEN
  NULL;
END $$;

SELECT cron.schedule(
  'classifier-image-retention-6h',
  '17 */6 * * *',
  $job$
  -- timeout 300000ms = src/app/api/cron/purge-classifier-images/route.ts
  -- maxDuration 300. Without it net.http_post defaults to 5000ms and would
  -- record a pg_net timeout on every run of a route allowed to take 300s.
  INSERT INTO public.cron_http_dispatch (request_id, job_name)
  VALUES (
    (SELECT net.http_post(
       url := (SELECT value FROM public.app_secrets WHERE key = 'cron_base_url')
         || '/api/cron/purge-classifier-images',
       headers := jsonb_build_object(
         'x-origin-verify', (SELECT value FROM public.app_secrets WHERE key = 'origin_secret'),
         'Content-Type', 'application/json'
       ),
       body := jsonb_build_object('triggered_by', 'pg_cron', 'run_at', now()::text),
       timeout_milliseconds := 300000
     )),
    'classifier-image-retention-6h'
  );
  $job$
);

COMMIT;
