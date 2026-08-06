-- DEV-1362: expose a bounded, service-only search page primitive.
--
-- The existing search_brands RPC is intentionally flexible for internal
-- enrichment tools, but accepting an arbitrary result_limit lets an API caller
-- turn it into a full-table export. Public directory reads use this function
-- instead: the page size is fixed here and only ranking metadata is returned.

CREATE OR REPLACE FUNCTION public.search_brand_page(
  search_query text,
  filter_categories text[] DEFAULT NULL,
  filter_tags text[] DEFAULT NULL,
  filter_verification text DEFAULT NULL,
  filter_price_ranges integer[] DEFAULT NULL,
  page_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  rank_score real,
  search_source text,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  normalized_query text := btrim(search_query);
  sanitized_query text;
  tsq tsquery;
BEGIN
  IF normalized_query IS NULL
    OR char_length(normalized_query) < 2
    OR char_length(normalized_query) > 100
    OR normalized_query ~ '^[[:space:]%_*?]+$'
  THEN
    RETURN;
  END IF;

  IF page_offset < 0 THEN
    RAISE EXCEPTION 'page_offset must be non-negative'
      USING ERRCODE = '22023';
  END IF;

  -- Bound filter cardinality before using the arrays in a query predicate.
  IF cardinality(filter_categories) > 20
    OR cardinality(filter_tags) > 50
    OR cardinality(filter_price_ranges) > 3
  THEN
    RAISE EXCEPTION 'search filters exceed the supported bounds'
      USING ERRCODE = '22023';
  END IF;

  IF filter_verification IS NOT NULL
    AND filter_verification NOT IN ('mit-verified', 'mit-declared', 'owned')
  THEN
    RAISE EXCEPTION 'unsupported verification filter'
      USING ERRCODE = '22023';
  END IF;

  sanitized_query := btrim(
    regexp_replace(
      normalized_query,
      '[!&|()<>:/''"\\*?%_]+',
      ' ',
      'g'
    )
  );
  IF sanitized_query = '' THEN
    RETURN;
  END IF;

  BEGIN
    tsq := websearch_to_tsquery('english', sanitized_query);
  EXCEPTION WHEN others THEN
    tsq := NULL;
  END;

  RETURN QUERY
  WITH base AS (
    SELECT
      b.id,
      CASE
        WHEN tsq IS NOT NULL AND b.search_vector @@ tsq
          THEN ts_rank(b.search_vector, tsq)::real
        ELSE 0::real
      END AS fts_rank,
      GREATEST(
        word_similarity(sanitized_query, b.name) * 1.0,
        word_similarity(sanitized_query, COALESCE(b.product_type, '')) * 0.8,
        word_similarity(sanitized_query, COALESCE(b.blurb_en, '')) * 0.7,
        word_similarity(sanitized_query, COALESCE(array_to_string(b.product_tags, ' '), '')) * 0.6,
        word_similarity(sanitized_query, COALESCE(array_to_string(b.product_tags_en, ' '), '')) * 0.6,
        word_similarity(sanitized_query, COALESCE(b.description, '')) * 0.5,
        word_similarity(sanitized_query, COALESCE(b.slug, '')) * 0.4
      )::real AS trgm_rank,
      b.search_vector IS NOT NULL
        AND tsq IS NOT NULL
        AND b.search_vector @@ tsq AS has_fts,
      bo.brand_id IS NOT NULL AS is_owned
    FROM public.brands AS b
    LEFT JOIN public.brand_owners AS bo ON bo.brand_id = b.id
    WHERE b.status = 'approved'
      AND b.is_demo IS NOT TRUE
      AND (
        filter_categories IS NULL
        OR b.product_type = ANY(filter_categories)
      )
      AND (
        filter_tags IS NULL
        OR b.product_tags && filter_tags
      )
      AND (
        filter_price_ranges IS NULL
        OR b.price_range = ANY(filter_price_ranges)
      )
      AND (
        filter_verification IS NULL
        OR (filter_verification = 'mit-verified' AND b.mit_status = 'verified')
        OR (filter_verification = 'mit-declared' AND b.mit_status = 'declared')
        OR (filter_verification = 'owned' AND bo.brand_id IS NOT NULL)
      )
  ),
  ranked AS (
    -- Match the established bilingual ranking: prefer FTS whenever it has at
    -- least one match, otherwise use the trigram fallback for CJK and prose.
    SELECT id, fts_rank AS rank_score, 'fts'::text AS search_source
    FROM base
    WHERE has_fts
    UNION ALL
    SELECT id, trgm_rank AS rank_score, 'trgm'::text AS search_source
    FROM base
    WHERE NOT EXISTS (SELECT 1 FROM base WHERE has_fts)
      AND trgm_rank >= 0.25
  ),
  numbered AS (
    SELECT
      id,
      rank_score,
      search_source,
      count(*) OVER () AS total_count,
      row_number() OVER (
        ORDER BY rank_score DESC, id ASC
      ) AS row_number
    FROM ranked
  )
  SELECT numbered.id, numbered.rank_score, numbered.search_source, numbered.total_count
  FROM numbered
  WHERE numbered.row_number > page_offset
    AND numbered.row_number <= page_offset + 12
  ORDER BY numbered.row_number;
END;
$$;

REVOKE ALL ON FUNCTION public.search_brand_page(text, text[], text[], text, integer[], integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_brand_page(text, text[], text[], text, integer[], integer)
  TO service_role;
