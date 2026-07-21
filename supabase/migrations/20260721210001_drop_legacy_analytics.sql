-- Drop legacy analytics tables and increment RPCs (DEV-1115)
--
-- brand_analytics and brand_link_clicks have been superseded by
-- PostHog server-side tracking. Row counts are logged before drop
-- as a permanent audit record.

DO $$
DECLARE
  v_brand_analytics_count bigint;
  v_brand_link_clicks_count bigint;
BEGIN
  -- Tables may already be absent (dropped out-of-band); skip the audit then
  IF to_regclass('public.brand_analytics') IS NULL
     OR to_regclass('public.brand_link_clicks') IS NULL THEN
    RAISE NOTICE 'pre-drop audit skipped: legacy analytics tables already absent';
  ELSE
    SELECT COUNT(*) INTO v_brand_analytics_count FROM brand_analytics;
    SELECT COUNT(*) INTO v_brand_link_clicks_count FROM brand_link_clicks;
    RAISE NOTICE 'pre-drop audit: brand_analytics=% rows, brand_link_clicks=% rows',
      v_brand_analytics_count, v_brand_link_clicks_count;
  END IF;
END $$;

-- Drop legacy increment RPCs
DROP FUNCTION IF EXISTS increment_brand_view(uuid, text);
DROP FUNCTION IF EXISTS increment_brand_view(uuid);
DROP FUNCTION IF EXISTS increment_brand_click(uuid);
DROP FUNCTION IF EXISTS increment_brand_link_click(uuid, text);

DROP TABLE IF EXISTS brand_link_clicks CASCADE;
DROP TABLE IF EXISTS brand_analytics CASCADE;
