-- Humanize the catalog's existing Traditional Chinese copy without changing
-- English fields, names, URLs, numbers, or the underlying schema.

BEGIN;

CREATE OR REPLACE FUNCTION public.humanize_zh_copy(p_text text)
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

  -- Remove recurring template openings and abstract AI-style phrasing.
  v_text := replace(v_text, '是的，', '');
  v_text := replace(v_text, '目前公開資料中未明確提及', '公開資料未提到');
  v_text := replace(v_text, '目前公開資料未明確提及', '公開資料未提到');
  v_text := replace(v_text, '具體成立年份未公開', '成立年份未公開');
  v_text := replace(v_text, '確切成立年份未公開', '成立年份未公開');
  v_text := replace(v_text, '產品線涵蓋', '產品有');
  v_text := replace(v_text, '主要產品包括', '主要產品有');
  v_text := replace(v_text, '可透過', '可在');
  v_text := replace(v_text, '目前主要透過', '目前主要在');
  v_text := replace(v_text, '致力於', '專注於');
  v_text := replace(v_text, '品牌秉持', '品牌堅持');
  v_text := replace(v_text, '展現了', '呈現');
  v_text := replace(v_text, '展現', '呈現');
  v_text := replace(v_text, '傳遞', '傳達');
  v_text := replace(v_text, '廣受好評', '受到好評');
  v_text := replace(v_text, '擁有良好口碑', '受到好評');
  v_text := replace(v_text, '口碑良好', '受到好評');
  v_text := replace(v_text, '被網友譽為', '網友稱為');
  v_text := replace(v_text, '屬於中價位品牌', '價格落在中價位');
  v_text := replace(v_text, '具體地點請洽詢品牌', '詳細地點請洽品牌');

  -- Taiwan localization and readable spacing around common Latin terms.
  v_text := replace(v_text, '反饋', '回饋');
  v_text := replace(v_text, '信息', '資訊');
  v_text := replace(v_text, '質量', '品質');
  v_text := replace(v_text, '視頻', '影片');
  v_text := replace(v_text, '網絡', '網路');
  v_text := regexp_replace(v_text, '([0-9])年', '\\1 年', 'g');
  v_text := regexp_replace(v_text, '([A-Za-z])上', '\\1 上', 'g');
  v_text := regexp_replace(v_text, ' {2,}', ' ', 'g');

  RETURN btrim(v_text);
END;
$$;

DO $$
DECLARE
  v_brand record;
  v_new_description text;
  v_description_updates integer := 0;
  v_faq_updates integer := 0;
  v_column text;
  v_rows integer;
BEGIN
  FOR v_brand IN
    SELECT id, description
    FROM public.brands
    WHERE status = 'approved'
      AND description IS NOT NULL
  LOOP
    v_new_description := public.humanize_zh_copy(v_brand.description);
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
           jsonb_set(%1$I, ''{question_zh}'', to_jsonb(public.humanize_zh_copy(%1$I->>''question_zh'')), true),
           ''{answer_zh}'', to_jsonb(public.humanize_zh_copy(%1$I->>''answer_zh'')), true
         ), updated_at = now()
         WHERE %1$I IS NOT NULL',
        v_column
      );
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_faq_updates := v_faq_updates + v_rows;
    END LOOP;
  END IF;

  RAISE NOTICE 'Humanized % brand descriptions and % FAQ fields',
    v_description_updates, v_faq_updates;
END;
$$;

DROP FUNCTION public.humanize_zh_copy(text);

COMMIT;
