-- Standardize the pg_cron maintenance window.
--
-- WHY: the daily jobs were scattered (03:15, 03:25, and 11:40 Taipei) and two
-- jobs ran far more often than their own retention windows justify.
-- `claim-proof-cleanup-hourly` fired 24 HTTP round-trips a day against an empty
-- queue -- `claim_requests` holds 2 rows total and
-- `claim_proof_cleanup_jobs` is empty -- and
-- `classifier-image-retention-6h` swept 4x a day for images it only deletes
-- after a 7-day window.
--
-- Everything now lands in 03:05-03:45 Asia/Taipei (19:05-19:45 UTC), ahead of
-- the 04:05 Taipei GitHub Actions cluster, so the health agent's 04:50 cron
-- check reads fresh results from every job.
--
-- DELIBERATELY UNCHANGED:
--   * `cron-http-snapshot` (*/15) -- it must run well inside pg_net's 6h TTL or
--     HTTP outcomes are pruned before they are ever recorded. It is pure SQL
--     and costs nothing. Slowing it down is how the monitor goes blind.
--   * `sync-mit-registry-weekly` (Sun 02:00 UTC / 10:00 Taipei) -- ~29k rows
--     behind a 300s timeout. Kept clear of the 04:05-05:20 Taipei cluster so a
--     long sync cannot slow the production signup probe.
--
-- ALTER, NOT RESCHEDULE: `cron.alter_job` changes only the schedule.
-- `cron.unschedule` + `cron.schedule` would require restating each job body
-- here, and the two HTTP jobs wrap their `net.http_post` inside an INSERT into
-- `public.cron_http_dispatch` (DEV-1377). Restating that by hand is how the
-- dispatch capture silently gets dropped.
--
-- PAIRED CODE CHANGE: `scripts/health-agent/cron-health.ts` encodes a staleness
-- budget per job, tuned to the OLD cadence (claim-proof 3h, classifier 18h).
-- Both move to 25h in the same PR. Applying this migration without that change
-- makes the health agent file a stale-cron finding every single morning.
--
-- NAMES ARE NOW STALE, AND THAT IS DELIBERATE: `claim-proof-cleanup-hourly` is
-- daily and `classifier-image-retention-6h` is daily. Renaming a pg_cron job
-- means dropping and recreating it -- reintroducing exactly the body-drift risk
-- this migration avoids -- and both names are referenced by
-- EXPECTED_CRON_JOBS in cron-health.ts. Left as-is on purpose.
--
-- ROLLBACK: re-run cron.alter_job with the previous schedules --
--   claim-proof-cleanup-hourly     '17 * * * *'
--   classifier-image-retention-6h  '17 */6 * * *'
--   purge-external-call-audit      '15 19 * * *'
--   purge-admin-audit-log          '25 19 * * *'
--   cron-http-retention            '40 3 * * *'
-- and revert the cron-health.ts budgets.

BEGIN;

DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT *
    FROM (
      VALUES
        -- 03:05 Taipei. Was hourly at :17.
        ('claim-proof-cleanup-hourly', '5 19 * * *'),
        -- 03:15 Taipei. Was 4x daily at :17.
        ('classifier-image-retention-6h', '15 19 * * *'),
        -- 03:25 Taipei. Was 03:15.
        ('purge-external-call-audit', '25 19 * * *'),
        -- 03:35 Taipei. Was 03:25.
        ('purge-admin-audit-log', '35 19 * * *'),
        -- 03:45 Taipei. Was 11:40 -- the only daily job outside the window.
        ('cron-http-retention', '45 19 * * *')
    ) AS t(job_name, new_schedule)
  LOOP
    -- Fail loudly on a missing job rather than silently skipping it. A job that
    -- is not there is a drifted ledger, not a no-op.
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = target.job_name) THEN
      RAISE EXCEPTION 'pg_cron job % not found; refusing to continue', target.job_name;
    END IF;

    PERFORM cron.alter_job(
      job_id := (SELECT jobid FROM cron.job WHERE jobname = target.job_name),
      schedule := target.new_schedule
    );
  END LOOP;
END $$;

COMMIT;
