ALTER TABLE public.link_check_results
  ADD COLUMN failure_reason text
  CONSTRAINT link_check_results_failure_reason_check
  CHECK (
    failure_reason IS NULL
    OR failure_reason IN ('timeout', 'dns', 'tls', 'connection_reset', 'http')
  );

COMMENT ON COLUMN public.link_check_results.failure_reason IS
  'Classified reason for a non-HTTP link-check failure; NULL means no failure or an unclassified/transient failure.';

CREATE OR REPLACE FUNCTION public.record_link_health_result(
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
  v_failure_reason text := CASE
    WHEN p_status_code IS NULL OR v_is_healthy OR v_is_rate_limited THEN NULL
    ELSE 'http'
  END;
  v_is_deterministic_storage_failure boolean :=
    p_status_code IN (404, 410) AND p_url LIKE '%/storage/v1/object/%';
BEGIN
  INSERT INTO public.link_check_results AS result (
    brand_id,
    field,
    url,
    last_status_code,
    failure_reason,
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
    v_failure_reason,
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
      failure_reason = EXCLUDED.failure_reason,
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
