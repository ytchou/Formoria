-- DEV-1763 -- Sentry is signal-only in the health ledger.
--
-- A complete unresolved-issue snapshot is now the source of truth. An active
-- Sentry row absent from that snapshot is fixed locally, just like every other
-- completed source. The health-agent no longer writes resolution state back to
-- Sentry. Re-observing the fingerprint inserts a new active row because fixed
-- history is outside the partial unique index, making the issue returned.
--
-- CREATE OR REPLACE preserves the existing function identity and ACL. The
-- signature and explicit grants remain unchanged.

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
    AND queue.fingerprint NOT LIKE 'directory:canary:%'
    AND queue.fingerprint NOT LIKE 'directory:stale-branch:%'
    AND NOT (queue.fingerprint = ANY (p_observed_fingerprints))
  RETURNING
    queue.id,
    queue.fingerprint,
    'fixed'::text,
    queue.sentry_issue_id,
    queue.status;

  -- Dormant after the confirmation workflow was retired: nothing sets
  -- deployed_at any more. Kept to preserve the existing RPC contract if deploy
  -- evidence is restored later.
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

REVOKE ALL ON FUNCTION public.reconcile_health_fix_lifecycle(text[], text[])
  FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.reconcile_health_fix_lifecycle(text[], text[])
      TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'health_agent_writer') THEN
    GRANT EXECUTE ON FUNCTION public.reconcile_health_fix_lifecycle(text[], text[])
      TO health_agent_writer;
  END IF;
END;
$$;
