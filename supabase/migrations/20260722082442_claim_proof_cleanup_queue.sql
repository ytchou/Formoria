BEGIN;

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'claim-proofs',
  'claim-proofs',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE public.claim_proof_cleanup_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_request_id UUID REFERENCES public.claim_requests(id) ON DELETE SET NULL,
  storage_key TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('decision', 'abandoned')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_token UUID,
  retry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX claim_proof_cleanup_jobs_active_storage_key_unique
  ON public.claim_proof_cleanup_jobs (storage_key)
  WHERE status IN ('pending', 'processing');

CREATE INDEX claim_proof_cleanup_jobs_ready_idx
  ON public.claim_proof_cleanup_jobs (retry_at, created_at)
  WHERE status = 'pending';

CREATE INDEX claim_proof_cleanup_jobs_processing_lease_idx
  ON public.claim_proof_cleanup_jobs (updated_at)
  WHERE status = 'processing';

ALTER TABLE public.claim_proof_cleanup_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.claim_proof_cleanup_jobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.claim_proof_cleanup_jobs TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_claim_proof_cleanup_after_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.claim_proof_cleanup_jobs (claim_request_id, storage_key, reason)
  SELECT NEW.id, proof ->> 'imageKey', 'decision'
  FROM jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(NEW.proof_evidence) = 'array' THEN NEW.proof_evidence
      ELSE '[]'::jsonb
    END
  ) AS proof
  WHERE jsonb_typeof(proof -> 'imageKey') = 'string'
    AND btrim(proof ->> 'imageKey') <> ''
  ON CONFLICT (storage_key)
    WHERE status IN ('pending', 'processing')
    DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER claim_requests_enqueue_proof_cleanup
AFTER UPDATE OF status ON public.claim_requests
FOR EACH ROW
WHEN (OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected'))
EXECUTE FUNCTION public.enqueue_claim_proof_cleanup_after_decision();

INSERT INTO public.claim_proof_cleanup_jobs (claim_request_id, storage_key, reason)
SELECT claim.id, proof ->> 'imageKey', 'decision'
FROM public.claim_requests AS claim
CROSS JOIN LATERAL jsonb_array_elements(
  CASE
    WHEN jsonb_typeof(claim.proof_evidence) = 'array' THEN claim.proof_evidence
    ELSE '[]'::jsonb
  END
) AS proof
WHERE claim.status IN ('approved', 'rejected')
  AND jsonb_typeof(proof -> 'imageKey') = 'string'
  AND btrim(proof ->> 'imageKey') <> ''
ON CONFLICT (storage_key)
  WHERE status IN ('pending', 'processing')
  DO NOTHING;

CREATE OR REPLACE FUNCTION public.claim_claim_proof_cleanup_jobs(
  p_lease_token UUID,
  p_claim_request_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (job_id UUID, storage_key TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH ready AS (
    SELECT job.id, job.status, job.attempt_count
    FROM public.claim_proof_cleanup_jobs AS job
    WHERE (
        (job.status = 'pending' AND job.retry_at <= now())
        OR (
          job.status = 'processing'
          AND job.updated_at <= now() - INTERVAL '15 minutes'
        )
      )
      AND (p_claim_request_id IS NULL OR job.claim_request_id = p_claim_request_id)
    ORDER BY job.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 1000)
  ), claimed AS (
    UPDATE public.claim_proof_cleanup_jobs AS job
    SET status = CASE
          WHEN ready.status = 'processing' AND ready.attempt_count >= 5 THEN 'failed'
          ELSE 'processing'
        END,
        attempt_count = CASE
          WHEN ready.status = 'processing' AND ready.attempt_count >= 5
            THEN job.attempt_count
          ELSE job.attempt_count + 1
        END,
        lease_token = CASE
          WHEN ready.status = 'processing' AND ready.attempt_count >= 5 THEN NULL
          ELSE p_lease_token
        END,
        last_error = CASE
          WHEN ready.status = 'processing' AND ready.attempt_count >= 5
            THEN COALESCE(job.last_error, 'cleanup lease expired after maximum attempts')
          ELSE NULL
        END,
        updated_at = now()
    FROM ready
    WHERE job.id = ready.id
    RETURNING job.id, job.storage_key, job.status
  )
  SELECT claimed.id, claimed.storage_key
  FROM claimed
  WHERE claimed.status = 'processing';
$$;

CREATE OR REPLACE FUNCTION public.complete_claim_proof_cleanup_jobs(
  p_job_ids UUID[],
  p_lease_token UUID
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE public.claim_proof_cleanup_jobs
  SET status = 'completed',
      completed_at = now(),
      updated_at = now(),
      last_error = NULL,
      lease_token = NULL
  WHERE id = ANY(COALESCE(p_job_ids, ARRAY[]::UUID[]))
    AND status = 'processing'
    AND lease_token = p_lease_token;
$$;

CREATE OR REPLACE FUNCTION public.fail_claim_proof_cleanup_jobs(
  p_job_ids UUID[],
  p_lease_token UUID,
  p_error TEXT
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE public.claim_proof_cleanup_jobs
  SET status = CASE WHEN attempt_count >= 5 THEN 'failed' ELSE 'pending' END,
      retry_at = CASE
        WHEN attempt_count >= 5 THEN retry_at
        ELSE now() + make_interval(
          secs => LEAST(
            21600,
            60 * power(2, LEAST(GREATEST(attempt_count - 1, 0), 8))::INTEGER
          )
        )
      END,
      last_error = left(COALESCE(p_error, 'unknown cleanup error'), 2000),
      updated_at = now(),
      lease_token = NULL
  WHERE id = ANY(COALESCE(p_job_ids, ARRAY[]::UUID[]))
    AND status = 'processing'
    AND lease_token = p_lease_token;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_abandoned_claim_proof_cleanup_jobs()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_inserted INTEGER;
BEGIN
  INSERT INTO public.claim_proof_cleanup_jobs (storage_key, reason)
  SELECT 'claim-proofs/' || object.name, 'abandoned'
  FROM storage.objects AS object
  WHERE object.bucket_id = 'claim-proofs'
    AND object.created_at < now() - INTERVAL '24 hours'
    AND NOT EXISTS (
      SELECT 1
      FROM public.claim_requests AS claim
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(claim.proof_evidence) = 'array' THEN claim.proof_evidence
          ELSE '[]'::jsonb
        END
      ) AS proof
      WHERE proof ->> 'imageKey' = 'claim-proofs/' || object.name
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.claim_proof_cleanup_jobs AS job
      WHERE job.storage_key = 'claim-proofs/' || object.name
    )
  ON CONFLICT (storage_key)
    WHERE status IN ('pending', 'processing')
    DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_claim_request(p_claim_id UUID, p_reviewer_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_claim public.claim_requests%ROWTYPE;
  v_requester_email TEXT;
BEGIN
  SELECT *
  INTO v_claim
  FROM public.claim_requests
  WHERE id = p_claim_id
    AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim already reviewed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(v_claim.proof_evidence) = 'array' THEN v_claim.proof_evidence
        ELSE '[]'::jsonb
      END
    ) AS proof
    WHERE proof ->> 'type' = 'domain_email'
      AND COALESCE(proof -> 'verified', 'false'::jsonb) IS DISTINCT FROM 'true'::jsonb
  ) THEN
    RAISE EXCEPTION 'domain email proof not verified';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.brand_owners
    WHERE user_id = v_claim.user_id
  ) THEN
    RAISE EXCEPTION 'This account already manages a brand'
      USING ERRCODE = '23505';
  END IF;

  SELECT au.email
  INTO v_requester_email
  FROM auth.users AS au
  WHERE au.id = v_claim.user_id;

  IF v_requester_email IS NULL THEN
    RAISE EXCEPTION 'Claim requester email not found';
  END IF;

  BEGIN
    INSERT INTO public.brand_owners (user_id, brand_id)
    VALUES (v_claim.user_id, v_claim.brand_id);
  EXCEPTION
    WHEN unique_violation THEN
      IF EXISTS (
        SELECT 1
        FROM public.brand_owners
        WHERE user_id = v_claim.user_id
      ) THEN
        RAISE EXCEPTION 'This account already manages a brand'
          USING ERRCODE = '23505';
      END IF;

      RAISE EXCEPTION 'This brand has already been claimed'
        USING ERRCODE = '23505';
  END;

  UPDATE public.brands
  SET contact_email = v_requester_email
  WHERE id = v_claim.brand_id;

  UPDATE public.claim_requests
  SET status = 'approved',
      reviewed_at = now(),
      reviewed_by = p_reviewer_id
  WHERE id = p_claim_id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_claim_proof_cleanup_after_decision()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_claim_proof_cleanup_jobs(UUID, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_claim_proof_cleanup_jobs(UUID[], UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_claim_proof_cleanup_jobs(UUID[], UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_abandoned_claim_proof_cleanup_jobs()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_claim_request(UUID, UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.enqueue_claim_proof_cleanup_after_decision() TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_claim_proof_cleanup_jobs(UUID, UUID, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_claim_proof_cleanup_jobs(UUID[], UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_claim_proof_cleanup_jobs(UUID[], UUID, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_abandoned_claim_proof_cleanup_jobs() TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_claim_request(UUID, UUID) TO service_role;

DO $$ BEGIN
  PERFORM cron.unschedule('claim-proof-cleanup-hourly');
EXCEPTION WHEN others THEN
  NULL;
END $$;

SELECT cron.schedule(
  'claim-proof-cleanup-hourly',
  '17 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT value FROM public.app_secrets WHERE key = 'site_url')
      || '/api/cron/claim-proof-cleanup',
    headers := jsonb_build_object(
      'x-origin-verify', (SELECT value FROM public.app_secrets WHERE key = 'origin_secret'),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('triggered_by', 'pg_cron', 'run_at', now()::text)
  )
  $$
);

COMMIT;
