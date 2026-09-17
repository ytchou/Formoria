-- DEV-1748 -- remove the source allow-list from reconcile_health_fix_lifecycle.
--
-- WHY: the new health agent declares its detector→source mapping in code
-- (src/lib/constants/health-detectors.ts). Sources like 'pipeline',
-- 'credential', 'surface', 'links-weekly', 'search', 'backlog', and 'agent'
-- will appear in `p_completed_sources` once the new detectors ship. The
-- existing allow-list ('link', 'directory', 'sentry', 'quality', 'cron')
-- would RAISE on every nightly run the moment any new source arrives —
-- exactly the same bug DEV-1377 fixed for 'cron'.
--
-- Rather than expanding the allow-list one source at a time, the guard is
-- removed entirely: the TypeScript detector registry is the single source of
-- truth, and the RPC should not duplicate it.
--
-- The body is copied verbatim from
-- 20260807120200_reconcile_health_fix_lifecycle_allow_cron.sql lines 25-149,
-- with the `IF EXISTS … NOT IN … RAISE EXCEPTION` block (lines 44-49)
-- removed. Same signature, SECURITY DEFINER, SET search_path.
--
-- CREATE OR REPLACE, deliberately NOT DROP + CREATE: dropping a public
-- function makes Supabase re-apply default privileges to anon/authenticated.
-- Replacing in place preserves existing ACL.
--
-- ROLLBACK: re-apply the allow_cron migration's body via CREATE OR REPLACE.

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

-- Re-state grants from 20260729100000_retire_health_confirmation_workflow.sql
-- lines 319-327.
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
