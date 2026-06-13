-- Create pending_brand_edits review queue table
CREATE TABLE pending_brand_edits (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id uuid NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
    submitted_by uuid NOT NULL REFERENCES auth.users (id),
    proposed_data jsonb NOT NULL,
    status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewer_notes text,
    reviewed_at timestamptz,
    reviewed_by uuid REFERENCES auth.users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enforce one active pending edit per brand
CREATE UNIQUE INDEX idx_pending_brand_edits_one_pending
ON pending_brand_edits (brand_id) WHERE (status = 'pending');

-- Index for admin listing queries filtered by status
CREATE INDEX idx_pending_brand_edits_status ON pending_brand_edits (status);

-- RLS: brand owners can read their own pending edits
ALTER TABLE pending_brand_edits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owners can read own pending edits"
ON pending_brand_edits FOR SELECT
USING (submitted_by = auth.uid());
