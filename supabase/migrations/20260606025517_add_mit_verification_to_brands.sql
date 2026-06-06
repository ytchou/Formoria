-- MIT Map: Add MIT-verification badge workflow to brands.
-- Badge lifecycle (claim -> evaluate):
--   1. CLAIM: the brand owner claims MIT status   -> mit_status = 'claimed'  (sets mit_claimed_at)
--   2. EVALUATION: an admin reviews the claim/evidence and decides
--        approves -> mit_status = 'verified'  (sets mit_verified_at)
--        denies   -> mit_status = 'rejected'
-- The "Made in Taiwan verified" badge renders ONLY when mit_status = 'verified'.
-- 'unverified' is the default for all seeded/new brands; evidence (mit_evidence) may be
-- pre-populated from the MIT smile registry but does NOT grant the badge on its own.
-- Additive + idempotent (IF NOT EXISTS), consistent with 00002/00004.

ALTER TABLE brands
ADD COLUMN IF NOT EXISTS source text,
ADD COLUMN IF NOT EXISTS mit_status text NOT NULL DEFAULT 'unverified'
    CHECK (mit_status IN ('unverified', 'claimed', 'verified', 'rejected')),
ADD COLUMN IF NOT EXISTS mit_claimed_at timestamptz,
ADD COLUMN IF NOT EXISTS mit_verified_at timestamptz,
ADD COLUMN IF NOT EXISTS mit_evidence jsonb;

CREATE INDEX IF NOT EXISTS idx_brands_mit_status ON brands (mit_status);

COMMENT ON COLUMN brands.source IS 'Provenance of the brand record (e.g. ''threads_seed'', ''self_serve'').';
COMMENT ON COLUMN brands.mit_status IS 'MIT badge workflow state: unverified (default) -> claimed (owner) -> verified|rejected (admin). Badge renders only when ''verified''.';
COMMENT ON COLUMN brands.mit_claimed_at IS 'Timestamp the owner claimed MIT status (mit_status -> ''claimed'').';
COMMENT ON COLUMN brands.mit_verified_at IS 'Timestamp an admin verified the MIT claim (mit_status -> ''verified'').';
COMMENT ON COLUMN brands.mit_evidence IS 'Supporting evidence for the MIT claim, e.g. {"mit_smile_cert": "...", "mit_smile_listed": true, "notes": "..."}.';
