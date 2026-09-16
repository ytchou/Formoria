-- DEV-1744 -- schedule the daily submissions/ -> brands/ image promotion sweep
-- as a pg_cron HTTP job.
--
-- Mirrors `20260903100300_schedule_product_embeddings_cron.sql` (itself the
-- current shape of `sync-mit-registry-weekly`): same dispatch shape, same
-- idempotent unschedule, same header and body pattern.
--
-- WHY: `promoteApprovedBrandImages` runs at the approval boundary and is
-- deliberately allowed to fail without failing the approval, so a failed hook
-- leaves an approved brand with unservable `submissions/`-keyed imagery. This
-- job bounds that exposure to 24 hours. It is also the precondition for the
-- `brand-images` bucket flip (DEV-1744 task 3): residue must be proven at zero
-- across consecutive runs before the bucket becomes public.
--
-- APPLYING THIS ON PRODUCTION: Railway runs no migrations against production,
-- so this file is applied BY HAND after the staging -> main promotion. Its
-- three dependencies -- `public.cron_http_dispatch`, `app_secrets.cron_base_url`,
-- and `app_secrets.origin_secret` -- are the same ones the link-cleanup and
-- product-embeddings jobs already use on production; run this file as-is.
--
-- The 300000 ms timeout matches the route's `maxDuration = 300`. The body
-- carries only `triggered_by` and `run_at`, both inside the route's allow-list
-- (the route rejects any other key, including `dry_run`).
--
-- 22:00 UTC (06:00 Asia/Taipei) lands 15 minutes after product-embeddings-nightly
-- and 20 minutes before link-health, so the nightly jobs do not overlap.

begin;

do $$ begin
  perform cron.unschedule('promote-submission-images-daily');
exception when others then
  null;
end $$;

select cron.schedule(
  'promote-submission-images-daily',
  '0 22 * * *',
  $job$
  insert into public.cron_http_dispatch (request_id, job_name)
  values (
    (select net.http_post(
       url := (select value from public.app_secrets where key = 'cron_base_url')
         || '/api/cron/promote-submission-images',
       headers := jsonb_build_object(
         'x-origin-verify', (select value from public.app_secrets where key = 'origin_secret'),
         'Content-Type', 'application/json'
       ),
       body := jsonb_build_object('triggered_by', 'pg_cron', 'run_at', now()::text),
       timeout_milliseconds := 300000
     )),
    'promote-submission-images-daily'
  );
  $job$
);

commit;
