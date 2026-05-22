ALTER TABLE moderation_flags
  ADD COLUMN previous_content TEXT;

COMMENT ON COLUMN moderation_flags.previous_content
  IS 'Field value before the brand owner edit that triggered this flag. NULL for flags created before this migration.';
