-- Skip trigram fallback for prefix_mode autocomplete (DEV-1096)
--
-- Prefix-mode queries use FTS only, avoiding the expensive
-- CROSS JOIN LATERAL word_similarity scan that caused p95 spikes under load.
-- Full directory search (prefix_mode=false) retains trigram fallback.

CREATE OR REPLACE FUNCTION search_brands(
  search_query text,
  result_limit int DEFAULT NULL,
  prefix_mode boolean DEFAULT false,
  filter_categories text[] DEFAULT NULL,
  filter_tags text[] DEFAULT NULL,
  filter_verification text DEFAULT NULL,
  filter_status text DEFAULT 'approved',
  include_test_brands boolean DEFAULT false
)
RETURNS TABLE(
  id uuid,
  name text,
  slug text,
  hero_image_url text,
  primary_category_name text,
  rank_score real,
  search_source text
)
AS $$
DECLARE
  tsq tsquery;
BEGIN
  IF prefix_mode THEN
    tsq := to_tsquery('english', regexp_replace(search_query, '\s+', ':* & ', 'g') || ':*');
  ELSE
    tsq := websearch_to_tsquery('english', search_query);
  END IF;

  RETURN QUERY
  WITH fts_results AS (
    SELECT
      b.id,
      b.name,
      b.slug,
      b.hero_image_url,
      b.product_type AS primary_category_name,
      ts_rank(b.search_vector, tsq)::real AS rank_score,
      'fts'::text AS search_source
    FROM brands b
    LEFT JOIN brand_owners bo ON bo.brand_id = b.id
    WHERE b.search_vector @@ tsq
      AND b.status = filter_status
      AND (include_test_brands OR b.is_demo IS NOT TRUE)
      AND (filter_categories IS NULL OR b.product_type = ANY(filter_categories))
      AND (
        filter_verification IS NULL
        OR (filter_verification = 'verified' AND b.mit_status = 'verified')
        OR (filter_verification = 'owned' AND bo.brand_id IS NOT NULL)
      )
    ORDER BY ts_rank(b.search_vector, tsq)::real DESC
    LIMIT result_limit
  ),
  trgm_results AS (
    SELECT
      b.id,
      b.name,
      b.slug,
      b.hero_image_url,
      b.product_type AS primary_category_name,
      scores.rank_score,
      'trgm'::text AS search_source
    FROM brands b
    LEFT JOIN brand_owners bo ON bo.brand_id = b.id
    CROSS JOIN LATERAL (
      SELECT GREATEST(
        word_similarity(search_query, b.name) * 1.0,
        word_similarity(search_query, COALESCE(b.product_type, '')) * 0.8,
        word_similarity(search_query, COALESCE(b.blurb_en, '')) * 0.7,
        word_similarity(search_query, COALESCE(array_to_string(b.product_tags, ' '), '')) * 0.6,
        word_similarity(search_query, COALESCE(array_to_string(b.product_tags_en, ' '), '')) * 0.6,
        word_similarity(search_query, COALESCE(b.description, '')) * 0.5,
        word_similarity(search_query, COALESCE(b.slug, '')) * 0.4
      )::real AS rank_score
    ) scores
    WHERE NOT EXISTS (SELECT 1 FROM fts_results)
      AND NOT prefix_mode
      AND scores.rank_score >= 0.25
      AND b.status = filter_status
      AND (include_test_brands OR b.is_demo IS NOT TRUE)
      AND (filter_categories IS NULL OR b.product_type = ANY(filter_categories))
      AND (
        filter_verification IS NULL
        OR (filter_verification = 'verified' AND b.mit_status = 'verified')
        OR (filter_verification = 'owned' AND bo.brand_id IS NOT NULL)
      )
    ORDER BY scores.rank_score DESC
    LIMIT result_limit
  )
  SELECT * FROM fts_results
  UNION ALL
  SELECT * FROM trgm_results;
EXCEPTION
  WHEN others THEN
    RETURN QUERY
    SELECT
      b.id,
      b.name,
      b.slug,
      b.hero_image_url,
      b.product_type AS primary_category_name,
      scores.rank_score,
      'trgm'::text AS search_source
    FROM brands b
    LEFT JOIN brand_owners bo ON bo.brand_id = b.id
    CROSS JOIN LATERAL (
      SELECT GREATEST(
        word_similarity(search_query, b.name) * 1.0,
        word_similarity(search_query, COALESCE(b.product_type, '')) * 0.8,
        word_similarity(search_query, COALESCE(b.blurb_en, '')) * 0.7,
        word_similarity(search_query, COALESCE(array_to_string(b.product_tags, ' '), '')) * 0.6,
        word_similarity(search_query, COALESCE(array_to_string(b.product_tags_en, ' '), '')) * 0.6,
        word_similarity(search_query, COALESCE(b.description, '')) * 0.5,
        word_similarity(search_query, COALESCE(b.slug, '')) * 0.4
      )::real AS rank_score
    ) scores
    WHERE scores.rank_score >= 0.25
      AND NOT prefix_mode
      AND b.status = filter_status
      AND (include_test_brands OR b.is_demo IS NOT TRUE)
      AND (filter_categories IS NULL OR b.product_type = ANY(filter_categories))
      AND (
        filter_verification IS NULL
        OR (filter_verification = 'verified' AND b.mit_status = 'verified')
        OR (filter_verification = 'owned' AND bo.brand_id IS NOT NULL)
      )
    ORDER BY scores.rank_score DESC
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;
