DROP FUNCTION IF EXISTS public.check_brand_duplicates(TEXT, TEXT);

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
  v_normalized_name TEXT;
  v_website_matches JSON;
BEGIN
  v_normalized_name := lower(regexp_replace(p_name, '[[:space:][:punct:]]', '', 'g'));

  SELECT json_agg(m)
  INTO v_name_matches
  FROM (
    SELECT json_build_object(
      'id', b.id,
      'name', b.name,
      'slug', b.slug,
      'similarity', word_similarity(
        v_normalized_name,
        lower(regexp_replace(b.name, '[[:space:][:punct:]]', '', 'g'))
      )
    ) AS m
    FROM brands b
    WHERE word_similarity(
      v_normalized_name,
      lower(regexp_replace(b.name, '[[:space:][:punct:]]', '', 'g'))
    ) > 0.7
      AND b.status = 'approved'
    ORDER BY word_similarity(
      v_normalized_name,
      lower(regexp_replace(b.name, '[[:space:][:punct:]]', '', 'g'))
    ) DESC
    LIMIT 5
  ) sub;

  SELECT json_agg(m)
  INTO v_website_matches
  FROM (
    SELECT json_build_object(
      'id', b.id,
      'name', b.name,
      'slug', b.slug,
      'similarity', 1
    ) AS m
    FROM brands b
    CROSS JOIN LATERAL (
      SELECT regexp_replace(
        regexp_replace(btrim(b.purchase_website), '^https?://', '', 'i'),
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
    -- Preserve the path: several approved brands legitimately share a storefront host.
    WHERE p_website_key IS NOT NULL
      AND parts.hostname || parts.pathname = p_website_key
      AND b.status = 'approved'
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
