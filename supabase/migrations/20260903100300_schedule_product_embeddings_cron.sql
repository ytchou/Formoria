-- DEV-1680 -- schedule the nightly product embeddings refresh as a pg_cron HTTP job.
--
-- Mirrors `20260902120000_schedule_link_cleanup_cron.sql`: same dispatch shape,
-- same idempotent unschedule, same header and body pattern.
--
-- APPLYING THIS ON PRODUCTION: Railway runs no migrations against production,
-- so this file is applied BY HAND after the staging -> main promotion. Its three
-- dependencies -- `public.cron_http_dispatch`, `app_secrets.cron_base_url`, and
-- `app_secrets.origin_secret` -- were verified present on production on
-- 2026-09-02, so no bootstrap is needed; run this file as-is.
--
-- Dispatch logging, timeout, and header shape match the other pg_cron HTTP jobs
-- (see `sync-mit-registry-weekly`, `link-cleanup-daily`). The 300000 ms timeout
-- matches the route's `maxDuration = 300`. The body carries only `triggered_by`
-- and `run_at`, both inside the route's allow-list.
--
-- 21:45 UTC (05:45 Asia/Taipei) lands 15 minutes after link-cleanup-daily,
-- so the two nightly jobs do not overlap.

begin;

do $$ begin
  perform cron.unschedule('product-embeddings-nightly');
exception when others then
  null;
end $$;

select cron.schedule(
  'product-embeddings-nightly',
  '45 21 * * *',
  $job$
  insert into public.cron_http_dispatch (request_id, job_name)
  values (
    (select net.http_post(
       url := (select value from public.app_secrets where key = 'cron_base_url')
         || '/api/cron/product-embeddings',
       headers := jsonb_build_object(
         'x-origin-verify', (select value from public.app_secrets where key = 'origin_secret'),
         'Content-Type', 'application/json'
       ),
       body := jsonb_build_object('triggered_by', 'pg_cron', 'run_at', now()::text),
       timeout_milliseconds := 300000
     )),
    'product-embeddings-nightly'
  );
  $job$
);

commit;
