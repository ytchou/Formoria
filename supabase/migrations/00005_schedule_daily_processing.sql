-- Enable extensions (pre-installed on Supabase cloud)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule daily at 09:00 UTC (17:00 Taiwan time)
SELECT cron.schedule(
    'daily-submission-processing',
    '0 9 * * *',
    $$
  SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/process-submissions',
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
