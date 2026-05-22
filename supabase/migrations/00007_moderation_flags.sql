-- Content moderation flags for brand owner edits
CREATE TABLE IF NOT EXISTS moderation_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    field_name TEXT NOT NULL,
    flagged_content TEXT NOT NULL,
    flag_reason TEXT NOT NULL,
    tier TEXT NOT NULL CHECK (tier IN ('block', 'flag')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'reviewed', 'dismissed')
    ),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: only admins (service role) can read/write moderation flags
ALTER TABLE moderation_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access"
ON moderation_flags FOR ALL
USING (true)
WITH CHECK (true);

-- Index for admin review queue
CREATE INDEX idx_moderation_flags_status ON moderation_flags (
    status
) WHERE status
= 'pending';
