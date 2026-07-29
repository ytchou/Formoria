-- Retire the health-agent confirmation workflow.
--
-- The confirmation workflow was the only writer driving health_fix_queue rows
-- through pr_opened|awaiting_human -> merged -> deployed. It existed solely so
-- reconcile_health_fix_lifecycle's Sentry branch (which required
-- status = 'deployed') could close Sentry rows. With the workflow deleted, that
-- branch must accept any active status, and the TS layer needs a narrow RPC to
-- flip a row to 'fixed' from whatever status it is actually in — the general
-- transition_health_fix graph only permits deployed -> fixed and is left alone
-- on purpose.
--
-- ROLLBACK: drop verify_health_fix_absence and re-apply the pre-change body
-- below (copied verbatim from 20260727130000_unify_health_lifecycle.sql:58).
--
--   DROP FUNCTION IF EXISTS public.reconcile_health_fix_lifecycle(text[], text[]);
--
--   CREATE FUNCTION public.reconcile_health_fix_lifecycle(
--     p_observed_fingerprints text[],
--     p_completed_sources text[]
--   )
--   RETURNS TABLE (
--     id uuid,
--     fingerprint text,
--     reconciliation text,
--     sentry_issue_id text
--   )
--   LANGUAGE plpgsql
--   SECURITY DEFINER
--   SET search_path = public, pg_temp
--   AS $$
--   BEGIN
--     IF p_observed_fingerprints IS NULL OR p_completed_sources IS NULL THEN
--       RAISE EXCEPTION 'observed fingerprints and completed sources are required';
--     END IF;
--     IF EXISTS (
--       SELECT 1 FROM unnest(p_completed_sources) AS source_name
--       WHERE source_name NOT IN ('link', 'directory', 'sentry', 'quality')
--     ) THEN
--       RAISE EXCEPTION 'completed sources contain an unsupported source';
--     END IF;
--
--     RETURN QUERY
--     UPDATE public.health_fix_queue AS queue
--     SET status = 'fixed',
--         fixed_at = now(),
--         lease_owner = NULL,
--         lease_expires_at = NULL,
--         next_attempt_at = NULL,
--         confirmation_data = COALESCE(queue.confirmation_data, '{}'::jsonb) ||
--           jsonb_build_object('verification', 'detector_absence', 'verified_at', now()),
--         updated_at = now()
--     WHERE queue.source = ANY (p_completed_sources)
--       AND queue.status IN (
--         'pending', 'claimed', 'pr_opened', 'awaiting_human', 'merged',
--         'deployed', 'failed', 'needs_human'
--       )
--       AND queue.source <> 'sentry'
--       AND queue.fingerprint NOT LIKE 'directory:canary:%'
--       AND queue.fingerprint NOT LIKE 'directory:stale-branch:%'
--       AND NOT (queue.fingerprint = ANY (p_observed_fingerprints))
--     RETURNING queue.id, queue.fingerprint, 'fixed'::text, queue.sentry_issue_id;
--
--     RETURN QUERY
--     SELECT
--       queue.id,
--       queue.fingerprint,
--       'verified_sentry_absence'::text,
--       queue.sentry_issue_id
--     FROM public.health_fix_queue AS queue
--     WHERE queue.source = 'sentry'
--       AND 'sentry' = ANY (p_completed_sources)
--       AND queue.status = 'deployed'
--       AND queue.sentry_issue_id IS NOT NULL
--       AND NOT (queue.fingerprint = ANY (p_observed_fingerprints));
--
--     RETURN QUERY
--     UPDATE public.health_fix_queue AS queue
--     SET status = 'needs_human',
--         lease_owner = NULL,
--         lease_expires_at = NULL,
--         next_attempt_at = NULL,
--         last_error = 'post_deployment_recurrence',
--         confirmation_data = COALESCE(queue.confirmation_data, '{}'::jsonb) ||
--           jsonb_build_object(
--             'verification', 'newer_sentry_event_after_deployment',
--             'verified_at', now()
--           ),
--         updated_at = now()
--     WHERE queue.source = 'sentry'
--       AND 'sentry' = ANY (p_completed_sources)
--       AND queue.status = 'deployed'
--       AND queue.fingerprint = ANY (p_observed_fingerprints)
--       AND queue.deployed_at IS NOT NULL
--       AND (queue.evidence #>> '{recurrence,lastSeen}') ~
--         '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}'
--       AND (queue.evidence #>> '{recurrence,lastSeen}')::timestamptz > queue.deployed_at
--     RETURNING queue.id, queue.fingerprint, 'regressed'::text, queue.sentry_issue_id;
--
--     RETURN QUERY
--     UPDATE public.health_fix_queue AS queue
--     SET status = 'needs_human',
--         lease_owner = NULL,
--         lease_expires_at = NULL,
--         next_attempt_at = NULL,
--         last_error = 'detector_verification_failed',
--         confirmation_data = COALESCE(queue.confirmation_data, '{}'::jsonb) ||
--           jsonb_build_object(
--             'verification', 'detector_presence_after_deployment',
--             'verified_at', now()
--           ),
--         updated_at = now()
--     WHERE queue.source <> 'sentry'
--       AND queue.source = ANY (p_completed_sources)
--       AND queue.status = 'deployed'
--       AND queue.fingerprint = ANY (p_observed_fingerprints)
--     RETURNING
--       queue.id,
--       queue.fingerprint,
--       'failed_verification'::text,
--       queue.sentry_issue_id;
--   END;
--   $$;

DROP FUNCTION IF EXISTS public.reconcile_health_fix_lifecycle(text[], text[]);

CREATE FUNCTION public.reconcile_health_fix_lifecycle(
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
    WHERE source_name NOT IN ('link', 'directory', 'sentry', 'quality')
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

-- Narrow replacement for the deployed -> fixed hop the confirmation workflow
-- used to make available. Deliberately purpose-built rather than widening the
-- transition_health_fix graph, which would permit unintended jumps everywhere.
CREATE OR REPLACE FUNCTION public.verify_health_fix_absence(
  p_id uuid,
  p_expected_status text
)
RETURNS public.health_fix_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.health_fix_queue%ROWTYPE;
BEGIN
  IF p_id IS NULL OR p_expected_status IS NULL THEN
    RAISE EXCEPTION 'health fix id and expected status are required';
  END IF;

  SELECT * INTO v_row
  FROM public.health_fix_queue
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid health fix absence: row % is missing', p_id;
  END IF;

  IF v_row.status = 'fixed' THEN
    RAISE EXCEPTION 'invalid health fix absence: row % is already fixed', p_id;
  END IF;

  IF v_row.status IS DISTINCT FROM p_expected_status THEN
    RAISE EXCEPTION 'invalid health fix absence: expected %, found %',
      p_expected_status,
      COALESCE(v_row.status, '<missing>');
  END IF;

  UPDATE public.health_fix_queue
  SET status = 'fixed',
      fixed_at = now(),
      lease_owner = NULL,
      lease_expires_at = NULL,
      next_attempt_at = NULL,
      confirmation_data = COALESCE(confirmation_data, '{}'::jsonb) ||
        jsonb_build_object(
          'verification', 'provider_resolved_after_detector_absence',
          'verified_at', now()
        ),
      updated_at = now()
  WHERE id = p_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_health_fix_absence(uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_health_fix_lifecycle(text[], text[])
  FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.verify_health_fix_absence(uuid, text)
      TO service_role;
    GRANT EXECUTE ON FUNCTION public.reconcile_health_fix_lifecycle(text[], text[])
      TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'health_agent_writer') THEN
    GRANT EXECUTE ON FUNCTION public.verify_health_fix_absence(uuid, text)
      TO health_agent_writer;
    GRANT EXECUTE ON FUNCTION public.reconcile_health_fix_lifecycle(text[], text[])
      TO health_agent_writer;
  END IF;
END;
$$;
