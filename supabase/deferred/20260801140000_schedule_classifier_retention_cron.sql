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

BEGIN;

DO $$ BEGIN
  PERFORM cron.unschedule('classifier-image-retention-6h');
EXCEPTION WHEN others THEN
  NULL;
END $$;

SELECT cron.schedule(
  'classifier-image-retention-6h',
  '17 */6 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT value FROM public.app_secrets WHERE key = 'site_url')
      || '/api/cron/purge-classifier-images',
    headers := jsonb_build_object(
      'x-origin-verify', (SELECT value FROM public.app_secrets WHERE key = 'origin_secret'),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('triggered_by', 'pg_cron', 'run_at', now()::text)
  )
  $$
);

COMMIT;
