-- Wire bilingual fields + slug into search for cross-language matching (DEV-1012)
--
-- Adds blurb_en, product_tags_en, and slug to the search_vector (FTS tier)
-- and to word_similarity scoring (trigram fallback tier).
-- Enables English queries to match Chinese-named brands via their
-- English description, translated tags, or pinyin-based slug.

-- ---------------------------------------------------------------------------
-- 1. Update search_vector trigger to include bilingual fields + slug
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION brands_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.name, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(NEW.slug, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.product_type, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(NEW.product_tags, ' '), '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(NEW.product_tags_en, ' '), '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'D') ||
    setweight(to_tsvector('english', COALESCE(NEW.blurb_en, '')), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql VOLATILE SET search_path = public;

DROP TRIGGER IF EXISTS brands_search_vector_trigger ON brands;
CREATE TRIGGER brands_search_vector_trigger
  BEFORE INSERT OR UPDATE OF name, slug, product_type, product_tags, product_tags_en, description, blurb_en
  ON brands
  FOR EACH ROW
  EXECUTE FUNCTION brands_search_vector_update();

-- ---------------------------------------------------------------------------
-- 2. Backfill search_vector for all existing rows
-- ---------------------------------------------------------------------------

UPDATE brands SET
  search_vector =
    setweight(to_tsvector('english', COALESCE(name, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(slug, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(product_type, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(product_tags, ' '), '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(product_tags_en, ' '), '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(description, '')), 'D') ||
    setweight(to_tsvector('english', COALESCE(blurb_en, '')), 'D');

-- ---------------------------------------------------------------------------
-- 3. Rewrite search_brands RPC — add bilingual fields to trigram fallback
-- ---------------------------------------------------------------------------

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
