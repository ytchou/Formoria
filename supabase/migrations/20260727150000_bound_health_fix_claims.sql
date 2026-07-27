DROP FUNCTION IF EXISTS public.claim_health_fixes(text, text, interval);

CREATE FUNCTION public.claim_health_fixes(
  p_merge_policy text,
  p_lease_owner text,
  p_fingerprints text[],
  p_lease_duration interval DEFAULT interval '30 minutes'
)
RETURNS SETOF public.health_fix_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_merge_policy IS NULL OR p_merge_policy NOT IN ('automatic', 'human') THEN
    RAISE EXCEPTION 'invalid merge policy: %', p_merge_policy;
  END IF;

  IF p_lease_owner IS NULL
    OR btrim(p_lease_owner) = ''
    OR p_lease_duration IS NULL
    OR p_lease_duration <= interval '0 seconds'
  THEN
    RAISE EXCEPTION 'lease owner and duration must be valid';
  END IF;

  IF p_fingerprints IS NULL OR cardinality(p_fingerprints) = 0 THEN
    RAISE EXCEPTION 'at least one fingerprint is required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(p_fingerprints) AS requested(fingerprint)
    WHERE requested.fingerprint IS NULL OR btrim(requested.fingerprint) = ''
  ) THEN
    RAISE EXCEPTION 'fingerprints must be non-empty';
  END IF;

  UPDATE public.health_fix_queue AS queue
  SET status = 'needs_human',
      lease_owner = NULL,
      lease_expires_at = NULL,
      last_error = COALESCE(
        queue.last_error,
        'Lease expired after the final automation attempt'
      )
  WHERE queue.merge_policy = p_merge_policy
    AND queue.fingerprint = ANY (p_fingerprints)
    AND queue.status = 'claimed'
    AND queue.lease_expires_at <= now()
    AND queue.attempt_count >= 2;

  RETURN QUERY
  WITH eligible AS (
    SELECT queue.id
    FROM public.health_fix_queue AS queue
    WHERE queue.merge_policy = p_merge_policy
      AND queue.fingerprint = ANY (p_fingerprints)
      AND queue.attempt_count < 2
      AND (
        queue.status = 'pending'
        OR (
          queue.status = 'failed'
          AND COALESCE(queue.next_attempt_at, now()) <= now()
        )
        OR (
          queue.status = 'claimed'
          AND queue.lease_expires_at <= now()
        )
      )
    ORDER BY queue.created_at, queue.id
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.health_fix_queue AS queue
  SET status = 'claimed',
      lease_owner = p_lease_owner,
      lease_expires_at = now() + p_lease_duration,
      attempt_count = queue.attempt_count + 1,
      attempted_at = now(),
      next_attempt_at = NULL,
      updated_at = now()
  FROM eligible
  WHERE queue.id = eligible.id
  RETURNING queue.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_health_fixes(text, text, text[], interval)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_health_fixes(text, text, text[], interval)
  TO health_agent_writer;
GRANT EXECUTE ON FUNCTION public.claim_health_fixes(text, text, text[], interval)
  TO service_role;
