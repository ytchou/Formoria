WITH ranked_link_rows AS (
  SELECT id,
    row_number() OVER (
      PARTITION BY regexp_replace(fingerprint, '^(?:directory|link):link-cleanup:', '')
      ORDER BY (source = 'link') DESC, updated_at DESC, id DESC
    ) AS occurrence
  FROM public.health_fix_queue
  WHERE fingerprint LIKE 'directory:link-cleanup:%'
     OR fingerprint LIKE 'link:link-cleanup:%'
)
UPDATE public.health_fix_queue AS queue
SET status = 'skipped',
    last_error = 'superseded_by_canonical_link_owner',
    updated_at = now()
FROM ranked_link_rows
WHERE queue.id = ranked_link_rows.id
  AND ranked_link_rows.occurrence > 1
  AND queue.status <> 'skipped';

UPDATE public.health_fix_queue
SET source = 'link',
    fingerprint = regexp_replace(
      fingerprint,
      '^directory:link-cleanup:',
      'link:link-cleanup:'
    ),
    updated_at = now()
WHERE fingerprint LIKE 'directory:link-cleanup:%'
  AND status <> 'skipped';

UPDATE public.health_fix_queue
SET status = 'skipped',
    last_error = 'legacy_dead_tuple_threshold_false_positive',
    updated_at = now()
WHERE fingerprint LIKE 'directory:dead-tuples:%'
  AND status IN (
    'pending', 'claimed', 'pr_opened', 'awaiting_human', 'merged',
    'deployed', 'failed', 'needs_human'
  )
  AND (
    evidence #> '{deadTuples}' IS NULL
    OR evidence #> '{autovacuumThresholds}' IS NULL
  );

UPDATE public.health_fix_queue
SET status = 'skipped',
    last_error = 'legacy_sentry_row_missing_provider_id',
    updated_at = now()
WHERE source = 'sentry'
  AND sentry_issue_id IS NULL
  AND status IN (
    'pending', 'claimed', 'pr_opened', 'awaiting_human', 'merged',
    'deployed', 'failed', 'needs_human'
  );

DROP FUNCTION IF EXISTS public.reconcile_health_fix_lifecycle(text[]);

CREATE FUNCTION public.reconcile_health_fix_lifecycle(
  p_observed_fingerprints text[],
  p_completed_sources text[]
)
RETURNS TABLE (
  id uuid,
  fingerprint text,
  reconciliation text,
  sentry_issue_id text
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
  RETURNING queue.id, queue.fingerprint, 'fixed'::text, queue.sentry_issue_id;

  RETURN QUERY
  SELECT
    queue.id,
    queue.fingerprint,
    'verified_sentry_absence'::text,
    queue.sentry_issue_id
  FROM public.health_fix_queue AS queue
  WHERE queue.source = 'sentry'
    AND 'sentry' = ANY (p_completed_sources)
    AND queue.status = 'deployed'
    AND queue.sentry_issue_id IS NOT NULL
    AND NOT (queue.fingerprint = ANY (p_observed_fingerprints));

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
  RETURNING queue.id, queue.fingerprint, 'regressed'::text, queue.sentry_issue_id;

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
    queue.sentry_issue_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.read_health_directory_database_evidence()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog, pg_temp
AS $$
  SELECT jsonb_build_object(
    'connections', jsonb_build_object(
      'total', (SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE datname = current_database()),
      'maximum', (SELECT setting::integer FROM pg_catalog.pg_settings WHERE name = 'max_connections')
    ),
    'activeQueries', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'queryId', md5(COALESCE(query, '') || ':' || pid::text),
        'durationSeconds', EXTRACT(EPOCH FROM (clock_timestamp() - query_start))
      ) ORDER BY pid)
      FROM pg_catalog.pg_stat_activity
      WHERE datname = current_database() AND state = 'active' AND pid <> pg_backend_pid()
    ), '[]'::jsonb),
    'deadTupleSnapshots', jsonb_build_array(jsonb_build_object(
      'snapshotDate', current_date,
      'tables', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'tableName', stats.relname,
          'liveTuples', stats.n_live_tup,
          'deadTuples', stats.n_dead_tup,
          'autovacuumThreshold', COALESCE(
            (SELECT split_part(option, '=', 2)::numeric FROM unnest(classes.reloptions) AS option WHERE option LIKE 'autovacuum_vacuum_threshold=%'),
            current_setting('autovacuum_vacuum_threshold')::numeric
          ) + COALESCE(
            (SELECT split_part(option, '=', 2)::numeric FROM unnest(classes.reloptions) AS option WHERE option LIKE 'autovacuum_vacuum_scale_factor=%'),
            current_setting('autovacuum_vacuum_scale_factor')::numeric
          ) * stats.n_live_tup,
          'deadTuplePercent', CASE
            WHEN stats.n_live_tup + stats.n_dead_tup > 0
              THEN 100.0 * stats.n_dead_tup / (stats.n_live_tup + stats.n_dead_tup)
            ELSE 0
          END
        ) ORDER BY stats.relname)
        FROM pg_catalog.pg_stat_user_tables AS stats
        JOIN pg_catalog.pg_class AS classes ON classes.oid = stats.relid
        WHERE stats.schemaname = 'public'
      ), '[]'::jsonb)
    )),
    'indexConcerns', '[]'::jsonb
  );
$$;

DO $$
DECLARE
  routine record;
BEGIN
  FOR routine IN
    SELECT namespace.nspname,
      procedure.proname,
      pg_get_function_identity_arguments(procedure.oid) AS arguments
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname IN (
        'claim_health_agent_run', 'claim_health_fixes',
        'complete_health_agent_run', 'enqueue_health_fix',
        'fail_health_agent_run', 'read_health_directory_database_evidence',
        'record_health_snapshot', 'record_link_health_result',
        'reconcile_health_fix_lifecycle', 'transition_health_fix'
      )
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated',
      routine.nspname, routine.proname, routine.arguments
    );
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION %I.%I(%s) TO service_role',
        routine.nspname, routine.proname, routine.arguments
      );
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'health_agent_writer') THEN
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION %I.%I(%s) TO health_agent_writer',
        routine.nspname, routine.proname, routine.arguments
      );
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'health_agent_reader') THEN
    GRANT EXECUTE ON FUNCTION public.read_health_directory_database_evidence()
      TO health_agent_reader;
  END IF;
END;
$$;
