-- DEV-1318 -- schedule the nightly dead-link cleanup as a pg_cron HTTP job.
--
-- Replaces `.github/workflows/link-cleanup.yml` and `scripts/link-cleanup/run.ts`:
-- the operator script became `POST /api/cron/link-cleanup`, so no production
-- pipeline lives under `scripts/` any more.
--
-- APPLYING THIS ON PRODUCTION: Railway runs no migrations against production,
-- so this file is applied BY HAND after the staging -> main promotion. Its three
-- dependencies -- `public.cron_http_dispatch`, `app_secrets.cron_base_url`, and
-- `app_secrets.origin_secret` -- were verified present on production on
-- 2026-09-02, so no bootstrap is needed; run this file as-is.
--
-- Dispatch logging, timeout, and header shape match the other pg_cron HTTP jobs
-- (see `sync-mit-registry-weekly`). The 300000 ms timeout matches the route's
-- `maxDuration = 300`. The body carries only `triggered_by` and `run_at`, both
-- inside the route's allow-list -- the mismatch that silently 400'd the retired
-- `link-health-daily` job for seven weeks
-- (20260807120000_cron_http_dispatch_capture.sql).
--
-- 21:30 UTC (05:30 Asia/Taipei) lands after the health agent's nightly
-- link-health check, so the cleanup acts on the freshly flagged rows.

begin;

do $$ begin
  perform cron.unschedule('link-cleanup-daily');
exception when others then
  null;
end $$;

select cron.schedule(
  'link-cleanup-daily',
  '30 21 * * *',
  $job$
  insert into public.cron_http_dispatch (request_id, job_name)
  values (
    (select net.http_post(
       url := (select value from public.app_secrets where key = 'cron_base_url')
         || '/api/cron/link-cleanup',
       headers := jsonb_build_object(
         'x-origin-verify', (select value from public.app_secrets where key = 'origin_secret'),
         'Content-Type', 'application/json'
       ),
       body := jsonb_build_object('triggered_by', 'pg_cron', 'run_at', now()::text),
       timeout_milliseconds := 300000
     )),
    'link-cleanup-daily'
  );
  $job$
);

commit;
