-- Enable pg_net extension for HTTP requests from pg_cron jobs
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Schedule daily at 03:00 UTC
SELECT cron.schedule(
    'process-drips-daily',
    '0 3 * * *',
    $$
  SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/process-drips',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.cron_secret'),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'triggered_by', 'pg_cron',
      'run_at', now()::text
    )
  );
  $$
);
