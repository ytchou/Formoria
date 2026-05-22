-- New columns on brand_submissions
ALTER TABLE brand_submissions
ADD COLUMN validation_status text
CHECK (validation_status IN ('valid', 'incomplete'))
DEFAULT NULL;

ALTER TABLE brand_submissions
ADD COLUMN validation_errors jsonb DEFAULT NULL;

ALTER TABLE brand_submissions
ADD COLUMN notified_at timestamptz DEFAULT NULL;

ALTER TABLE brand_submissions
ADD COLUMN is_brand_owner boolean DEFAULT FALSE;

-- Partial index: pending submissions not yet validated
CREATE INDEX idx_brand_submissions_pending_unvalidated
ON brand_submissions (status, validation_status)
WHERE status = 'pending' AND validation_status IS NULL;

-- Partial index: reviewed but not yet notified
CREATE INDEX idx_brand_submissions_reviewed_unnotified
ON brand_submissions (status, notified_at)
WHERE status IN ('approved', 'rejected')
AND reviewed_at IS NOT NULL
AND notified_at IS NULL;

-- Batch processing log for observability
CREATE TABLE batch_processing_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_at timestamptz DEFAULT now(),
    validated int NOT NULL DEFAULT 0,
    notified int NOT NULL DEFAULT 0,
    errors jsonb DEFAULT '[]',
    duration_ms int,
    triggered_by text DEFAULT 'pg_cron'
    CHECK (triggered_by IN ('pg_cron', 'manual'))
);

-- RLS: only service role can read/write batch logs
ALTER TABLE batch_processing_log ENABLE ROW LEVEL SECURITY;
