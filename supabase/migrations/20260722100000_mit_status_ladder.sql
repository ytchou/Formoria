alter table public.brands drop constraint if exists brands_mit_status_check;
alter table public.brands
  add constraint brands_mit_status_check
  check (mit_status in ('unverified', 'declared', 'verified'));

alter table public.brands
  add column if not exists mit_declared_scope text
    check (mit_declared_scope in ('all', 'most', 'some')),
  add column if not exists mit_declared_at timestamptz,
  add column if not exists mit_declared_by uuid references auth.users (id);

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

  -- Declarer lost accountability — reset any self-declaration with ownership.
  update public.brands
     set mit_status = 'unverified',
         mit_declared_scope = null,
         mit_declared_at = null,
         mit_declared_by = null
   where id = p_brand_id
     and mit_status = 'declared';

  UPDATE public.brands
  SET contact_email = NULL
  WHERE id = p_brand_id;

  RETURN QUERY
  SELECT v_owner.user_id, v_revoked_user_email;
END;
$$;
