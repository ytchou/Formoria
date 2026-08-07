-- DEV-1378 -- un-defer the classifier-image retention reaper and close its two gates.
--
-- Was supabase/deferred/20260801140000_schedule_classifier_retention_cron.sql,
-- held outside supabase/migrations/ because scheduling it starts irreversible
-- storage deletion. Both holding conditions are now resolved; the evidence is
-- recorded here rather than in the ticket, because this file is what a future
-- reader finds.
--
-- GATE 1 -- CLOSED. DEV-1279 (Done 2026-08-03) settled it explicitly:
-- "Deletion: decouple from rejection -- mark rejected and let the 7-day reaper
-- sweep, so a misfire under stricter gates is recoverable." Rejection no longer
-- deletes storage inline; this reaper is the single deletion path, and
-- RETENTION_MS (7 days, src/lib/services/image-retention.ts) is the recovery
-- window that decision depends on. Without this schedule that decision is only
-- half-implemented: images are marked and nothing ever sweeps them.
--
-- GATE 2 -- CLOSED, and smaller than it looked. The header this file replaces
-- cited ~1123 rejected rows with `rejected_at IS NULL` that the reaper can never
-- see. Re-counted live 2026-08-08, those rows split three ways:
--
--   * brand_images: 1744 such rows, ALL with storage_path IS NULL. There is no
--     storage behind them -- nothing to sweep, nothing accruing. The population
--     the original note worried about is already storage-free.
--   * submission_images, 209 rows: `tags IS NULL AND rejection_reasons IS NULL`.
--     These are NOT orphans -- they are exactly the pass (d) recovery candidates
--     of scripts/repair-brand-images.ts, images the classifier rejected without
--     ever producing a verdict (a failed OpenAI call read as junk). That script
--     keys recovery on `rejected_at IS NULL`, so stamping them would silently
--     destroy the recovery path. LEFT ALONE, DELIBERATELY -- see below.
--   * submission_images, 213 rows: a real verdict (tags and/or
--     rejection_reasons set) but no rejected_at, because the 20260731174639
--     backfill only stamped rows whose tags intersect
--     {promo, text_banner, irrelevant}. These are the true orphans: judged junk,
--     holding storage, invisible to the reaper forever. Section 1 sweeps them.
--
-- Verified before enabling (2026-08-08): zero storage_path values are shared
-- between a rejected row and a non-rejected row, across both tables. The reaper
-- deletes by path with no such guard, so a shared path would take a live image
-- down with a rejected one. It holds today; it is a property of how paths are
-- minted, not an invariant this schema enforces.
--
-- Blast radius of turning this on: 47 brand_images and 472 submission_images
-- objects become eligible over the next several days (rejected 2026-08-01 and
-- 2026-08-03..06 respectively), plus the 213 stamped below seven days from now.
-- Every one is a classifier-rejected image past its inspection window -- that is
-- the retention policy working, not an incident.
--
-- Blocked on DEV-1377 (Done, PR #641): this job's URL comes from
-- app_secrets.cron_base_url (the Railway origin), not the Cloudflare-fronted
-- public host, which overwrites the x-origin-verify header these routes
-- authenticate with. It captures its pg_net request id into
-- public.cron_http_dispatch and sets an explicit timeout, so the run is
-- observable at all: a green scheduler is not a green job --
-- cron.job_run_details reports the enqueue, not the outcome. Prerequisites, both
-- already applied: 20260807120000 (cron_base_url + cron_http_dispatch) and
-- 20260807120100 (cron_http_log + snapshot job). scripts/health-agent/
-- cron-health.ts adds this job to EXPECTED_CRON_JOBS in the same change, so a
-- silently unscheduled reaper is a finding rather than a shrug.
--
-- ROLLBACK: SELECT cron.unschedule('classifier-image-retention-6h'). The
-- section 1 stamp is not reversible after the reaper runs against it, but is
-- harmless to leave in place if the schedule is dropped -- nothing else reads
-- rejected_at on a rejected row.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Stamp the orphaned rejects the 20260731174639 backfill missed.
-- ---------------------------------------------------------------------------
-- now(), not the row's created_at: this hands them the same seven-day window
-- every other reject gets, instead of deleting rows on the reaper's first run
-- that nobody has had a chance to look at. Backdating would make section 2's
-- first execution the largest deletion this job ever performs, which is the
-- opposite of how a never-run deletion job should be introduced.
--
-- The `tags IS NOT NULL OR rejection_reasons IS NOT NULL` predicate is the whole
-- point -- it is what excludes the 209 null-verdict rows that
-- scripts/repair-brand-images.ts pass (d) can still recover. Do not relax it to
-- "everything rejected without a rejected_at"; that reads as a tidier sweep and
-- quietly makes those images unrecoverable.
--
-- brand_images matches zero rows today (every such row already has
-- storage_path IS NULL). Included anyway so both tables carry the same rule.
UPDATE public.brand_images
   SET rejected_at = now()
 WHERE status = 'rejected'
   AND rejected_at IS NULL
   AND storage_path IS NOT NULL
   AND (tags IS NOT NULL OR rejection_reasons IS NOT NULL);

UPDATE public.submission_images
   SET rejected_at = now()
 WHERE status = 'rejected'
   AND rejected_at IS NULL
   AND storage_path IS NOT NULL
   AND (tags IS NOT NULL OR rejection_reasons IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 2. Schedule the reaper.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  PERFORM cron.unschedule('classifier-image-retention-6h');
EXCEPTION WHEN others THEN
  NULL;
END $$;

SELECT cron.schedule(
  'classifier-image-retention-6h',
  '17 */6 * * *',
  $job$
  -- timeout 300000ms = src/app/api/cron/purge-classifier-images/route.ts
  -- maxDuration 300. Without it net.http_post defaults to 5000ms and would
  -- record a pg_net timeout on every run of a route allowed to take 300s.
  INSERT INTO public.cron_http_dispatch (request_id, job_name)
  VALUES (
    (SELECT net.http_post(
       url := (SELECT value FROM public.app_secrets WHERE key = 'cron_base_url')
         || '/api/cron/purge-classifier-images',
       headers := jsonb_build_object(
         'x-origin-verify', (SELECT value FROM public.app_secrets WHERE key = 'origin_secret'),
         'Content-Type', 'application/json'
       ),
       body := jsonb_build_object('triggered_by', 'pg_cron', 'run_at', now()::text),
       timeout_milliseconds := 300000
     )),
    'classifier-image-retention-6h'
  );
  $job$
);

COMMIT;
