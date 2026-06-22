CREATE TABLE brand_ai_results (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id uuid NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
    phase text NOT NULL CHECK (phase IN ('triage', 'description')),
    is_non_brand boolean,
    non_brand_reason text,
    slug_generated text,
    product_type text,
    confidence text CHECK (confidence IN ('high', 'medium', 'low')),
    value_tags text [] NOT NULL DEFAULT '{}',
    description text,
    model text NOT NULL,
    raw_response jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX brand_ai_results_brand_phase_idx
ON brand_ai_results (brand_id, phase, created_at DESC);
