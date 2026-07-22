-- All moderation scanner violations are blocking; keep only review status.
ALTER TABLE moderation_flags
DROP COLUMN IF EXISTS tier;
