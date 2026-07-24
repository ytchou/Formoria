CREATE TABLE public.brand_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.brands (id) ON DELETE CASCADE,
  visitor_hash TEXT NOT NULL CHECK (visitor_hash ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (brand_id, visitor_hash)
);

ALTER TABLE public.brand_likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all_brand_likes
  ON public.brand_likes
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.brand_likes IS
  'Lightweight public brand encouragement. Visitor identities are stored only as one-way hashes.';
