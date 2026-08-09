-- Make Chinese search work: CJK bigram tokens in the tsvector (DEV-1413)
--
-- Postgres has no CJK segmentation under the `english` config, so a Chinese run is
-- one indivisible token:
--
--   to_tsvector('english','SCENT FOREST 香氛森林')  ->  'forest':2 'scent':1 '香氛森林':3
--   websearch_to_tsquery('english','香氛')          ->  '香氛'          -- no match
--
-- A multi-character Chinese brand name was therefore findable only by typing it in
-- full: 香氛 matched 1 of 60 fragrance brands, 皮革 1 of 51. Separately, when FTS
-- found nothing the RPCs fell back to word_similarity >= 0.25, and a 3-character CJK
-- query has exactly 4 trigrams — so sharing the single leading "  小" shingle scores
-- exactly 0.2500 and cleared an inclusive threshold. That is why 小提琴 (violin)
-- returned 9 brands, every one of them merely starting with 小.
--
-- Fix: expand every run of 2+ CJK characters into overlapping 2-character bigrams,
-- appended to search_vector at its source field's weight and ANDed on the query side.
--
--   香氛森林  ->  香氛 氛森 森林      (index)
--   香氛      ->  香氛                (query)  matches
--   小提琴    ->  小提 & 提琴          (query)  matches nothing, which is correct
--
-- The vector change is purely ADDITIVE — every existing clause is retained, so every
-- query that matched before still matches. Only recall grows.

-- ---------------------------------------------------------------------------
-- 1. CJK helpers
-- ---------------------------------------------------------------------------

-- Runs of 2+ ideographs. Deliberately excludes single characters: a 1-character run
-- yields no bigram, and must be left for the `english` tier to prefix-match against
-- the whole-run token (this is what keeps queries like `棱 鏡` working).
CREATE OR REPLACE FUNCTION public.cjk_bigrams(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(string_agg(bigram, ' '), '')
  FROM (
    SELECT DISTINCT substr(m[1], i, 2) AS bigram
    FROM regexp_matches(COALESCE(input, ''), '[㐀-䶿一-鿿豈-﫿]{2,}', 'g') AS m,
         LATERAL generate_series(1, char_length(m[1]) - 1) AS i
  ) AS bigrams;
$$;

-- ANDed bigram query. NULL when the input holds no run of 2+ ideographs, which is the
-- signal every caller uses to mean "this query has no CJK component".
CREATE OR REPLACE FUNCTION public.cjk_tsquery(input text)
RETURNS tsquery
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT to_tsquery('simple', string_agg(bigram, ' & '))
  FROM (
    SELECT DISTINCT substr(m[1], i, 2) AS bigram
    FROM regexp_matches(COALESCE(input, ''), '[㐀-䶿一-鿿豈-﫿]{2,}', 'g') AS m,
         LATERAL generate_series(1, char_length(m[1]) - 1) AS i
  ) AS bigrams;
$$;

-- Removes ONLY the runs that cjk_bigrams expanded, so the remainder can be handed to
-- the english parser without it re-emitting an unmatchable whole-run token. Single
-- ideographs survive here on purpose — see the note on cjk_bigrams.
CREATE OR REPLACE FUNCTION public.strip_cjk_runs(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT btrim(regexp_replace(COALESCE(input, ''), '[㐀-䶿一-鿿豈-﫿]{2,}', ' ', 'g'));
$$;

-- ---------------------------------------------------------------------------
-- 2. One search document expression, shared by the trigger and the backfill
-- ---------------------------------------------------------------------------
--
-- Previously the expression was duplicated between the trigger body and the backfill
-- statement, so the two could drift silently. Extracting it means a future field
-- change has exactly one place to land.
--
-- Bigrams are added for name (A), product_tags (C), and description (D) only. slug,
-- product_type, product_tags_en, and blurb_en are Latin by construction.
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
    setweight(to_tsvector('simple', public.cjk_bigrams(COALESCE(p_description, ''))), 'D');
$$;

CREATE OR REPLACE FUNCTION public.brands_search_vector_update()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  NEW.search_vector := public.brands_search_document(
    NEW.name, NEW.slug, NEW.product_type,
    NEW.product_tags, NEW.product_tags_en,
    NEW.description, NEW.blurb_en
  );
  RETURN NEW;
END;
$$;

-- The trigger's UPDATE OF list is the silent-failure surface: a bigram source outside
-- it would let rows update without reindexing and raise nothing. name, product_tags,
-- and description are all already on it, so the list is unchanged and restated here
-- only so this migration is self-describing.
DROP TRIGGER IF EXISTS brands_search_vector_trigger ON public.brands;
CREATE TRIGGER brands_search_vector_trigger
  BEFORE INSERT OR UPDATE OF name, slug, product_type, product_tags, product_tags_en, description, blurb_en
  ON public.brands
  FOR EACH ROW
  EXECUTE FUNCTION public.brands_search_vector_update();

-- ---------------------------------------------------------------------------
-- 3. Backfill
-- ---------------------------------------------------------------------------
--
-- brands_updated_at is BEFORE UPDATE and unconditional, so a naive backfill would
-- stamp updated_at = now() on every row — which feeds the directory's "last updated"
-- line, sitemap lastmod, and sort=newest. Disable it for the duration.
ALTER TABLE public.brands DISABLE TRIGGER brands_updated_at;

UPDATE public.brands SET search_vector = public.brands_search_document(
  name, slug, product_type, product_tags, product_tags_en, description, blurb_en
);

ALTER TABLE public.brands ENABLE TRIGGER brands_updated_at;

-- ---------------------------------------------------------------------------
-- 4. search_brand_page — the public directory results RPC
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
  latin_part text;
  latin_tsq tsquery;
  cjk_tsq tsquery;
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

  IF sort_mode NOT IN ('rank', 'name', 'newest', 'year') THEN
    RAISE EXCEPTION 'unsupported search sort mode'
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

  -- Two tsqueries, ANDed. The CJK half matches bigram tokens; the Latin half keeps
  -- the existing english behavior for everything else, including single ideographs
  -- that strip_cjk_runs deliberately leaves behind.
  cjk_tsq := public.cjk_tsquery(sanitized_query);
  latin_part := public.strip_cjk_runs(sanitized_query);

  BEGIN
    IF latin_part <> '' THEN
      latin_tsq := websearch_to_tsquery('english', latin_part);
      IF latin_tsq::text = '' THEN
        latin_tsq := NULL;
      END IF;
    END IF;
  EXCEPTION WHEN others THEN
    latin_tsq := NULL;
  END;

  IF latin_tsq IS NOT NULL AND cjk_tsq IS NOT NULL THEN
    tsq := latin_tsq && cjk_tsq;
  ELSIF cjk_tsq IS NOT NULL THEN
    tsq := cjk_tsq;
  ELSE
    tsq := latin_tsq;
  END IF;

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
    SELECT base.id, base.name, base.created_at, base.founding_year,
      base.fts_rank AS rank_score, 'fts'::text AS search_source
    FROM base
    WHERE base.has_fts
    UNION ALL
    -- The trigram tier is skipped entirely for queries with a CJK component. Bigram
    -- FTS now covers CJK recall, and pg_trgm's character trigrams carry no meaning in
    -- Chinese: a 3-character query has 4 trigrams, so one shared leading character
    -- scores exactly the 0.25 threshold. That overlap produced the 小提琴 false
    -- positives. Latin queries keep the tier, and with it their typo tolerance.
    SELECT base.id, base.name, base.created_at, base.founding_year,
      base.trgm_rank AS rank_score, 'trgm'::text AS search_source
    FROM base
    WHERE NOT EXISTS (SELECT 1 FROM base AS fts_base WHERE fts_base.has_fts)
      AND cjk_tsq IS NULL
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
-- 5. search_brands — the autocomplete RPC
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
  latin_part text;
  latin_tsq tsquery;
  cjk_tsq tsquery;
  tsq tsquery;
BEGIN
  IF prefix_mode THEN
    search_query := regexp_replace(search_query, '[!&|()<>:/''"\\*]', '', 'g');
    search_query := trim(both from search_query);
    IF search_query = '' THEN RETURN; END IF;
  END IF;

  cjk_tsq := public.cjk_tsquery(search_query);
  latin_part := public.strip_cjk_runs(search_query);

  IF latin_part <> '' THEN
    IF prefix_mode THEN
      -- `:*` applies to the Latin half only. CJK bigrams are whole tokens; prefix
      -- matching them would re-admit the partial-overlap noise bigrams exist to stop.
      latin_tsq := to_tsquery('english', regexp_replace(latin_part, '\s+', ':* & ', 'g') || ':*');
    ELSE
      latin_tsq := websearch_to_tsquery('english', latin_part);
    END IF;
    IF latin_tsq::text = '' THEN
      latin_tsq := NULL;
    END IF;
  END IF;

  IF latin_tsq IS NOT NULL AND cjk_tsq IS NOT NULL THEN
    tsq := latin_tsq && cjk_tsq;
  ELSIF cjk_tsq IS NOT NULL THEN
    tsq := cjk_tsq;
  ELSE
    tsq := latin_tsq;
  END IF;

  IF tsq IS NULL AND prefix_mode THEN RETURN; END IF;

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
      AND cjk_tsq IS NULL
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
EXCEPTION
  WHEN others THEN
    -- Third copy of the ladder, reachable only when tsquery construction throws.
    -- It carries the same CJK guard, or a thrown query would silently fall back to
    -- exactly the character-overlap noise this migration removes.
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
      AND public.cjk_tsquery(search_query) IS NULL
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
    LIMIT result_limit;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Re-assert ACLs
-- ---------------------------------------------------------------------------
--
-- The four helpers above keep Postgres's default EXECUTE-to-PUBLIC, deliberately.
-- They are pure text/tsvector functions that read no rows, so they expose nothing —
-- and brands_search_vector_update() calls brands_search_document() as the *invoking*
-- role, so revoking it would break brand writes for every non-service role.
--
-- search_brand_page is the opposite case: it is SECURITY DEFINER over the whole
-- brands table, so its service-role-only contract (20260806010000 / 20260806020000)
-- is restated here. Project history: dropping a public function re-applies Supabase's
-- default privileges to anon, and revoking from `public` does not undo a grant made
-- to a named role — so both are spelled out.
REVOKE ALL ON FUNCTION public.search_brand_page(text, text[], text[], text, integer[], integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_brand_page(text, text[], text[], text, integer[], integer, text) FROM anon;
REVOKE ALL ON FUNCTION public.search_brand_page(text, text[], text[], text, integer[], integer, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.search_brand_page(text, text[], text[], text, integer[], integer, text) TO service_role;
