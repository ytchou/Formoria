ALTER TABLE brand_submissions
ADD COLUMN IF NOT EXISTS intent TEXT NOT NULL DEFAULT 'recommend'
CHECK (intent IN ('recommend', 'owner_claim'));

UPDATE brand_submissions
SET intent = CASE
  WHEN COALESCE(is_brand_owner, false) THEN 'owner_claim'
  ELSE 'recommend'
END
WHERE intent IS NULL OR intent = 'recommend';

COMMENT ON COLUMN brand_submissions.intent IS 'Why the submission entered the intake queue: community recommendation or owner onboarding.';
