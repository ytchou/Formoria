CREATE TABLE IF NOT EXISTS brand_analytics (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id    UUID         NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  date        DATE         NOT NULL DEFAULT CURRENT_DATE,
  views       INTEGER      NOT NULL DEFAULT 0,
  clicks      INTEGER      NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT brand_analytics_brand_date_unique UNIQUE (brand_id, date)
);

-- Covers range queries: WHERE brand_id = $1 AND date >= ...
-- UNIQUE constraint already creates an index on (brand_id, date); this is explicit for clarity.
CREATE INDEX IF NOT EXISTS idx_brand_analytics_brand_date
  ON brand_analytics (brand_id, date DESC);

ALTER TABLE brand_analytics ENABLE ROW LEVEL SECURITY;

-- Analytics writes are service-role only (no public mutations)
CREATE POLICY "service_role_full_access" ON brand_analytics
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Brand owners can read their own brand's analytics
CREATE POLICY "owners_read_own_analytics" ON brand_analytics
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM brand_owners bo
      WHERE bo.brand_id = brand_analytics.brand_id
        AND bo.user_id = auth.uid()
    )
  );
