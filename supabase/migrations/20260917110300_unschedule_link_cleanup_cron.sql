-- DEV-1748 -- unschedule the pg_cron link-cleanup-daily job.
--
-- WHY: the new health agent subsumes link cleanup into its own detector
-- pipeline (link-cleanup detector). The pg_cron job that dispatches
-- POST /api/cron/link-cleanup is no longer needed. The API route and the
-- old scripts/health-agent/ orchestrator are kept for now (additive PR);
-- this migration only removes the scheduled trigger.
--
-- Guard pattern from 20260807120000_cron_http_dispatch_capture.sql line 46.
--
-- ROLLBACK: re-apply 20260902120000_schedule_link_cleanup_cron.sql.

DO $$ BEGIN
  PERFORM cron.unschedule('link-cleanup-daily');
EXCEPTION WHEN others THEN
  NULL;
END $$;
