-- DEV-1570: the claim-proof cleanup HTTP endpoint was removed with the claim
-- flow. The job would otherwise 404 on every run. The table
-- claim_proof_cleanup_jobs and every other claim object are deliberately kept.

-- Safely unschedule: tolerate the job not
-- existing (e.g. fresh DB).
DO $$ BEGIN
  PERFORM cron.unschedule('claim-proof-cleanup-hourly');
EXCEPTION WHEN others THEN
  NULL;
END $$;
