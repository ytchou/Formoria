-- Schedule weekly pg_cron job to sync the MIT registry
-- via the Next.js cron route.
-- The Next.js route uses x-origin-verify header
-- for auth (matching other cron routes).

-- Safely unschedule: tolerate the job not
-- existing (e.g. fresh DB).
DO $$ BEGIN
  PERFORM cron.unschedule('sync-mit-registry-weekly');
EXCEPTION WHEN others THEN
  NULL;
END $$;

SELECT cron.schedule(
    'sync-mit-registry-weekly',
    '0 2 * * 0',
    $$
    SELECT net.http_post(
        url := current_setting('app.site_url') || '/api/cron/sync-mit-registry',
        headers := jsonb_build_object(
            'x-origin-verify', current_setting('app.origin_secret'),
            'Content-Type', 'application/json'
        ),
        body := jsonb_build_object(
            'triggered_by', 'pg_cron',
            'run_at', now()::text
        )
    )
    $$
);
