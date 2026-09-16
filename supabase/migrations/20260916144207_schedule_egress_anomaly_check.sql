-- Schedule the daily image-egress anomaly check (DEV-1744, task 5)
-- via the Next.js cron route.
-- The Next.js route uses x-origin-verify header
-- for auth (matching other cron routes).

-- 03:15 UTC = 11:15 Asia/Taipei. Deliberately after 00:00 UTC: the check reads
-- complete UTC days only, so running it early in the UTC day keeps the newest
-- reading one day old rather than two.

-- Safely unschedule: tolerate the job not
-- existing (e.g. fresh DB).
DO $$ BEGIN
  PERFORM cron.unschedule('egress-anomaly-check-daily');
EXCEPTION WHEN others THEN
  NULL;
END $$;

SELECT cron.schedule(
    'egress-anomaly-check-daily',
    '15 3 * * *',
    $$
    SELECT net.http_post(
        url := current_setting('app.site_url') || '/api/cron/egress-anomaly-check',
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
