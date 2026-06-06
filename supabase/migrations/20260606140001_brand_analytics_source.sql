-- DEV-739: traffic-source attribution on brand_analytics.
-- Grain change: (brand_id, date) -> (brand_id, date, source).

-- 1. Add source column; existing rows backfill to 'unknown'.
ALTER TABLE brand_analytics
  ADD COLUMN source TEXT NOT NULL DEFAULT 'unknown';

-- 2. Future inserts default to 'direct' (RPCs always pass source explicitly).
ALTER TABLE brand_analytics
  ALTER COLUMN source SET DEFAULT 'direct';

-- 3. Bound cardinality.
ALTER TABLE brand_analytics
  ADD CONSTRAINT brand_analytics_source_chk
  CHECK (source IN (
    'direct','search','category','directory','recommendation',
    'external_search','social','external','unknown'
  ));

-- 4. Re-grain the unique constraint (confirm the dropped name against migration 00012).
ALTER TABLE brand_analytics
  DROP CONSTRAINT brand_analytics_brand_date_unique;
ALTER TABLE brand_analytics
  ADD CONSTRAINT brand_analytics_brand_id_date_source_key
  UNIQUE (brand_id, date, source);

-- 5. Recreate increment_brand_view with a source parameter.
DROP FUNCTION IF EXISTS increment_brand_view(uuid);
CREATE OR REPLACE FUNCTION increment_brand_view(p_brand_id uuid, p_source text DEFAULT 'direct')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO brand_analytics (brand_id, date, source, views, clicks)
  VALUES (p_brand_id, CURRENT_DATE, p_source, 1, 0)
  ON CONFLICT (brand_id, date, source)
  DO UPDATE SET views = brand_analytics.views + 1;
END;
$$;

-- 6. Recreate increment_brand_click (clicks park in the 'direct' partition; totals unaffected).
DROP FUNCTION IF EXISTS increment_brand_click(uuid);
CREATE OR REPLACE FUNCTION increment_brand_click(p_brand_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO brand_analytics (brand_id, date, source, views, clicks)
  VALUES (p_brand_id, CURRENT_DATE, 'direct', 0, 1)
  ON CONFLICT (brand_id, date, source)
  DO UPDATE SET clicks = brand_analytics.clicks + 1;
END;
$$;
