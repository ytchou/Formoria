CREATE OR REPLACE FUNCTION reconcile_health_fix_lifecycle(
  p_observed_fingerprints text[]
)
RETURNS TABLE (id uuid, fingerprint text, reconciliation text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_observed_fingerprints IS NULL THEN
    RAISE EXCEPTION 'observed fingerprints are required';
  END IF;

  RETURN QUERY
  UPDATE public.health_fix_queue AS queue
  SET status = 'fixed',
      fixed_at = now(),
      lease_owner = NULL,
      lease_expires_at = NULL,
      next_attempt_at = NULL,
      confirmation_data = COALESCE(queue.confirmation_data, '{}'::jsonb) ||
        jsonb_build_object(
          'verification', 'detector_absence',
          'verified_at', now()
        ),
      updated_at = now()
  WHERE queue.status IN (
    'pending',
    'claimed',
    'pr_opened',
    'awaiting_human',
    'merged',
    'deployed',
    'failed',
    'needs_human'
  )
    AND queue.fingerprint NOT LIKE 'directory:canary:%'
    AND queue.fingerprint NOT LIKE 'directory:stale-branch:%'
    AND NOT (queue.fingerprint = ANY (p_observed_fingerprints))
  RETURNING queue.id, queue.fingerprint, 'fixed'::text;

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
  WHERE queue.status = 'deployed'
    AND queue.fingerprint = ANY (p_observed_fingerprints)
  RETURNING queue.id, queue.fingerprint, 'failed_verification'::text;
END;
$$;

REVOKE ALL ON FUNCTION reconcile_health_fix_lifecycle(text[]) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'health_agent_writer') THEN
    GRANT EXECUTE ON FUNCTION reconcile_health_fix_lifecycle(text[])
      TO health_agent_writer;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION reconcile_health_fix_lifecycle(text[])
      TO service_role;
  END IF;
END;
$$;
