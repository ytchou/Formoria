-- Retire the superseded CJK helpers, de-duplicate the trigram ladder, and recover
-- split-name recall (DEV-1413, review fix pass 2)
--
-- Three leftovers from 20260809140000:
--
--   1. cjk_tsquery and strip_cjk_runs lost their only callers when
--      brand_search_tsquery replaced them, but survived as dead functions — and
--      cjk_tsquery still carried the ANDs-every-bigram body that produced the
--      `台灣咖啡` -> 0 regression. Dead code preserving the exact bug the branch
--      exists to remove is worse than no code.
--   2. The seven-term word_similarity ladder was still copy-pasted between
--      search_brand_page and search_brands. brand_search_tsquery already
--      established the fix pattern for the tsquery half; this does the same for
--      the ranking half, so a reweighting lands in one place.
--   3. Split-CJK-name recall: a brand stored as `紙。有光` produced no 紙有 token,
--      because bigrams were generated per unbroken run. The tiled query for 紙有光
--      asks for 紙有 & 有光, so the brand was unreachable — and with the trigram
--      tier now off for all CJK, nothing caught it. 13 approved brands carry an
--      ideograph-separator-ideograph name.

-- ---------------------------------------------------------------------------
-- 1. Drop the superseded helpers
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.cjk_tsquery(text);
DROP FUNCTION IF EXISTS public.strip_cjk_runs(text);

-- ---------------------------------------------------------------------------
-- 2. Bridged bigrams for names
-- ---------------------------------------------------------------------------
--
-- Ideographs only, separators removed, then bigrammed — so `紙。有光` yields
-- 紙有 and 有光 and becomes reachable by the name a visitor actually types.
--
-- Scoped to `name` on purpose. Bridging concatenates every ideograph in the input,
-- so on a long description it would also manufacture junction bigrams across
-- sentence boundaries. A brand name is short and is exactly where the
-- separator-split spelling occurs, so the recall is worth the bounded noise there
-- and is not worth it at weight D.
CREATE OR REPLACE FUNCTION public.cjk_bigrams_bridged(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.cjk_bigrams(
    regexp_replace(COALESCE(input, ''), '[^㐀-䶿一-鿿豈-﫿]', '', 'g')
  );
$$;

CREATE OR REPLACE FUNCTION public.brands_search_document(
  p_name text,
  p_slug text,
  p_product_type text,
  p_product_tags text[],
  p_product_tags_en text[],
  p_description text,
  p_blurb_en text
)
RETURNS tsvector
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT
    setweight(to_tsvector('english', COALESCE(p_name, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(p_slug, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(p_product_type, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(p_product_tags, ' '), '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(p_product_tags_en, ' '), '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(p_description, '')), 'D') ||
    setweight(to_tsvector('english', COALESCE(p_blurb_en, '')), 'D') ||
    setweight(to_tsvector('simple', public.cjk_bigrams_bridged(COALESCE(p_name, ''))), 'A') ||
    setweight(to_tsvector('simple', public.cjk_bigrams(COALESCE(array_to_string(p_product_tags, ' '), ''))), 'C') ||
    setweight(to_tsvector('simple', public.cjk_bigrams(left(COALESCE(p_description, ''), 2000))), 'D');
$$;

-- ---------------------------------------------------------------------------
-- 3. One trigram ladder
-- ---------------------------------------------------------------------------
--
-- Fields are passed explicitly rather than as a `brands` row type so the signature
-- states its inputs and does not silently re-bind if the table gains a column.
CREATE OR REPLACE FUNCTION public.brand_trgm_rank(
  p_query text,
  p_name text,
  p_product_type text,
  p_blurb_en text,
  p_product_tags text[],
  p_product_tags_en text[],
  p_description text,
  p_slug text
)
RETURNS real
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT GREATEST(
    word_similarity(p_query, COALESCE(p_name, '')) * 1.0,
    word_similarity(p_query, COALESCE(p_product_type, '')) * 0.8,
    word_similarity(p_query, COALESCE(p_blurb_en, '')) * 0.7,
    word_similarity(p_query, COALESCE(array_to_string(p_product_tags, ' '), '')) * 0.6,
    word_similarity(p_query, COALESCE(array_to_string(p_product_tags_en, ' '), '')) * 0.6,
    word_similarity(p_query, COALESCE(p_description, '')) * 0.5,
    word_similarity(p_query, COALESCE(p_slug, '')) * 0.4
  )::real;
$$;

-- ---------------------------------------------------------------------------
-- 4. Rebuild vectors (name bigrams changed)
-- ---------------------------------------------------------------------------
ALTER TABLE public.brands DISABLE TRIGGER brands_updated_at;

UPDATE public.brands SET search_vector = public.brands_search_document(
  name, slug, product_type, product_tags, product_tags_en, description, blurb_en
);

ALTER TABLE public.brands ENABLE TRIGGER brands_updated_at;

-- ---------------------------------------------------------------------------
-- 5. Both RPCs call the shared ladder
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.search_brand_page(
  search_query text,
  filter_categories text[] DEFAULT NULL::text[],
  filter_tags text[] DEFAULT NULL::text[],
  filter_verification text DEFAULT NULL::text,
  filter_price_ranges integer[] DEFAULT NULL::integer[],
  page_offset integer DEFAULT 0,
  sort_mode text DEFAULT 'rank'::text
)
RETURNS TABLE(id uuid, rank_score real, search_source text, total_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  normalized_query text := btrim(search_query);
  sanitized_query text;
  tsq tsquery;
  has_cjk boolean;
BEGIN
  IF normalized_query IS NULL
    OR char_length(normalized_query) < 2
    OR char_length(normalized_query) > 100
    OR normalized_query ~ '^[[:space:]%_*?]+$'
  THEN
    RETURN;
  END IF;

  IF page_offset < 0 THEN
    RAISE EXCEPTION 'page_offset must be non-negative' USING ERRCODE = '22023';
  END IF;

  IF sort_mode NOT IN ('rank', 'name', 'newest', 'year') THEN
    RAISE EXCEPTION 'unsupported search sort mode' USING ERRCODE = '22023';
  END IF;

  IF cardinality(filter_categories) > 20
    OR cardinality(filter_tags) > 50
    OR cardinality(filter_price_ranges) > 3
  THEN
    RAISE EXCEPTION 'search filters exceed the supported bounds' USING ERRCODE = '22023';
  END IF;

  IF filter_verification IS NOT NULL
    AND filter_verification NOT IN ('mit-verified', 'mit-declared', 'owned')
  THEN
    RAISE EXCEPTION 'unsupported verification filter' USING ERRCODE = '22023';
  END IF;

  -- '-' is preserved: brand_search_tsquery handles negation for both scripts.
  sanitized_query := btrim(
    regexp_replace(normalized_query, '[!&|()<>:/''"\\*?%_]+', ' ', 'g')
  );
  IF sanitized_query = '' THEN
    RETURN;
  END IF;

  tsq := public.brand_search_tsquery(sanitized_query, false);
  has_cjk := sanitized_query ~ '[㐀-䶿一-鿿豈-﫿]';

  RETURN QUERY
  WITH base AS (
    SELECT
      b.id,
      b.name,
      b.created_at,
      b.founding_year,
      CASE
        WHEN tsq IS NOT NULL AND b.search_vector @@ tsq
          THEN ts_rank(b.search_vector, tsq)::real
        ELSE 0::real
      END AS fts_rank,
      -- CASE, not just an unused column: `base` is referenced twice by `ranked`, so
      -- Postgres materialises it and would otherwise evaluate the whole ladder for
      -- every approved brand before discarding it on the CJK path.
      CASE
        WHEN has_cjk THEN 0::real
        ELSE public.brand_trgm_rank(
          sanitized_query, b.name, b.product_type, b.blurb_en,
          b.product_tags, b.product_tags_en, b.description, b.slug
        )
      END AS trgm_rank,
      b.search_vector IS NOT NULL
        AND tsq IS NOT NULL
        AND b.search_vector @@ tsq AS has_fts,
      bo.brand_id IS NOT NULL AS is_owned
    FROM public.brands AS b
    LEFT JOIN public.brand_owners AS bo ON bo.brand_id = b.id
    WHERE b.status = 'approved'
      AND b.is_demo IS NOT TRUE
      AND (filter_categories IS NULL OR b.product_type = ANY(filter_categories))
      AND (filter_tags IS NULL OR b.product_tags && filter_tags)
      AND (filter_price_ranges IS NULL OR b.price_range = ANY(filter_price_ranges))
      AND (
        filter_verification IS NULL
        OR (filter_verification = 'mit-verified' AND b.mit_status = 'verified')
        OR (filter_verification = 'mit-declared' AND b.mit_status = 'declared')
        OR (filter_verification = 'owned' AND bo.brand_id IS NOT NULL)
      )
  ),
  ranked AS (
    SELECT base.id, base.name, base.created_at, base.founding_year,
      base.fts_rank AS rank_score, 'fts'::text AS search_source
    FROM base
    WHERE base.has_fts
    UNION ALL
    SELECT base.id, base.name, base.created_at, base.founding_year,
      base.trgm_rank AS rank_score, 'trgm'::text AS search_source
    FROM base
    WHERE NOT EXISTS (SELECT 1 FROM base AS fts_base WHERE fts_base.has_fts)
      AND NOT has_cjk
      AND base.trgm_rank >= 0.25
  ),
  numbered AS (
    SELECT
      ranked.id,
      ranked.rank_score,
      ranked.search_source,
      count(*) OVER () AS total_count,
      row_number() OVER (
        ORDER BY
          CASE WHEN sort_mode = 'name' THEN ranked.name END ASC,
          CASE WHEN sort_mode = 'newest' THEN ranked.created_at END DESC,
          CASE WHEN sort_mode = 'year' THEN ranked.founding_year END DESC,
          CASE WHEN sort_mode = 'rank' THEN ranked.rank_score END DESC,
          ranked.id ASC
      ) AS row_number
    FROM ranked
  )
  SELECT numbered.id, numbered.rank_score, numbered.search_source, numbered.total_count
  FROM numbered
  WHERE numbered.row_number > page_offset
    AND numbered.row_number <= page_offset + 12
  ORDER BY numbered.row_number;
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_brands(
  search_query text,
  result_limit integer DEFAULT NULL::integer,
  prefix_mode boolean DEFAULT false,
  filter_categories text[] DEFAULT NULL::text[],
  filter_tags text[] DEFAULT NULL::text[],
  filter_verification text DEFAULT NULL::text,
  filter_status text DEFAULT 'approved'::text,
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
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  tsq tsquery;
  has_cjk boolean;
BEGIN
  IF search_query IS NULL OR char_length(search_query) > 100 THEN
    RETURN;
  END IF;

  IF prefix_mode THEN
    search_query := btrim(regexp_replace(search_query, '[!&|()<>:/''"\\*]', '', 'g'));
    IF search_query = '' THEN RETURN; END IF;
  END IF;

  tsq := public.brand_search_tsquery(search_query, prefix_mode);
  has_cjk := search_query ~ '[㐀-䶿一-鿿豈-﫿]';

  IF tsq IS NULL AND prefix_mode THEN RETURN; END IF;

  RETURN QUERY
  WITH fts_results AS (
    SELECT
      b.id, b.name, b.slug, b.hero_image_url,
      b.product_type AS primary_category_name,
      ts_rank(b.search_vector, tsq)::real AS rank_score,
      'fts'::text AS search_source
    FROM brands b
    LEFT JOIN brand_owners bo ON bo.brand_id = b.id
    WHERE tsq IS NOT NULL
      AND b.search_vector @@ tsq
      AND b.status = filter_status
      AND (include_test_brands OR b.is_demo IS NOT TRUE)
      AND (filter_categories IS NULL OR b.product_type = ANY(filter_categories))
      AND (
        filter_verification IS NULL
        OR (filter_verification = 'mit-verified' AND b.mit_status = 'verified')
        OR (filter_verification = 'mit-declared' AND b.mit_status = 'declared')
        OR (filter_verification = 'owned' AND bo.brand_id IS NOT NULL)
      )
    ORDER BY ts_rank(b.search_vector, tsq)::real DESC
    LIMIT result_limit
  ),
  trgm_results AS (
    SELECT
      b.id, b.name, b.slug, b.hero_image_url,
      b.product_type AS primary_category_name,
      public.brand_trgm_rank(
        search_query, b.name, b.product_type, b.blurb_en,
        b.product_tags, b.product_tags_en, b.description, b.slug
      ) AS rank_score,
      'trgm'::text AS search_source
    FROM brands b
    LEFT JOIN brand_owners bo ON bo.brand_id = b.id
    WHERE NOT EXISTS (SELECT 1 FROM fts_results)
      AND NOT prefix_mode
      AND NOT has_cjk
      AND public.brand_trgm_rank(
        search_query, b.name, b.product_type, b.blurb_en,
        b.product_tags, b.product_tags_en, b.description, b.slug
      ) >= 0.25
      AND b.status = filter_status
      AND (include_test_brands OR b.is_demo IS NOT TRUE)
      AND (filter_categories IS NULL OR b.product_type = ANY(filter_categories))
      AND (
        filter_verification IS NULL
        OR (filter_verification = 'mit-verified' AND b.mit_status = 'verified')
        OR (filter_verification = 'mit-declared' AND b.mit_status = 'declared')
        OR (filter_verification = 'owned' AND bo.brand_id IS NOT NULL)
      )
    ORDER BY 6 DESC
    LIMIT result_limit
  )
  SELECT * FROM fts_results
  UNION ALL
  SELECT * FROM trgm_results;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. ACLs for the new helpers
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.cjk_bigrams_bridged(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_trgm_rank(text, text, text, text, text[], text[], text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cjk_bigrams_bridged(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.brand_trgm_rank(text, text, text, text, text[], text[], text, text)
  TO service_role;
