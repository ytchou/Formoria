-- Correct the CJK query semantics introduced by 20260809100000 (DEV-1413, review pass)
--
-- The bigram index was right; the QUERY construction was not. Four defects, all
-- measured against production:
--
--   1. Every bigram was ANDed, junction bigrams included, so `台灣咖啡` became
--      `台灣 & 灣咖 & 咖啡`. Requiring 灣咖 turns a search into a contiguous-substring
--      match. Chinese is normally typed without spaces, so this was the dominant
--      input shape: 0 results where 16 brands carry both terms.
--   2. A lone ideograph was left to the english parser, which emits whole runs as
--      single tokens — so `茶` became the exact token '茶', matching 1 brand of 790,
--      and ANDing it zeroed the query. `茶 咖啡` returned 0 against `咖啡`'s 39. The
--      previous file's header claimed this carve-out "keeps queries like 棱 鏡
--      working"; `棱 鏡` in fact returned 0 too.
--   3. Negation inverted. strip_cjk_runs pulled the excluded term out of the Latin
--      half, and cjk_tsquery re-added it as a REQUIRED term: `台灣 -咖啡` returned 16
--      rows, every one a coffee brand.
--   4. The trigram ladder was still evaluated for every row on the CJK path even
--      though its consumer was unreachable — `base` is referenced twice, so Postgres
--      materialises it and computes seven word_similarity() calls (one over full
--      `description`) for all 794 approved brands, then discards them. Seq scan,
--      1297 ms, against 1.9 ms for the same predicate without those columns.
--
-- Query-side segmentation is now stride-2 tiling plus a tail bigram, so every
-- character stays covered without requiring the seams BETWEEN conceptual words:
--
--   台灣咖啡 (n=4) -> 台灣 & 咖啡          (was 台灣 & 灣咖 & 咖啡)
--   小提琴   (n=3) -> 小提 & 提琴          (unchanged — still correctly 0)
--   手工皂   (n=3) -> 手工 & 工皂          (unchanged)
--
-- The index keeps ALL overlapping bigrams, so any tiled query bigram is findable.
--
-- Also fixed here: the four helpers from 20260809100000 shipped with default PUBLIC
-- EXECUTE, reopening the anon Data API surface that 20260806020000 exists to close.
-- The rationale written into that file — that revoking would break brand writes for
-- non-service roles — was wrong: only postgres and service_role hold INSERT/UPDATE on
-- public.brands, and brands_search_vector_update itself already has anon EXECUTE false.

-- ---------------------------------------------------------------------------
-- 1. Index-side bigrams: keep term frequency, make IMMUTABLE honest
-- ---------------------------------------------------------------------------
--
-- Two changes from 20260809100000:
--   * DISTINCT removed. It collapsed repeated occurrences, so a description
--     mentioning 咖啡 thirty times produced the same single lexeme as one mentioning
--     it once — CJK terms lost the frequency signal ts_rank uses and that the english
--     half of the same vector retains.
--   * ORDER BY added. `string_agg` over an unordered subquery is plan-dependent, so
--     the same input produced different token orders under HashAggregate vs
--     Sort+Unique. Because to_tsvector assigns positions in emission order and
--     ts_rank weights an AND-branch by inter-term distance, that made CJK result
--     ordering non-reproducible across a re-backfill — while the function claimed
--     IMMUTABLE, which also licenses expression indexes that would be silently wrong.
CREATE OR REPLACE FUNCTION public.cjk_bigrams(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(string_agg(bigram, ' ' ORDER BY run_ordinal, i), '')
  FROM (
    SELECT m.ordinality AS run_ordinal, i, substr(m.run[1], i, 2) AS bigram
    FROM regexp_matches(COALESCE(input, ''), '[㐀-䶿一-鿿豈-﫿]{2,}', 'g')
           WITH ORDINALITY AS m(run, ordinality),
         LATERAL generate_series(1, char_length(m.run[1]) - 1) AS i
  ) AS bigrams;
$$;

-- ---------------------------------------------------------------------------
-- 2. One tsquery builder, shared by both RPCs
-- ---------------------------------------------------------------------------
--
-- 20260809100000 duplicated this ~20-line assembly between search_brand_page and
-- search_brands, and the two had already diverged on day one (only one wrapped its
-- Latin branch in an exception handler). One function, two callers.
CREATE OR REPLACE FUNCTION public.brand_search_tsquery(
  input text,
  prefix_mode boolean DEFAULT false
)
RETURNS tsquery
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  cjk_run     constant text := '[㐀-䶿一-鿿豈-﫿]{2,}';
  cjk_char    constant text := '[㐀-䶿一-鿿豈-﫿]';
  result      tsquery := NULL;
  part        tsquery;
  captures    text[];
  run         text;
  negated     boolean;
  run_length  int;
  remainder   text;
BEGIN
  IF input IS NULL OR btrim(input) = '' THEN
    RETURN NULL;
  END IF;

  -- (a) Runs of 2+ ideographs, each optionally negated by a leading '-'.
  FOR captures IN
    SELECT regexp_matches(input, '(-?)(' || cjk_run || ')', 'g')
  LOOP
    negated := captures[1] = '-';
    run := captures[2];
    run_length := char_length(run);

    -- Stride-2 tiling (i = 1, 3, 5, …) plus the final bigram, which covers a
    -- trailing odd character without requiring any interior seam.
    SELECT to_tsquery('simple', string_agg(substr(run, i, 2), ' & ' ORDER BY i))
      INTO part
      FROM generate_series(1, run_length - 1) AS i
     WHERE i % 2 = 1 OR i = run_length - 1;

    IF part IS NOT NULL THEN
      IF negated THEN
        part := !!part;
      END IF;
      result := CASE WHEN result IS NULL THEN part ELSE result && part END;
    END IF;
  END LOOP;

  -- (b) Whatever is left once the 2+ runs are removed. Lone ideographs survive here
  --     deliberately: they produce no bigram, and handing them to the english parser
  --     yields an exact whole-run token that matches almost nothing.
  remainder := regexp_replace(input, '(-?)(' || cjk_run || ')', ' ', 'g');

  --     A lone ideograph becomes a PREFIX term, so 茶 matches the tokens 茶葉 and
  --     茶莊 — both the whole-run english lexemes and the bigram lexemes. This is
  --     what actually makes `棱 鏡` work, which the previous file only claimed.
  FOR captures IN
    SELECT regexp_matches(remainder, '(-?)(' || cjk_char || ')', 'g')
  LOOP
    part := to_tsquery('simple', captures[2] || ':*');
    IF captures[1] = '-' THEN
      part := !!part;
    END IF;
    result := CASE WHEN result IS NULL THEN part ELSE result && part END;
  END LOOP;

  remainder := btrim(regexp_replace(remainder, '(-?)' || cjk_char, ' ', 'g'));

  -- (c) The Latin remainder keeps its existing behavior, negation included.
  IF remainder <> '' THEN
    BEGIN
      IF prefix_mode THEN
        part := to_tsquery('english', regexp_replace(remainder, '\s+', ':* & ', 'g') || ':*');
      ELSE
        part := websearch_to_tsquery('english', remainder);
      END IF;
      IF part::text = '' THEN
        part := NULL;
      END IF;
    EXCEPTION WHEN others THEN
      part := NULL;
    END;

    IF part IS NOT NULL THEN
      result := CASE WHEN result IS NULL THEN part ELSE result && part END;
    END IF;
  END IF;

  RETURN result;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Cap description bigrams
-- ---------------------------------------------------------------------------
--
-- Bigramming an unbounded description tripled the stored tsvector (652 -> 1977 chars
-- average) and pushed idx_brands_search_vector to 7.6 MB for 857 rows. Description is
-- weight D — least influence on ts_rank, most tokens. The cap is generous against a
-- 220-character average, so it bites only outliers.
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
    setweight(to_tsvector('simple', public.cjk_bigrams(COALESCE(p_name, ''))), 'A') ||
    setweight(to_tsvector('simple', public.cjk_bigrams(COALESCE(array_to_string(p_product_tags, ' '), ''))), 'C') ||
    setweight(to_tsvector('simple', public.cjk_bigrams(left(COALESCE(p_description, ''), 2000))), 'D');
$$;

-- Rebuild the vectors: cjk_bigrams changed (frequency + ordering) and description is
-- now capped. brands_updated_at is BEFORE UPDATE and unconditional, so it is disabled
-- for the duration or every row's updated_at would be stamped — which feeds the
-- directory "last updated" line, sitemap lastmod, and sort=newest.
ALTER TABLE public.brands DISABLE TRIGGER brands_updated_at;

UPDATE public.brands SET search_vector = public.brands_search_document(
  name, slug, product_type, product_tags, product_tags_en, description, blurb_en
);

ALTER TABLE public.brands ENABLE TRIGGER brands_updated_at;

-- ---------------------------------------------------------------------------
-- 4. search_brand_page
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
    RAISE EXCEPTION 'page_offset must be non-negative'
      USING ERRCODE = '22023';
  END IF;

  IF sort_mode NOT IN ('rank', 'name', 'newest', 'year') THEN
    RAISE EXCEPTION 'unsupported search sort mode'
      USING ERRCODE = '22023';
  END IF;

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

  -- '-' is preserved: brand_search_tsquery handles negation for both scripts.
  sanitized_query := btrim(
    regexp_replace(normalized_query, '[!&|()<>:/''"\\*?%_]+', ' ', 'g')
  );
  IF sanitized_query = '' THEN
    RETURN;
  END IF;

  tsq := public.brand_search_tsquery(sanitized_query, false);

  -- Any ideograph at all, not just a 2+ run. Gating on "has a bigram-expandable run"
  -- left spaced queries on the trigram path: `小 木` returned 13 rows, all of them
  -- brands that merely contain 小 or 木 — the exact false-positive class this ticket
  -- was filed for. pg_trgm's character trigrams carry no meaning in Chinese at any
  -- query length, so the tier is off for every CJK query.
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
      -- Guarded, not just unused downstream: `base` is referenced twice by `ranked`,
      -- so Postgres materialises it and would evaluate all seven word_similarity
      -- calls — one over the full description — for every approved brand before
      -- discarding them. That was a seq scan at 1297 ms per CJK search.
      CASE
        WHEN has_cjk THEN 0::real
        ELSE GREATEST(
          word_similarity(sanitized_query, b.name) * 1.0,
          word_similarity(sanitized_query, COALESCE(b.product_type, '')) * 0.8,
          word_similarity(sanitized_query, COALESCE(b.blurb_en, '')) * 0.7,
          word_similarity(sanitized_query, COALESCE(array_to_string(b.product_tags, ' '), '')) * 0.6,
          word_similarity(sanitized_query, COALESCE(array_to_string(b.product_tags_en, ' '), '')) * 0.6,
          word_similarity(sanitized_query, COALESCE(b.description, '')) * 0.5,
          word_similarity(sanitized_query, COALESCE(b.slug, '')) * 0.4
        )::real
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

-- ---------------------------------------------------------------------------
-- 5. search_brands (autocomplete)
-- ---------------------------------------------------------------------------

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
  -- search_brand_page bounds its input at 100 characters; this RPC had no cap at
  -- all, so an unsanitised caller could drive cjk_tsquery to tens of thousands of
  -- ANDed nodes. Bound it the same way.
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
      AND NOT has_cjk
      AND scores.rank_score >= 0.25
      AND b.status = filter_status
      AND (include_test_brands OR b.is_demo IS NOT TRUE)
      AND (filter_categories IS NULL OR b.product_type = ANY(filter_categories))
      AND (
        filter_verification IS NULL
        OR (filter_verification = 'mit-verified' AND b.mit_status = 'verified')
        OR (filter_verification = 'mit-declared' AND b.mit_status = 'declared')
        OR (filter_verification = 'owned' AND bo.brand_id IS NOT NULL)
      )
    ORDER BY scores.rank_score DESC
    LIMIT result_limit
  )
  SELECT * FROM fts_results
  UNION ALL
  SELECT * FROM trgm_results;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Close the helper ACLs that 20260809100000 left open
-- ---------------------------------------------------------------------------
--
-- 20260806020000 revokes function EXECUTE from PUBLIC/anon/authenticated across the
-- schema precisely so new objects cannot reopen the Data API. These four were created
-- after that default and kept PUBLIC EXECUTE, so anon could call them as PostgREST
-- RPCs. Revoking is safe: only postgres and service_role hold INSERT/UPDATE on
-- public.brands, so those are the only roles whose writes fire the trigger that calls
-- brands_search_document.
REVOKE ALL ON FUNCTION public.cjk_bigrams(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.strip_cjk_runs(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cjk_tsquery(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_search_tsquery(text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brands_search_document(text, text, text, text[], text[], text, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.cjk_bigrams(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.strip_cjk_runs(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cjk_tsquery(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.brand_search_tsquery(text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.brands_search_document(text, text, text, text[], text[], text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.search_brand_page(text, text[], text[], text, integer[], integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_brand_page(text, text[], text[], text, integer[], integer, text)
  TO service_role;
