-- DEV-1377 -- allow 'cron' as a completed source in reconcile_health_fix_lifecycle.
--
-- WHY: the health agent now runs a cron collector and reports 'cron' in its
-- completed-source list. The existing allow-list is ('link', 'directory',
-- 'sentry', 'quality'), so the RPC RAISEs on every nightly run the moment 'cron'
-- appears. The caller catches that exception and degrades to
-- `fingerprint_absence_reconciliation:failed`, which means NOTHING gets marked
-- fixed or regressed again -- for ALL sources, not just cron. Worse, it only
-- fires when the cron collector completed successfully, so the lifecycle stops
-- working precisely when cron health is GREEN.
--
-- CREATE OR REPLACE, deliberately NOT DROP + CREATE: dropping a public function
-- makes Supabase re-apply default privileges to anon/authenticated, and
-- revoking from `public` does not undo that. Replacing in place preserves the
-- existing ACL (service_role + health_agent_writer EXECUTE only), so no grant
-- statements are needed or wanted here.
--
-- The body below is copied verbatim from
-- 20260729100000_retire_health_confirmation_workflow.sql. The ONLY change is
-- adding 'cron' to the allow-list on the source-validation guard.
--
-- ROLLBACK: re-apply that migration's CREATE FUNCTION body (allow-list without
-- 'cron') via CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.reconcile_health_fix_lifecycle(
  p_observed_fingerprints text[],
  p_completed_sources text[]
)
RETURNS TABLE (
  id uuid,
  fingerprint text,
  reconciliation text,
  sentry_issue_id text,
  current_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_observed_fingerprints IS NULL OR p_completed_sources IS NULL THEN
    RAISE EXCEPTION 'observed fingerprints and completed sources are required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_completed_sources) AS source_name
    WHERE source_name NOT IN ('link', 'directory', 'sentry', 'quality', 'cron')
  ) THEN
    RAISE EXCEPTION 'completed sources contain an unsupported source';
  END IF;

  RETURN QUERY
  UPDATE public.health_fix_queue AS queue
  SET status = 'fixed',
      fixed_at = now(),
      lease_owner = NULL,
      lease_expires_at = NULL,
      next_attempt_at = NULL,
      confirmation_data = COALESCE(queue.confirmation_data, '{}'::jsonb) ||
        jsonb_build_object('verification', 'detector_absence', 'verified_at', now()),
      updated_at = now()
  WHERE queue.source = ANY (p_completed_sources)
    AND queue.status IN (
      'pending', 'claimed', 'pr_opened', 'awaiting_human', 'merged',
      'deployed', 'failed', 'needs_human'
    )
    AND queue.source <> 'sentry'
    AND queue.fingerprint NOT LIKE 'directory:canary:%'
    AND queue.fingerprint NOT LIKE 'directory:stale-branch:%'
    AND NOT (queue.fingerprint = ANY (p_observed_fingerprints))
  RETURNING
    queue.id,
    queue.fingerprint,
    'fixed'::text,
    queue.sentry_issue_id,
    queue.status;

  RETURN QUERY
  SELECT
    queue.id,
    queue.fingerprint,
    'verified_sentry_absence'::text,
    queue.sentry_issue_id,
    queue.status
  FROM public.health_fix_queue AS queue
  WHERE queue.source = 'sentry'
    AND 'sentry' = ANY (p_completed_sources)
    AND queue.status IN (
      'pending', 'claimed', 'pr_opened', 'awaiting_human', 'merged',
      'deployed', 'failed', 'needs_human'
    )
    AND queue.sentry_issue_id IS NOT NULL
    AND NOT (queue.fingerprint = ANY (p_observed_fingerprints));

  -- Dormant after the confirmation workflow was retired: nothing sets
  -- deployed_at any more, so this branch can no longer match. Kept so the
  -- regression signal returns for free if deploy evidence is ever restored.
  RETURN QUERY
  UPDATE public.health_fix_queue AS queue
  SET status = 'needs_human',
      lease_owner = NULL,
      lease_expires_at = NULL,
      next_attempt_at = NULL,
      last_error = 'post_deployment_recurrence',
      confirmation_data = COALESCE(queue.confirmation_data, '{}'::jsonb) ||
        jsonb_build_object(
          'verification', 'newer_sentry_event_after_deployment',
          'verified_at', now()
        ),
      updated_at = now()
  WHERE queue.source = 'sentry'
    AND 'sentry' = ANY (p_completed_sources)
    AND queue.status = 'deployed'
    AND queue.fingerprint = ANY (p_observed_fingerprints)
    AND queue.deployed_at IS NOT NULL
    AND (queue.evidence #>> '{recurrence,lastSeen}') ~
      '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}'
    AND (queue.evidence #>> '{recurrence,lastSeen}')::timestamptz > queue.deployed_at
  RETURNING
    queue.id,
    queue.fingerprint,
    'regressed'::text,
    queue.sentry_issue_id,
    queue.status;

  RETURN QUERY
  UPDATE public.health_fix_queue AS queue
  SET status = 'needs_human',
      lease_owner = NULL,
      lease_expires_at = NULL,
      next_attempt_at = NULL,
      last_error = 'detector_verification_failed',
      confirmation_data = COALESCE(queue.confirmation_data, '{}'::jsonb) ||
        jsonb_build_object(
          'verification', 'detector_presence_after_deployment',
          'verified_at', now()
        ),
      updated_at = now()
  WHERE queue.source <> 'sentry'
    AND queue.source = ANY (p_completed_sources)
    AND queue.status = 'deployed'
    AND queue.fingerprint = ANY (p_observed_fingerprints)
  RETURNING
    queue.id,
    queue.fingerprint,
    'failed_verification'::text,
    queue.sentry_issue_id,
    queue.status;
END;
$$;
