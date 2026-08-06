-- Retention for the append-only audit tables (DEV-1346).
--
-- `external_call_audit` is fed by 151 `auditedCall(` sites and nothing ever
-- deleted from it; `admin_audit_log` has carried a "purge entries older than 90
-- days" TODO since 20260630100000. Both purges run just before the 20:00 UTC
-- nightly VACUUM (ANALYZE) so the freed space is reclaimed in the same window.
--
-- Scheduling follows the existing idempotent pattern: unschedule (ignoring the
-- error when the job does not exist yet) then schedule.

DO $$ BEGIN
  PERFORM cron.unschedule('purge-external-call-audit');
EXCEPTION WHEN others THEN
  NULL;
END $$;

SELECT cron.schedule(
    'purge-external-call-audit',
    '15 19 * * *', -- 19:15 UTC = 03:15 Asia/Taipei
    $$DELETE FROM public.external_call_audit WHERE created_at < now() - interval '180 days'$$
);

DO $$ BEGIN
  PERFORM cron.unschedule('purge-admin-audit-log');
EXCEPTION WHEN others THEN
  NULL;
END $$;

SELECT cron.schedule(
    'purge-admin-audit-log',
    '25 19 * * *', -- 19:25 UTC = 03:25 Asia/Taipei
    $$DELETE FROM public.admin_audit_log WHERE created_at < now() - interval '90 days'$$
);

-- The original comment asserted rows are never deleted. Retention now deletes
-- them; append-only still holds for the lifetime of a row (never updated).
comment on table public.external_call_audit is
  'Append-only audit trail for external and internal service calls: two rows per span (one `started`, one terminal). Rows are never updated; they are deleted only by the `purge-external-call-audit` pg_cron job after 180 days. `causation_id` and `subject_id` are deliberately plain uuid columns and NOT foreign keys — `span_id` is non-unique so `causation_id` cannot reference it, and the audit trail must outlive (and never cascade with) the subjects it describes.';
