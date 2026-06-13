CREATE OR REPLACE FUNCTION check_brand_duplicates(
  p_name TEXT,
  p_ubn TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ubn_match JSON;
  v_name_matches JSON;
  v_normalized TEXT;
BEGIN
  v_normalized := lower(regexp_replace(p_name, '[[:space:][:punct:]]', '', 'g'));

  IF p_ubn IS NOT NULL AND p_ubn <> '' THEN
    SELECT json_build_object('id', id, 'name', name, 'slug', slug)
    INTO v_ubn_match
    FROM brands
    WHERE unified_business_number = p_ubn
    LIMIT 1;
  END IF;

  SELECT json_agg(m)
  INTO v_name_matches
  FROM (
    SELECT json_build_object(
      'id', b.id,
      'name', b.name,
      'slug', b.slug,
      'similarity', word_similarity(
        v_normalized,
        lower(regexp_replace(b.name, '[[:space:][:punct:]]', '', 'g'))
      )
    ) AS m
    FROM brands b
    WHERE word_similarity(
      v_normalized,
      lower(regexp_replace(b.name, '[[:space:][:punct:]]', '', 'g'))
    ) > 0.7
    ORDER BY word_similarity(
      v_normalized,
      lower(regexp_replace(b.name, '[[:space:][:punct:]]', '', 'g'))
    ) DESC
    LIMIT 5
  ) sub;

  RETURN json_build_object(
    'ubn_match', v_ubn_match,
    'name_matches', COALESCE(v_name_matches, '[]'::JSON)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION check_brand_duplicates(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION check_brand_duplicates(TEXT, TEXT) TO anon;
