CREATE TABLE health_fix_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sentry_issue_id text NOT NULL,
  title text NOT NULL,
  url text,
  seer_root_cause text,
  recommended_action text,
  key_frames jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'attempted', 'pr_opened', 'fixed', 'failed', 'skipped')),
  pr_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  attempted_at timestamptz,
  fixed_at timestamptz
);

-- Partial unique index for fix-attempt dedupe:
-- only one active row per Sentry issue
CREATE UNIQUE INDEX health_fix_queue_active_issue_idx
  ON health_fix_queue (sentry_issue_id)
  WHERE status IN ('pending', 'attempted', 'pr_opened');

ALTER TABLE health_fix_queue ENABLE ROW LEVEL SECURITY;
-- No policies — service_role access only

CREATE TRIGGER health_fix_queue_updated_at
  BEFORE UPDATE ON health_fix_queue
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
