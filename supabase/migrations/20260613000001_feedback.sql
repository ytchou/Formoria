CREATE TABLE IF NOT EXISTS feedback (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source              TEXT NOT NULL CHECK (source IN ('sentry', 'tally')),
    type                TEXT NOT NULL CHECK (type IN ('bug', 'feedback')),
    title               TEXT,
    body                TEXT,
    url                 TEXT,
    status              TEXT NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open', 'reviewed', 'closed')),
    user_email          TEXT,
    sentry_event_id     TEXT,
    sentry_feedback_id  TEXT UNIQUE,
    tally_response_id   TEXT UNIQUE,
    metadata            JSONB DEFAULT '{}',
    reviewed_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- service_role bypasses RLS by default — matches brand_reports convention

CREATE INDEX idx_feedback_status     ON feedback (status) WHERE status = 'open';
CREATE INDEX idx_feedback_source     ON feedback (source);
CREATE INDEX idx_feedback_created_at ON feedback (created_at DESC);
