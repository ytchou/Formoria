-- Add source attribution to brand_submissions
ALTER TABLE brand_submissions
  ADD COLUMN IF NOT EXISTS source_attribution TEXT
  CHECK (source_attribution IN (
    'bought_product', 'saw_at_market', 'found_online',
    'friend_recommended', 'work_there'
  ));

-- Create claim_requests table (foundation for DEV-687 -- no service code in this ticket)
CREATE TABLE IF NOT EXISTS claim_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  proof_type TEXT NOT NULL CHECK (proof_type IN ('domain_email', 'social_post', 'business_registration')),
  proof_url TEXT,
  proof_notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewer_notes TEXT,
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_claim_requests_brand_id ON claim_requests(brand_id);
CREATE INDEX IF NOT EXISTS idx_claim_requests_user_id ON claim_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_claim_requests_status ON claim_requests(status);

ALTER TABLE claim_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY claim_requests_select ON claim_requests
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY claim_requests_insert ON claim_requests
  FOR INSERT WITH CHECK (auth.uid() = user_id);
