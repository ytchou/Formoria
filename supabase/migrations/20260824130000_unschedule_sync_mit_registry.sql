-- DEV-1586: the MIT registry sync HTTP endpoint was removed with the dormant
-- feature parking program. The job would otherwise 404 on every run. The table
-- mit_registry and its column values are deliberately kept.

-- Safely unschedule: tolerate the job not
-- existing (e.g. fresh DB).
DO $$ BEGIN
  PERFORM cron.unschedule('sync-mit-registry-weekly');
EXCEPTION WHEN others THEN
  NULL;
END $$;
