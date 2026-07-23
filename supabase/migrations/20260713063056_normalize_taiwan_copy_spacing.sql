-- Apply the requested Taiwan wording and spacing corrections to Chinese copy.
-- English fields are deliberately not selected or rewritten.

BEGIN;

CREATE OR REPLACE FUNCTION public.normalize_taiwan_zh_copy(p_text text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_text text := p_text;
BEGIN
  IF v_text IS NULL THEN
    RETURN NULL;
  END IF;

  v_text := replace(v_text, '全省', '全台');
  v_text := replace(v_text, '0 年', '0年');
  v_text := replace(v_text, '1 年', '1年');
  v_text := replace(v_text, '2 年', '2年');
  v_text := replace(v_text, '3 年', '3年');
  v_text := replace(v_text, '4 年', '4年');
  v_text := replace(v_text, '5 年', '5年');
  v_text := replace(v_text, '6 年', '6年');
  v_text := replace(v_text, '7 年', '7年');
  v_text := replace(v_text, '8 年', '8年');
  v_text := replace(v_text, '9 年', '9年');

  RETURN v_text;
END;
$$;

DO $$
DECLARE
  v_brand record;
  v_new_description text;
  v_column text;
  v_rows integer;
  v_description_updates integer := 0;
  v_faq_updates integer := 0;
BEGIN
  FOR v_brand IN
    SELECT id, description
    FROM public.brands
    WHERE status = 'approved'
      AND description IS NOT NULL
  LOOP
    v_new_description := public.normalize_taiwan_zh_copy(v_brand.description);
    IF v_new_description IS DISTINCT FROM v_brand.description THEN
      PERFORM public.apply_brand_patch(
        v_brand.id,
        jsonb_build_object('description', v_new_description),
        'admin',
        NULL,
        NULL
      );
      UPDATE public.brands SET updated_at = now() WHERE id = v_brand.id;
      v_description_updates := v_description_updates + 1;
    END IF;
  END LOOP;

  IF to_regclass('public.brand_faq') IS NOT NULL THEN
    FOREACH v_column IN ARRAY ARRAY[
      'faq_mit', 'faq_products', 'faq_where_to_buy', 'faq_price',
      'faq_founded', 'faq_reputation', 'faq_custom_1', 'faq_custom_2',
      'faq_custom_3', 'faq_custom_4'
    ]
    LOOP
      EXECUTE format(
        'UPDATE public.brand_faq
         SET %1$I = jsonb_set(
           jsonb_set(%1$I, ''{question_zh}'', to_jsonb(public.normalize_taiwan_zh_copy(%1$I->>''question_zh'')), true),
           ''{answer_zh}'', to_jsonb(public.normalize_taiwan_zh_copy(%1$I->>''answer_zh'')), true
         ), updated_at = now()
         WHERE %1$I IS NOT NULL
           AND (%1$I->>''question_zh'' IS DISTINCT FROM public.normalize_taiwan_zh_copy(%1$I->>''question_zh'')
             OR %1$I->>''answer_zh'' IS DISTINCT FROM public.normalize_taiwan_zh_copy(%1$I->>''answer_zh''))',
        v_column
      );
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_faq_updates := v_faq_updates + v_rows;
    END LOOP;
  END IF;

  RAISE NOTICE 'Normalized % descriptions and % FAQ fields',
    v_description_updates, v_faq_updates;
END;
$$;

DROP FUNCTION public.normalize_taiwan_zh_copy(text);

COMMIT;
