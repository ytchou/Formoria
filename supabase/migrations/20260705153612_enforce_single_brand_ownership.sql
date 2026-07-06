BEGIN;

DO $$
DECLARE
  conflicting_users text;
BEGIN
  SELECT string_agg(format('%s (%s brands)', user_id, brand_count), ', ' ORDER BY user_id)
  INTO conflicting_users
  FROM (
    SELECT user_id, count(*) AS brand_count
    FROM public.brand_owners
    GROUP BY user_id
    HAVING count(*) > 1
  ) conflicts;

  IF conflicting_users IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot enforce single-brand ownership. Resolve these accounts first: %', conflicting_users;
  END IF;
END;
$$;

CREATE UNIQUE INDEX brand_owners_user_id_unique
  ON public.brand_owners (user_id);

ALTER TABLE public.brand_owners
  ADD CONSTRAINT brand_owners_user_id_key
  UNIQUE USING INDEX brand_owners_user_id_unique;

CREATE OR REPLACE FUNCTION public.approve_claim_request(p_claim_id UUID, p_reviewer_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

GRANT EXECUTE ON FUNCTION public.approve_claim_request(UUID, UUID) TO service_role;

COMMIT;
