-- Keep canonical subcategory translations behind a final-vocabulary RPC while
-- the previous application version still writes the compatibility table.
CREATE OR REPLACE FUNCTION public.canonicalize_subcategory_translations(
  p_subcategories TEXT[],
  p_subcategories_en TEXT[]
)
RETURNS TEXT[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_index INTEGER;
  v_subcategory TEXT;
  v_translation TEXT;
  v_canonical_translation TEXT;
  v_result TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF p_subcategories IS NULL OR array_length(p_subcategories, 1) IS NULL THEN
    RETURN v_result;
  END IF;

  FOR v_index IN 1..array_length(p_subcategories, 1) LOOP
    v_subcategory := p_subcategories[v_index];
    v_translation := COALESCE(p_subcategories_en[v_index], v_subcategory);

    INSERT INTO public.product_tag_translations (tag_zh, tag_en)
    VALUES (v_subcategory, v_translation)
    ON CONFLICT (tag_zh) DO NOTHING;

    SELECT translation.tag_en
      INTO v_canonical_translation
      FROM public.product_tag_translations AS translation
     WHERE translation.tag_zh = v_subcategory;

    v_result := array_append(
      v_result,
      COALESCE(v_canonical_translation, v_subcategory)
    );
  END LOOP;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.canonicalize_subcategory_translations(TEXT[], TEXT[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canonicalize_subcategory_translations(TEXT[], TEXT[])
  TO service_role;
