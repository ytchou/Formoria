-- ============================================================
-- Enable pg_trgm extension for trigram-based fuzzy search
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- GIN indexes for trigram search on brands
-- These accelerate ILIKE queries AND similarity() lookups
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_brands_name_trgm
  ON brands USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_brands_description_trgm
  ON brands USING gin (description gin_trgm_ops);

-- ============================================================
-- Composite index for faceted filtering
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_brands_category_status
  ON brands (category, status);

-- ============================================================
-- RPC function: search_brands
-- Used by autocomplete endpoint. Returns ranked results with
-- similarity scoring. Falls back to ILIKE for short queries
-- (< 3 chars) since trigrams need >= 3 chars to match.
-- ============================================================

CREATE OR REPLACE FUNCTION search_brands(
  search_query text,
  result_limit int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  name text,
  slug text,
  logo_url text,
  primary_category_name text,
  similarity_score real
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    b.id,
    b.name,
    b.slug,
    b.logo_url,
    COALESCE(b.category, '') AS primary_category_name,
    GREATEST(
      similarity(b.name, search_query),
      similarity(COALESCE(b.description, ''), search_query)
    ) AS similarity_score
  FROM brands b
  WHERE
    b.status = 'approved'
    AND (
      CASE
        WHEN length(search_query) < 3 THEN
          b.name ILIKE '%' || search_query || '%'
          OR COALESCE(b.description, '') ILIKE '%' || search_query || '%'
        ELSE
          b.name % search_query
          OR COALESCE(b.description, '') % search_query
      END
    )
  ORDER BY
    CASE
      WHEN b.name ILIKE search_query || '%' THEN 0
      WHEN similarity(b.name, search_query) > 0.5 THEN 1
      ELSE 2
    END,
    similarity(b.name, search_query) DESC
  LIMIT result_limit;
$$;
