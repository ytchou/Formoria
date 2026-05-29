-- Community reports against brands (anonymous, admin-reviewed)
CREATE TABLE IF NOT EXISTS brand_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
    reason TEXT NOT NULL CHECK (
        reason IN ('not_mit', 'incorrect_info', 'broken_link', 'inappropriate')
    ),
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'reviewed', 'dismissed')
    ),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Admin-only table: enable RLS, no policy (service_role bypasses — matches 00009 convention)
ALTER TABLE brand_reports ENABLE ROW LEVEL SECURITY;

-- Partial index for pending-queue scan (mirrors idx_moderation_flags_status)
CREATE INDEX idx_brand_reports_status ON brand_reports (status) WHERE status = 'pending';

-- Per-brand lookup
CREATE INDEX idx_brand_reports_brand_id ON brand_reports (brand_id);
