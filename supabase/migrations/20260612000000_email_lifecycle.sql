-- email_sends: deduplication table for all outbound emails
CREATE TABLE IF NOT EXISTS public.email_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_key text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, template_key)
);

-- owner_email_preferences: stores unsubscribe state per owner
CREATE TABLE IF NOT EXISTS public.owner_email_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  unsubscribed_at timestamptz,
  unsubscribe_token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS: only service_role can read/write these tables (Edge Function + server actions)
ALTER TABLE public.email_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_email_preferences ENABLE ROW LEVEL SECURITY;

-- No policies for anon or authenticated — service_role bypasses RLS by default

-- profile_completeness: scores 4 brand fields, returns 0.0–1.0
-- Fields: description, logo_url, social_links (non-empty object), founding_year
CREATE OR REPLACE FUNCTION public.profile_completeness(p_brand_id uuid)
RETURNS float
LANGUAGE sql
STABLE
AS $$
  SELECT (
    CASE WHEN description IS NOT NULL AND description != '' THEN 0.25 ELSE 0 END +
    CASE WHEN logo_url IS NOT NULL AND logo_url != '' THEN 0.25 ELSE 0 END +
    CASE WHEN social_links IS NOT NULL AND social_links != '{}'::jsonb THEN 0.25 ELSE 0 END +
    CASE WHEN founding_year IS NOT NULL THEN 0.25 ELSE 0 END
  )::float
  FROM public.brands
  WHERE id = p_brand_id;
$$;

GRANT EXECUTE ON FUNCTION public.profile_completeness(uuid) TO service_role;
