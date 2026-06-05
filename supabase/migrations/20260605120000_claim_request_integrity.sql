CREATE UNIQUE INDEX IF NOT EXISTS claim_requests_pending_unique
ON public.claim_requests (brand_id, user_id)
WHERE status = 'pending';

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
