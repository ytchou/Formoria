-- Atomic increment functions for brand_analytics counters.
-- Using stored functions ensures views/clicks are incremented, not overwritten,
-- on repeated calls for the same brand_id + date.

CREATE OR REPLACE FUNCTION increment_brand_view(p_brand_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO brand_analytics (brand_id, date, views, clicks)
  VALUES (p_brand_id, CURRENT_DATE, 1, 0)
  ON CONFLICT (brand_id, date)
  DO UPDATE SET views = brand_analytics.views + 1;
END;
$$;

CREATE OR REPLACE FUNCTION increment_brand_click(p_brand_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO brand_analytics (brand_id, date, clicks, views)
  VALUES (p_brand_id, CURRENT_DATE, 1, 0)
  ON CONFLICT (brand_id, date)
  DO UPDATE SET clicks = brand_analytics.clicks + 1;
END;
$$;

-- Grant execute to service_role only (analytics writes are service-role only per RLS policy)
GRANT EXECUTE ON FUNCTION increment_brand_view(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION increment_brand_click(UUID) TO service_role;
