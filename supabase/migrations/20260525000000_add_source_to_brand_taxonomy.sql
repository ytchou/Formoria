-- Add source column to brand_taxonomy to track assignment origin (auto/manual/suggested)
ALTER TABLE brand_taxonomy
  ADD COLUMN source text NOT NULL DEFAULT 'manual'
  CHECK (source IN ('auto', 'manual', 'suggested'));

-- Index for efficient review queue queries (WHERE source = 'auto')
CREATE INDEX idx_brand_taxonomy_source ON brand_taxonomy(source);

-- Existing seed rows default to 'manual' — no backfill needed
