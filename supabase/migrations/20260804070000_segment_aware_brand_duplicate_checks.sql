DROP FUNCTION IF EXISTS public.check_brand_duplicates(TEXT, TEXT, TEXT);

CREATE FUNCTION public.check_brand_duplicates(
  p_name TEXT,
  -- Retained so the pre-migration app can keep calling the RPC during rollout.
  p_ubn TEXT DEFAULT NULL,
  p_website_key TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_name_matches JSON;
  v_stripped_typed TEXT;
  v_cjk_typed TEXT;
  v_latin_typed TEXT;
  v_website_matches JSON;
BEGIN
  v_stripped_typed := lower(regexp_replace(p_name, '[[:space:][:punct:]]', '', 'g'));
  v_cjk_typed := regexp_replace(p_name, '[^一-鿿㐀-䶿]', '', 'g');
  v_latin_typed := lower(regexp_replace(p_name, '[^a-zA-Z0-9]', '', 'g'));

  SELECT json_agg(m)
  INTO v_name_matches
  FROM (
    SELECT json_build_object(
      'id', b.id,
      'name', b.name,
      'slug', b.slug,
      'similarity', best.score,
      'matched_on', best.matched_on
    ) AS m
    FROM brands b
    CROSS JOIN LATERAL (
      SELECT
        lower(regexp_replace(b.name, '[[:space:][:punct:]]', '', 'g')) AS stripped,
        regexp_replace(b.name, '[^一-鿿㐀-䶿]', '', 'g') AS cjk,
        lower(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) AS latin
    ) forms
    -- Symmetric similarity avoids containment false positives for short CJK/Latin segments;
    -- word_similarity is retained for the punctuation-insensitive full-name comparison.
    CROSS JOIN LATERAL (
      SELECT
        word_similarity(v_stripped_typed, forms.stripped) AS stripped_score,
        CASE
          WHEN length(v_cjk_typed) >= 2 AND length(forms.cjk) >= 2
            THEN similarity(v_cjk_typed, forms.cjk)
        END AS cjk_score,
        CASE
          WHEN length(v_latin_typed) >= 4 AND length(forms.latin) >= 4
            THEN similarity(v_latin_typed, forms.latin)
        END AS latin_score
    ) scores
    CROSS JOIN LATERAL (
      SELECT
        GREATEST(scores.stripped_score, scores.cjk_score, scores.latin_score) AS score,
        CASE
          WHEN scores.stripped_score = GREATEST(scores.stripped_score, scores.cjk_score, scores.latin_score) THEN 'name'
          WHEN scores.cjk_score = GREATEST(scores.stripped_score, scores.cjk_score, scores.latin_score) THEN 'cjk'
          ELSE 'latin'
        END AS matched_on
    ) best
    WHERE best.score > 0.7
      AND b.status = 'approved'
    ORDER BY best.score DESC
    LIMIT 5
  ) sub;

  SELECT json_agg(m)
  INTO v_website_matches
  FROM (
    SELECT json_build_object(
      'id', b.id,
      'name', b.name,
      'slug', b.slug,
      'similarity', 1,
      'matched_on', 'website'
    ) AS m
    FROM brands b
    WHERE p_website_key IS NOT NULL
      AND b.status = 'approved'
      AND EXISTS (
        SELECT 1
        FROM (
          SELECT candidate_url
          FROM unnest(ARRAY[
            b.purchase_website,
            b.social_instagram,
            b.social_facebook,
            b.social_threads
          ]) AS urls(candidate_url)
          WHERE candidate_url IS NOT NULL AND btrim(candidate_url) <> ''
          UNION ALL
          SELECT element ->> 'url'
          FROM jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(b.other_urls) = 'array' THEN b.other_urls
              ELSE '[]'::jsonb
            END
          ) AS elements(element)
          WHERE element ->> 'url' IS NOT NULL AND btrim(element ->> 'url') <> ''
        ) candidates
        CROSS JOIN LATERAL (
          SELECT regexp_replace(
            regexp_replace(btrim(candidates.candidate_url), '^https?://', '', 'i'),
            '[?#].*$',
            ''
          ) AS without_query
        ) normalized
        CROSS JOIN LATERAL (
          SELECT
            regexp_replace(
              lower(split_part(normalized.without_query, '/', 1)),
              '^www\.',
              '',
              'i'
            ) AS hostname,
            regexp_replace(
              coalesce(substring(normalized.without_query FROM '/.*$'), ''),
              '/+$',
              ''
            ) AS pathname
        ) parts
        WHERE parts.hostname || parts.pathname = p_website_key
      )
    ORDER BY b.name
    LIMIT 5
  ) sub;

  RETURN json_build_object(
    'name_matches', COALESCE(v_name_matches, '[]'::JSON),
    'website_matches', COALESCE(v_website_matches, '[]'::JSON)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.check_brand_duplicates(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_brand_duplicates(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_brand_duplicates(TEXT, TEXT, TEXT) TO anon;
