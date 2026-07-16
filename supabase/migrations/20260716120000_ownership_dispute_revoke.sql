BEGIN;

ALTER TABLE brand_reports DROP CONSTRAINT brand_reports_reason_check;
ALTER TABLE brand_reports ADD CONSTRAINT brand_reports_reason_check CHECK (
    reason IN ('not_mit', 'incorrect_info', 'broken_link', 'inappropriate', 'ownership_dispute')
);
ALTER TABLE brand_reports ADD COLUMN user_id UUID REFERENCES auth.users (id) ON DELETE SET NULL;

DROP POLICY owner_select_brand_reports ON brand_reports;
CREATE POLICY owner_select_brand_reports
  ON brand_reports
  FOR SELECT
  USING (
    reason <> 'ownership_dispute'
    AND EXISTS (
      SELECT 1
      FROM public.brand_owners bo
      WHERE bo.brand_id = brand_reports.brand_id
        AND bo.user_id = auth.uid()
    )
  );

CREATE TABLE ownership_revocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
    revoked_user_id UUID REFERENCES auth.users (id) ON DELETE SET NULL,
    revoked_user_email TEXT NOT NULL,
    revoked_by TEXT NOT NULL,
    reason TEXT NOT NULL,
    revoked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ownership_revocations ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_ownership_revocations_brand_id ON ownership_revocations (brand_id);

CREATE OR REPLACE FUNCTION public.revoke_brand_ownership(
  p_brand_id UUID,
  p_revoked_by TEXT,
  p_reason TEXT
)
RETURNS TABLE (revoked_user_id UUID, revoked_user_email TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner public.brand_owners%ROWTYPE;
  v_revoked_user_email TEXT;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Revocation reason is required';
  END IF;

  SELECT bo.*
  INTO v_owner
  FROM public.brand_owners AS bo
  WHERE bo.brand_id = p_brand_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Brand owner not found';
  END IF;

  SELECT au.email
  INTO v_revoked_user_email
  FROM auth.users AS au
  WHERE au.id = v_owner.user_id;

  IF v_revoked_user_email IS NULL THEN
    RAISE EXCEPTION 'Brand owner email not found';
  END IF;

  DELETE FROM public.brand_owners
  WHERE id = v_owner.id;

  INSERT INTO public.ownership_revocations (
    brand_id,
    revoked_user_id,
    revoked_user_email,
    revoked_by,
    reason
  )
  VALUES (
    p_brand_id,
    v_owner.user_id,
    v_revoked_user_email,
    p_revoked_by,
    p_reason
  );

  UPDATE public.brands
  SET contact_email = NULL
  WHERE id = p_brand_id;

  RETURN QUERY
  SELECT v_owner.user_id, v_revoked_user_email;
END;
$$;

GRANT EXECUTE ON FUNCTION public.revoke_brand_ownership(UUID, TEXT, TEXT) TO service_role;

COMMIT;
