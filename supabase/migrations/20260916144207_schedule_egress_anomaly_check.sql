-- Schedule the daily image-egress anomaly check (DEV-1744, task 5)
-- via the Next.js cron route.
-- The Next.js route uses x-origin-verify header
-- for auth (matching other cron routes).

-- 03:15 UTC = 11:15 Asia/Taipei. Deliberately after 00:00 UTC: the check reads
-- complete UTC days only, so running it early in the UTC day keeps the newest
-- reading one day old rather than two.

-- Review fix (DEV-1744): this file originally read the base URL and the secret
-- from `current_setting('app.site_url')` / `current_setting('app.origin_secret')`,
-- posted without recording the request in `public.cron_http_dispatch`, and ran
-- outside a transaction with no HTTP timeout. Supabase blocks custom GUC
-- parameters (see `20260713100000_fix_cron_auth.sql`) and `site_url` was renamed
-- to `cron_base_url` in `app_secrets` by
-- `20260807120000_cron_http_dispatch_capture.sql`, so the job would never have
-- fired. It now matches the sibling `20260916143000_schedule_promote_submission_images.sql`
-- exactly: `app_secrets` lookups, the `cron_http_dispatch` audit insert, a
-- transaction, and a 300000 ms timeout matching the route's `maxDuration = 300`.

begin;

-- Safely unschedule: tolerate the job not
-- existing (e.g. fresh DB).
do $$ begin
  perform cron.unschedule('egress-anomaly-check-daily');
exception when others then
  null;
end $$;

select cron.schedule(
  'egress-anomaly-check-daily',
  '15 3 * * *',
  $job$
  insert into public.cron_http_dispatch (request_id, job_name)
  values (
    (select net.http_post(
       url := (select value from public.app_secrets where key = 'cron_base_url')
         || '/api/cron/egress-anomaly-check',
       headers := jsonb_build_object(
         'x-origin-verify', (select value from public.app_secrets where key = 'origin_secret'),
         'Content-Type', 'application/json'
       ),
       body := jsonb_build_object('triggered_by', 'pg_cron', 'run_at', now()::text),
       timeout_milliseconds := 300000
     )),
    'egress-anomaly-check-daily'
  );
  $job$
);

commit;
