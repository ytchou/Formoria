-- Remove the one residual replacement marker that had no matching source FAQ
-- category. Only Chinese JSON keys are touched; English keys remain intact.

BEGIN;

DO $$
DECLARE
  v_column text;
  v_rows integer;
  v_total integer := 0;
BEGIN
  IF to_regclass('public.brand_faq') IS NOT NULL THEN
    FOREACH v_column IN ARRAY ARRAY[
      'faq_mit', 'faq_where_to_buy', 'faq_products', 'faq_price',
      'faq_founded', 'faq_reputation', 'faq_custom_1', 'faq_custom_2',
      'faq_custom_3', 'faq_custom_4'
    ]
    LOOP
      EXECUTE format(
        'UPDATE public.brand_faq
         SET %1$I = jsonb_set(
           jsonb_set(%1$I, ''{question_zh}'', to_jsonb(replace(%1$I->>''question_zh'', chr(92) || ''1'', '''')), true),
           ''{answer_zh}'', to_jsonb(replace(%1$I->>''answer_zh'', chr(92) || ''1'', '''')), true
         ), updated_at = now()
         WHERE position(chr(92) || ''1'' in coalesce(%1$I::text, '''')) > 0',
        v_column
      );
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_total := v_total + v_rows;
    END LOOP;
  END IF;

  RAISE NOTICE 'Removed residual replacement markers from % FAQ fields', v_total;
END;
$$;

COMMIT;
