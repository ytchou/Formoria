-- Fix pg_cron auth: Supabase blocks custom GUC parameters (app.origin_secret).
-- Store secrets in a table instead. Manual post-migration step: insert actual values.

CREATE TABLE IF NOT EXISTS app_secrets (
  key text PRIMARY KEY,
  value text NOT NULL
);

COMMENT ON TABLE app_secrets IS 'Runtime secrets for pg_cron jobs. Values inserted manually via SQL editor.';

-- Reschedule MIT registry sync to read from app_secrets
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
        url := (SELECT value FROM app_secrets WHERE key = 'site_url') || '/api/cron/sync-mit-registry',
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

-- Reschedule drip processing to read from app_secrets
DO $$ BEGIN
  PERFORM cron.unschedule('process-drips-daily');
EXCEPTION WHEN others THEN
  NULL;
END $$;

SELECT cron.schedule(
    'process-drips-daily',
    '0 3 * * *',
    $$
    SELECT net.http_post(
        url := (SELECT value FROM app_secrets WHERE key = 'site_url') || '/api/cron/process-drips',
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
