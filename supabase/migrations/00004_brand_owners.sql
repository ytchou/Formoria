-- Brand ownership records — links authenticated users to their claimed brands
CREATE TABLE IF NOT EXISTS brand_owners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(brand_id)  -- one owner per brand
);

-- RLS: users can only read their own ownership records
ALTER TABLE brand_owners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own ownership"
  ON brand_owners FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert ownership"
  ON brand_owners FOR INSERT
  WITH CHECK (true);

-- Index for looking up brands by owner
CREATE INDEX idx_brand_owners_user_id ON brand_owners(user_id);
