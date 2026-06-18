-- Update pg_cron job to call Next.js cron route instead of Supabase Edge Function
-- The Next.js route uses x-origin-verify header for auth (matching other cron routes)

SELECT cron.unschedule('process-drips-daily');

SELECT cron.schedule(
    'process-drips-daily',
    '0 3 * * *',
    $$
    SELECT net.http_post(
        url := current_setting('app.site_url') || '/api/cron/process-drips',
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
