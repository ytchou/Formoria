ALTER TABLE public.health_fix_queue
  DROP CONSTRAINT IF EXISTS health_fix_queue_status_check;

ALTER TABLE public.health_fix_queue
  ADD COLUMN source text,
  ADD COLUMN fingerprint text,
  ADD COLUMN evidence jsonb,
  ADD COLUMN merge_policy text,
  ADD COLUMN lease_owner text,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN last_error text,
  ADD COLUMN next_attempt_at timestamptz,
  ADD COLUMN pr_number bigint,
  ADD COLUMN merge_sha text,
  ADD COLUMN deployed_at timestamptz,
  ADD COLUMN confirmation_data jsonb;

UPDATE public.health_fix_queue
SET
  source = 'sentry',
  fingerprint = 'sentry:' || sentry_issue_id,
  evidence = jsonb_strip_nulls(jsonb_build_object(
    'sentry_issue_id', sentry_issue_id,
    'key_frames', key_frames,
    'root_cause', seer_root_cause,
    'recommended_action', recommended_action
  )),
  merge_policy = 'human',
  attempt_count = CASE WHEN status = 'attempted' THEN 1 ELSE 0 END,
  next_attempt_at = CASE WHEN status = 'attempted' THEN now() ELSE NULL END,
  status = CASE WHEN status = 'attempted' THEN 'failed' ELSE status END;

WITH duplicate_active AS (
  SELECT id,
    row_number() OVER (
      PARTITION BY fingerprint
      ORDER BY updated_at DESC, id DESC
    ) AS occurrence
  FROM public.health_fix_queue
  WHERE status IN ('pending', 'pr_opened', 'failed')
)
UPDATE public.health_fix_queue AS queue
SET status = 'skipped',
    last_error = 'Superseded while backfilling the active fingerprint invariant'
FROM duplicate_active
WHERE queue.id = duplicate_active.id
  AND duplicate_active.occurrence > 1;

ALTER TABLE public.health_fix_queue
  ALTER COLUMN sentry_issue_id DROP NOT NULL,
  ALTER COLUMN source SET NOT NULL,
  ALTER COLUMN fingerprint SET NOT NULL,
  ALTER COLUMN evidence SET NOT NULL,
  ALTER COLUMN evidence SET DEFAULT '{}'::jsonb,
  ALTER COLUMN merge_policy SET NOT NULL,
  ALTER COLUMN merge_policy SET DEFAULT 'human',
  ADD CONSTRAINT health_fix_queue_source_nonempty
    CHECK (btrim(source) <> ''),
  ADD CONSTRAINT health_fix_queue_fingerprint_nonempty
    CHECK (btrim(fingerprint) <> ''),
  ADD CONSTRAINT health_fix_queue_evidence_object
    CHECK (jsonb_typeof(evidence) = 'object'),
  ADD CONSTRAINT health_fix_queue_merge_policy_check
    CHECK (merge_policy IN ('automatic', 'human')),
  ADD CONSTRAINT health_fix_queue_attempt_count_check
    CHECK (attempt_count BETWEEN 0 AND 2),
  ADD CONSTRAINT health_fix_queue_pr_number_check
    CHECK (pr_number IS NULL OR pr_number > 0),
  ADD CONSTRAINT health_fix_queue_merge_sha_check
    CHECK (merge_sha IS NULL OR btrim(merge_sha) <> ''),
  ADD CONSTRAINT health_fix_queue_status_check
    CHECK (status IN (
      'pending',
      'claimed',
      'pr_opened',
      'awaiting_human',
      'merged',
      'deployed',
      'fixed',
      'failed',
      'skipped',
      'needs_human'
    ));

DROP INDEX IF EXISTS health_fix_queue_active_issue_idx;

CREATE UNIQUE INDEX health_fix_queue_active_fingerprint_idx
  ON public.health_fix_queue (fingerprint)
  WHERE status IN (
    'pending',
    'claimed',
    'pr_opened',
    'awaiting_human',
    'merged',
    'deployed',
    'failed',
    'needs_human'
  );

CREATE INDEX health_fix_queue_claim_idx
  ON public.health_fix_queue (merge_policy, next_attempt_at, created_at)
  WHERE status IN ('pending', 'claimed', 'failed');

ALTER TABLE public.link_check_results
  ADD COLUMN failure_dates date[] NOT NULL DEFAULT '{}'::date[],
  ADD COLUMN distinct_failure_days integer NOT NULL DEFAULT 0,
  ADD COLUMN cleanup_required boolean NOT NULL DEFAULT false,
  ADD COLUMN cleanup_required_at timestamptz,
  ADD CONSTRAINT link_check_results_distinct_failure_days_check
    CHECK (distinct_failure_days >= 0),
  ADD CONSTRAINT link_check_results_failure_days_consistent
    CHECK (distinct_failure_days = cardinality(failure_dates));

CREATE TABLE public.health_agent_run_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  routine text NOT NULL CHECK (btrim(routine) <> ''),
  logical_date date NOT NULL,
  requested_run_id text NOT NULL CHECK (btrim(requested_run_id) <> ''),
  workflow_attempt integer NOT NULL CHECK (workflow_attempt > 0),
  dry_run boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'claimed'
    CHECK (status IN ('claimed', 'completed', 'failed')),
  result jsonb,
  error text,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (routine, logical_date)
);

ALTER TABLE public.health_agent_run_ledger ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER health_agent_run_ledger_updated_at
  BEFORE UPDATE ON public.health_agent_run_ledger
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION enqueue_health_fix(
  p_source text,
  p_fingerprint text,
  p_evidence jsonb,
  p_merge_policy text,
  p_title text,
  p_sentry_issue_id text DEFAULT NULL,
  p_url text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF btrim(p_source) = '' OR btrim(p_fingerprint) = '' THEN
    RAISE EXCEPTION 'source and fingerprint must be nonempty';
  END IF;

  IF jsonb_typeof(p_evidence) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'evidence must be a JSON object';
  END IF;

  IF p_merge_policy NOT IN ('automatic', 'human') THEN
    RAISE EXCEPTION 'invalid merge policy: %', p_merge_policy;
  END IF;

  INSERT INTO public.health_fix_queue AS queue (
    source,
    fingerprint,
    evidence,
    merge_policy,
    title,
    sentry_issue_id,
    url,
    status,
    next_attempt_at
  ) VALUES (
    p_source,
    p_fingerprint,
    p_evidence,
    p_merge_policy,
    p_title,
    NULLIF(p_sentry_issue_id, ''),
    p_url,
    'pending',
    now()
  )
  ON CONFLICT (fingerprint) WHERE status IN (
    'pending',
    'claimed',
    'pr_opened',
    'awaiting_human',
    'merged',
    'deployed',
    'failed',
    'needs_human'
  ) DO UPDATE
  SET evidence = queue.evidence || EXCLUDED.evidence,
      title = EXCLUDED.title,
      url = COALESCE(EXCLUDED.url, queue.url),
      sentry_issue_id = COALESCE(EXCLUDED.sentry_issue_id, queue.sentry_issue_id),
      updated_at = now()
  RETURNING queue.id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION claim_health_fixes(
  p_merge_policy text,
  p_lease_owner text,
  p_lease_duration interval DEFAULT interval '30 minutes'
)
RETURNS SETOF public.health_fix_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_merge_policy NOT IN ('automatic', 'human') THEN
    RAISE EXCEPTION 'invalid merge policy: %', p_merge_policy;
  END IF;

  IF btrim(p_lease_owner) = '' OR p_lease_duration <= interval '0 seconds' THEN
    RAISE EXCEPTION 'lease owner and duration must be valid';
  END IF;

  UPDATE public.health_fix_queue
  SET status = 'needs_human',
      lease_owner = NULL,
      lease_expires_at = NULL,
      last_error = COALESCE(last_error, 'Lease expired after the final automation attempt')
  WHERE merge_policy = p_merge_policy
    AND status = 'claimed'
    AND lease_expires_at <= now()
    AND attempt_count >= 2;

  RETURN QUERY
  WITH eligible AS (
    SELECT id
    FROM public.health_fix_queue
    WHERE merge_policy = p_merge_policy
      AND attempt_count < 2
      AND (
        status = 'pending'
        OR (status = 'failed' AND COALESCE(next_attempt_at, now()) <= now())
        OR (status = 'claimed' AND lease_expires_at <= now())
      )
    ORDER BY created_at, id
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

CREATE OR REPLACE FUNCTION transition_health_fix(
  p_id uuid,
  p_expected_status text,
  p_new_status text,
  p_lease_owner text DEFAULT NULL,
  p_last_error text DEFAULT NULL,
  p_next_attempt_at timestamptz DEFAULT NULL,
  p_pr_number bigint DEFAULT NULL,
  p_pr_url text DEFAULT NULL,
  p_merge_sha text DEFAULT NULL,
  p_deployed_at timestamptz DEFAULT NULL,
  p_confirmation_data jsonb DEFAULT NULL
)
RETURNS public.health_fix_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.health_fix_queue%ROWTYPE;
  v_target_status text := p_new_status;
BEGIN
  SELECT * INTO v_row
  FROM public.health_fix_queue
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND OR v_row.status IS DISTINCT FROM p_expected_status THEN
    RAISE EXCEPTION 'invalid health fix transition: expected %, found %',
      p_expected_status,
      COALESCE(v_row.status, '<missing>');
  END IF;

  IF v_row.status = 'claimed'
     AND v_row.lease_owner IS DISTINCT FROM p_lease_owner THEN
    RAISE EXCEPTION 'invalid health fix transition: lease owner mismatch';
  END IF;

  IF NOT (
    (v_row.status = 'claimed' AND p_new_status IN ('pr_opened', 'failed', 'skipped', 'needs_human'))
    OR (v_row.status = 'pr_opened' AND p_new_status IN ('awaiting_human', 'merged', 'failed', 'needs_human'))
    OR (v_row.status = 'awaiting_human' AND p_new_status IN ('merged', 'failed', 'skipped', 'needs_human'))
    OR (v_row.status = 'merged' AND p_new_status IN ('deployed', 'failed', 'needs_human'))
    OR (v_row.status = 'deployed' AND p_new_status IN ('fixed', 'failed', 'needs_human'))
  ) THEN
    RAISE EXCEPTION 'invalid health fix transition: % to %', v_row.status, p_new_status;
  END IF;

  IF p_new_status = 'failed' AND v_row.attempt_count >= 2 THEN
    v_target_status := 'needs_human';
  END IF;

  UPDATE public.health_fix_queue
  SET status = v_target_status,
      lease_owner = CASE WHEN v_target_status = 'claimed' THEN lease_owner ELSE NULL END,
      lease_expires_at = CASE WHEN v_target_status = 'claimed' THEN lease_expires_at ELSE NULL END,
      last_error = p_last_error,
      next_attempt_at = CASE WHEN v_target_status = 'failed' THEN p_next_attempt_at ELSE NULL END,
      pr_number = COALESCE(p_pr_number, pr_number),
      pr_url = COALESCE(p_pr_url, pr_url),
      merge_sha = COALESCE(p_merge_sha, merge_sha),
      deployed_at = CASE
        WHEN v_target_status = 'deployed' THEN COALESCE(p_deployed_at, now())
        ELSE deployed_at
      END,
      confirmation_data = COALESCE(p_confirmation_data, confirmation_data),
      fixed_at = CASE WHEN v_target_status = 'fixed' THEN now() ELSE fixed_at END,
      updated_at = now()
  WHERE id = p_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION record_health_snapshot(
  p_snapshot_date date,
  p_metrics jsonb
)
RETURNS public.health_snapshots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.health_snapshots%ROWTYPE;
BEGIN
  IF jsonb_typeof(p_metrics) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'metrics must be a JSON object';
  END IF;

  INSERT INTO public.health_snapshots AS snapshot (snapshot_date, metrics)
  VALUES (p_snapshot_date, p_metrics)
  ON CONFLICT (snapshot_date) DO UPDATE
  SET metrics = EXCLUDED.metrics,
      updated_at = now()
  RETURNING snapshot.* INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION read_health_directory_database_evidence()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog, pg_temp
AS $$
  SELECT jsonb_build_object(
    'connections', jsonb_build_object(
      'total', (
        SELECT count(*)
        FROM pg_catalog.pg_stat_activity
        WHERE datname = current_database()
      ),
      'maximum', (
        SELECT setting::integer
        FROM pg_catalog.pg_settings
        WHERE name = 'max_connections'
      )
    ),
    'activeQueries', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'queryId', md5(COALESCE(query, '') || ':' || pid::text),
        'durationSeconds', EXTRACT(EPOCH FROM (clock_timestamp() - query_start))
      ) ORDER BY pid)
      FROM pg_catalog.pg_stat_activity
      WHERE datname = current_database()
        AND state = 'active'
        AND pid <> pg_backend_pid()
    ), '[]'::jsonb),
    'deadTupleSnapshots', jsonb_build_array(jsonb_build_object(
      'snapshotDate', current_date,
      'tables', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'tableName', relname,
          'deadTuplePercent', CASE
            WHEN n_live_tup > 0 THEN 100.0 * n_dead_tup / n_live_tup
            ELSE 0
          END
        ) ORDER BY relname)
        FROM pg_catalog.pg_stat_user_tables
        WHERE schemaname = 'public'
      ), '[]'::jsonb)
    )),
    'indexConcerns', '[]'::jsonb
  );
$$;

CREATE OR REPLACE FUNCTION claim_health_agent_run(
  p_routine text,
  p_logical_date date,
  p_requested_run_id text,
  p_workflow_attempt integer,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run jsonb;
  v_existing public.health_agent_run_ledger%ROWTYPE;
BEGIN
  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'claimed', true,
      'dry_run', true,
      'routine', p_routine,
      'logical_date', p_logical_date,
      'requested_run_id', p_requested_run_id,
      'workflow_attempt', p_workflow_attempt
    );
  END IF;

  IF btrim(p_routine) = '' OR btrim(p_requested_run_id) = '' OR p_workflow_attempt < 1 THEN
    RAISE EXCEPTION 'run identity is invalid';
  END IF;

  INSERT INTO public.health_agent_run_ledger AS ledger (
    routine,
    logical_date,
    requested_run_id,
    workflow_attempt,
    dry_run,
    status
  ) VALUES (
    p_routine,
    p_logical_date,
    p_requested_run_id,
    p_workflow_attempt,
    false,
    'claimed'
  )
  ON CONFLICT (routine, logical_date) DO UPDATE
  SET requested_run_id = EXCLUDED.requested_run_id,
      workflow_attempt = EXCLUDED.workflow_attempt,
      status = 'claimed',
      result = NULL,
      error = NULL,
      claimed_at = now(),
      completed_at = NULL,
      updated_at = now()
  WHERE ledger.status = 'failed'
     OR (
       ledger.status = 'claimed'
       AND ledger.requested_run_id = EXCLUDED.requested_run_id
       AND ledger.workflow_attempt < EXCLUDED.workflow_attempt
     )
  RETURNING to_jsonb(ledger.*) INTO v_run;

  IF v_run IS NOT NULL THEN
    RETURN jsonb_build_object('claimed', true, 'run', v_run);
  END IF;

  SELECT * INTO v_existing
  FROM public.health_agent_run_ledger
  WHERE routine = p_routine
    AND logical_date = p_logical_date;

  IF v_existing.status = 'completed' THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'replay', true,
      'result', v_existing.result,
      'run', to_jsonb(v_existing)
    );
  END IF;

  RETURN jsonb_build_object('claimed', false, 'replay', false, 'run', to_jsonb(v_existing));
END;
$$;

CREATE OR REPLACE FUNCTION complete_health_agent_run(
  p_routine text,
  p_logical_date date,
  p_requested_run_id text,
  p_workflow_attempt integer,
  p_result jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.health_agent_run_ledger
  SET status = 'completed',
      result = p_result,
      error = NULL,
      completed_at = now(),
      updated_at = now()
  WHERE routine = p_routine
    AND logical_date = p_logical_date
    AND requested_run_id = p_requested_run_id
    AND workflow_attempt = p_workflow_attempt
    AND status = 'claimed';

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION fail_health_agent_run(
  p_routine text,
  p_logical_date date,
  p_requested_run_id text,
  p_workflow_attempt integer,
  p_error text,
  p_result jsonb DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.health_agent_run_ledger
  SET status = 'failed',
      result = p_result,
      error = p_error,
      completed_at = now(),
      updated_at = now()
  WHERE routine = p_routine
    AND logical_date = p_logical_date
    AND requested_run_id = p_requested_run_id
    AND workflow_attempt = p_workflow_attempt
    AND status = 'claimed';

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION record_link_health_result(
  p_brand_id uuid,
  p_field text,
  p_url text,
  p_status_code integer,
  p_checked_at timestamptz DEFAULT now()
)
RETURNS public.link_check_results
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.link_check_results%ROWTYPE;
  v_is_healthy boolean := p_status_code BETWEEN 200 AND 399;
  -- Failure evidence is recorded for error statuses, but NOT (403, 429).
  v_is_rate_limited boolean := p_status_code IN (403, 429);
  v_is_deterministic_storage_failure boolean :=
    p_status_code IN (404, 410) AND p_url LIKE '%/storage/v1/object/%';
BEGIN
  INSERT INTO public.link_check_results AS result (
    brand_id,
    field,
    url,
    last_status_code,
    last_ok_at,
    last_checked_at,
    consecutive_failures,
    failure_dates,
    distinct_failure_days,
    cleanup_required,
    cleanup_required_at
  ) VALUES (
    p_brand_id,
    p_field,
    p_url,
    p_status_code,
    CASE WHEN v_is_healthy THEN p_checked_at ELSE NULL END,
    p_checked_at,
    CASE WHEN v_is_healthy OR v_is_rate_limited THEN 0 ELSE 1 END,
    CASE
      WHEN v_is_healthy OR v_is_rate_limited THEN '{}'::date[]
      ELSE ARRAY[p_checked_at::date]
    END,
    CASE WHEN v_is_healthy OR v_is_rate_limited THEN 0 ELSE 1 END,
    v_is_deterministic_storage_failure,
    CASE WHEN v_is_deterministic_storage_failure THEN p_checked_at ELSE NULL END
  )
  ON CONFLICT (brand_id, field) DO UPDATE
  SET url = EXCLUDED.url,
      last_status_code = EXCLUDED.last_status_code,
      last_checked_at = EXCLUDED.last_checked_at,
      last_ok_at = CASE WHEN v_is_healthy THEN p_checked_at ELSE result.last_ok_at END,
      consecutive_failures = CASE
        WHEN v_is_healthy THEN 0
        WHEN v_is_rate_limited THEN result.consecutive_failures
        ELSE result.consecutive_failures + 1
      END,
      failure_dates = CASE
        WHEN v_is_healthy THEN '{}'::date[]
        WHEN v_is_rate_limited OR p_checked_at::date = ANY(result.failure_dates)
          THEN result.failure_dates
        ELSE array_append(result.failure_dates, p_checked_at::date)
      END,
      distinct_failure_days = CASE
        WHEN v_is_healthy THEN 0
        WHEN v_is_rate_limited OR p_checked_at::date = ANY(result.failure_dates)
          THEN result.distinct_failure_days
        ELSE result.distinct_failure_days + 1
      END,
      cleanup_required = CASE
        WHEN v_is_healthy THEN false
        WHEN v_is_rate_limited THEN result.cleanup_required
        WHEN v_is_deterministic_storage_failure THEN true
        WHEN p_checked_at::date = ANY(result.failure_dates)
          THEN result.distinct_failure_days >= 3
        ELSE result.distinct_failure_days + 1 >= 3
      END,
      cleanup_required_at = CASE
        WHEN v_is_healthy THEN NULL
        WHEN v_is_rate_limited OR result.cleanup_required THEN result.cleanup_required_at
        WHEN v_is_deterministic_storage_failure THEN p_checked_at
        WHEN p_checked_at::date <> ALL(result.failure_dates)
          AND result.distinct_failure_days + 1 >= 3 THEN p_checked_at
        ELSE NULL
      END,
      updated_at = now()
  RETURNING result.* INTO v_row;

  RETURN v_row;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'health_agent_reader') THEN
    CREATE ROLE health_agent_reader NOLOGIN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'health_agent_writer') THEN
    CREATE ROLE health_agent_writer NOLOGIN;
  END IF;
END;
$$;

ALTER ROLE health_agent_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE health_agent_writer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM health_agent_writer;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM health_agent_writer;
REVOKE INSERT, UPDATE, DELETE ON public.brands FROM health_agent_reader, health_agent_writer;

GRANT USAGE ON SCHEMA public TO health_agent_reader, health_agent_writer;
GRANT SELECT ON public.brands TO health_agent_reader;
GRANT SELECT ON public.health_fix_queue TO health_agent_reader;
GRANT SELECT ON public.health_snapshots TO health_agent_reader;
GRANT SELECT ON public.link_check_results TO health_agent_reader;
GRANT SELECT ON public.health_agent_run_ledger TO health_agent_reader;
GRANT pg_read_all_stats TO health_agent_reader;

DROP POLICY IF EXISTS health_agent_reader_approved_brands ON public.brands;
CREATE POLICY health_agent_reader_approved_brands
  ON public.brands
  FOR SELECT
  TO health_agent_reader
  USING (status = 'approved');

DROP POLICY IF EXISTS health_agent_reader_fix_queue ON public.health_fix_queue;
CREATE POLICY health_agent_reader_fix_queue
  ON public.health_fix_queue
  FOR SELECT
  TO health_agent_reader
  USING (true);

DROP POLICY IF EXISTS health_agent_reader_snapshots ON public.health_snapshots;
CREATE POLICY health_agent_reader_snapshots
  ON public.health_snapshots
  FOR SELECT
  TO health_agent_reader
  USING (true);

DROP POLICY IF EXISTS health_agent_reader_link_results ON public.link_check_results;
CREATE POLICY health_agent_reader_link_results
  ON public.link_check_results
  FOR SELECT
  TO health_agent_reader
  USING (true);

CREATE POLICY health_agent_reader_run_ledger
  ON public.health_agent_run_ledger
  FOR SELECT
  TO health_agent_reader
  USING (true);

REVOKE ALL ON FUNCTION enqueue_health_fix(text, text, jsonb, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_health_fixes(text, text, interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION transition_health_fix(uuid, text, text, text, text, timestamptz, bigint, text, text, timestamptz, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_health_snapshot(date, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION read_health_directory_database_evidence() FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_health_agent_run(text, date, text, integer, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_health_agent_run(text, date, text, integer, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION fail_health_agent_run(text, date, text, integer, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_link_health_result(uuid, text, text, integer, timestamptz) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION enqueue_health_fix(text, text, jsonb, text, text, text, text) TO health_agent_writer, service_role;
GRANT EXECUTE ON FUNCTION claim_health_fixes(text, text, interval) TO health_agent_writer, service_role;
GRANT EXECUTE ON FUNCTION transition_health_fix(uuid, text, text, text, text, timestamptz, bigint, text, text, timestamptz, jsonb) TO health_agent_writer, service_role;
GRANT EXECUTE ON FUNCTION record_health_snapshot(date, jsonb) TO health_agent_writer, service_role;
GRANT EXECUTE ON FUNCTION read_health_directory_database_evidence() TO health_agent_reader, service_role;
GRANT EXECUTE ON FUNCTION claim_health_agent_run(text, date, text, integer, boolean) TO health_agent_writer, service_role;
GRANT EXECUTE ON FUNCTION complete_health_agent_run(text, date, text, integer, jsonb) TO health_agent_writer, service_role;
GRANT EXECUTE ON FUNCTION fail_health_agent_run(text, date, text, integer, text, jsonb) TO health_agent_writer, service_role;
GRANT EXECUTE ON FUNCTION record_link_health_result(uuid, text, text, integer, timestamptz) TO health_agent_writer, service_role;
