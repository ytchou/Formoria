-- Simplify mit_status to binary: unverified | verified
UPDATE brands SET mit_status = 'unverified' WHERE mit_status IN ('claimed', 'rejected');

-- Drop and recreate CHECK constraint
ALTER TABLE brands DROP CONSTRAINT IF EXISTS brands_mit_status_check;
ALTER TABLE brands ADD CONSTRAINT brands_mit_status_check CHECK (mit_status IN ('unverified', 'verified'));

-- Drop UBN columns
ALTER TABLE brands DROP COLUMN IF EXISTS unified_business_number;
ALTER TABLE brand_submissions DROP COLUMN IF EXISTS unified_business_number;

-- Drop UBN-based duplicate check RPC
DROP FUNCTION IF EXISTS check_brand_duplicates(text, text, text);

-- Drop unused mit_claimed_at column if it exists
ALTER TABLE brands DROP COLUMN IF EXISTS mit_claimed_at;
