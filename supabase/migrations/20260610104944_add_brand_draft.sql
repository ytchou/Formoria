-- Add staged-draft storage for owner edits (DEV-737).
ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS draft_data jsonb,
  ADD COLUMN IF NOT EXISTS draft_updated_at timestamptz;

COMMENT ON COLUMN brands.draft_data IS 'Owner-staged, not-yet-published edits as an allow-listed domain snapshot. Never exposed to anonymous readers.';
COMMENT ON COLUMN brands.draft_updated_at IS 'When draft_data was last written; cleared on publish/discard.';
