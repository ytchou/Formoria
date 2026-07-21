-- Schedule the link-health daily cron job.
-- Job: link-health-daily
-- Schedule: 20 22 * * * (22:20 UTC = 06:20 Asia/Taipei)
-- Reads URL and secret from app_secrets table (set up in 20260713100000_fix_cron_auth.sql).

DO $$ BEGIN
  PERFORM cron.unschedule('link-health-daily');
EXCEPTION WHEN others THEN
  NULL;
END $$;

SELECT cron.schedule(
    'link-health-daily',
    '20 22 * * *',
    $$
    SELECT net.http_post(
        url := (SELECT value FROM app_secrets WHERE key = 'site_url') || '/api/cron/link-health',
        headers := jsonb_build_object(
            'x-origin-verify', (SELECT value FROM app_secrets WHERE key = 'origin_secret'),
            'Content-Type', 'application/json'
        ),
        body := jsonb_build_object(
            'triggered_by', 'pg_cron',
            'run_at', now()::text
        )
    )
    $$
);
