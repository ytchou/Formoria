-- DEV-748: rank CJK short queries & description-only matches in search_brands().
-- Replaces the length(q)<3 ILIKE cliff with word_similarity() + explicit >=0.25 thresholds.
-- Floor is 0.25 (not 0.3) to capture legitimate 3-char CJK tokens whose trigram similarity
-- lands at 0.25 (e.g. '山芙蓉' -> 中富生物科技 description). Catalog ~135 brands -> sub-ms seq scan.
-- Signature + RETURNS shape unchanged (backward compatible; no service-layer changes).
-- Match strategy: explicit word_similarity(query, target) numeric predicates (NOT set_limit()/GUC,
-- which leaks across pgBouncer pooled connections).

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
      word_similarity(search_query, b.name),
      0.5 * word_similarity(search_query, COALESCE(b.description, ''))
    )::real AS similarity_score
  FROM brands b
  WHERE
    b.status = 'approved'
    AND (
      b.name ILIKE search_query || '%'
      OR word_similarity(search_query, b.name) >= 0.25
      OR word_similarity(search_query, COALESCE(b.description, '')) >= 0.25
    )
  ORDER BY
    CASE
      WHEN b.name ILIKE search_query || '%' THEN 0
      WHEN word_similarity(search_query, b.name) >= 0.25 THEN 1
      ELSE 2
    END,
    GREATEST(
      word_similarity(search_query, b.name),
      0.5 * word_similarity(search_query, COALESCE(b.description, ''))
    ) DESC,
    b.name ASC
  LIMIT result_limit;
$$;

CREATE INDEX IF NOT EXISTS idx_brands_name_trgm ON brands USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_brands_description_trgm ON brands USING gin (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_brands_category_status ON brands (category, status);
