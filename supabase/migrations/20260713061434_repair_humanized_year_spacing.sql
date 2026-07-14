-- Repair the first humanization migration's replacement-group escaping.
-- Restore only from the audit/AI source data that was present before that migration;
-- English FAQ fields remain untouched.

BEGIN;

CREATE OR REPLACE FUNCTION public.humanize_zh_copy_fixed(p_text text)
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
  v_text := replace(v_text, '反饋', '回饋');
  v_text := replace(v_text, '信息', '資訊');
  v_text := replace(v_text, '質量', '品質');
  v_text := replace(v_text, '視頻', '影片');
  v_text := replace(v_text, '網絡', '網路');
  v_text := regexp_replace(v_text, '([0-9])年', '\1 年', 'g');
  v_text := regexp_replace(v_text, '([A-Za-z])上', '\1 上', 'g');
  v_text := regexp_replace(v_text, ' {2,}', ' ', 'g');

  RETURN btrim(v_text);
END;
$$;

DO $$
DECLARE
  v_event record;
  v_result record;
  v_item jsonb;
  v_ai jsonb;
  v_column text;
  v_new text;
  v_rows integer;
  v_description_updates integer := 0;
  v_faq_updates integer := 0;
BEGIN
  -- Restore the exact pre-migration descriptions recorded by apply_brand_patch,
  -- then run the corrected humanization rules once.
  FOR v_event IN
    SELECT brand_id, old_value #>> '{}' AS old_description
    FROM public.brand_field_events
    WHERE field = 'description'
      AND source = 'admin'
      AND created_at >= timestamptz '2026-07-13 06:12:00+00'
      AND created_at < timestamptz '2026-07-13 06:13:00+00'
  LOOP
    v_new := public.humanize_zh_copy_fixed(v_event.old_description);
    PERFORM public.apply_brand_patch(
      v_event.brand_id,
      jsonb_build_object('description', v_new),
      'admin',
      NULL,
      NULL
    );
    UPDATE public.brands SET updated_at = now() WHERE id = v_event.brand_id;
    v_description_updates := v_description_updates + 1;
  END LOOP;

  -- Rebuild only corrupted Chinese FAQ values from the original enrichment
  -- response. jsonb_set leaves question_en and answer_en unchanged.
  FOR v_result IN
    SELECT brand_id, content
    FROM (
      SELECT DISTINCT ON (brand_id)
             brand_id,
             raw_response->'response'->'choices'->0->'message'->>'content' AS content
      FROM public.brand_ai_results
      WHERE phase = 'description'
        AND raw_response->'response'->'choices'->0->'message'->>'content' IS NOT NULL
        AND brand_id IN (
        SELECT brand_id
        FROM public.brand_faq
        WHERE faq_mit::text LIKE '%' || chr(92) || '1%'
           OR faq_where_to_buy::text LIKE '%' || chr(92) || '1%'
           OR faq_products::text LIKE '%' || chr(92) || '1%'
           OR faq_price::text LIKE '%' || chr(92) || '1%'
           OR faq_founded::text LIKE '%' || chr(92) || '1%'
           OR faq_reputation::text LIKE '%' || chr(92) || '1%'
           OR faq_custom_1::text LIKE '%' || chr(92) || '1%'
           OR faq_custom_2::text LIKE '%' || chr(92) || '1%'
           OR faq_custom_3::text LIKE '%' || chr(92) || '1%'
           OR faq_custom_4::text LIKE '%' || chr(92) || '1%'
        )
      ORDER BY brand_id, created_at DESC
    ) latest_results
  LOOP
    BEGIN
      v_ai := v_result.content::jsonb;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Skipping malformed enrichment response for brand %', v_result.brand_id;
      CONTINUE;
    END;

    FOR v_item IN
      SELECT value
      FROM jsonb_array_elements(coalesce(v_ai->'faq', '[]'::jsonb))
    LOOP
      IF coalesce(v_item->>'question', '') !~ '[一-鿿]' THEN
        CONTINUE;
      END IF;

      v_column := CASE v_item->>'category'
        WHEN 'mit' THEN 'faq_mit'
        WHEN 'where_to_buy' THEN 'faq_where_to_buy'
        WHEN 'products' THEN 'faq_products'
        WHEN 'price' THEN 'faq_price'
        WHEN 'founded' THEN 'faq_founded'
        WHEN 'reputation' THEN 'faq_reputation'
        ELSE NULL
      END;

      IF v_column IS NOT NULL THEN
        EXECUTE format(
          'UPDATE public.brand_faq
           SET %1$I = jsonb_set(
             jsonb_set(%1$I, ''{question_zh}'', to_jsonb(public.humanize_zh_copy_fixed($2->>''question'')), true),
             ''{answer_zh}'', to_jsonb(public.humanize_zh_copy_fixed($2->>''answer'')), true
           ), updated_at = now()
           WHERE brand_id = $1
             AND position(chr(92) || ''1'' in coalesce(%1$I::text, '''')) > 0',
          v_column
        ) USING v_result.brand_id, v_item;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_faq_updates := v_faq_updates + v_rows;
      ELSIF v_item->>'category' = 'custom' THEN
        EXECUTE
          'UPDATE public.brand_faq
           SET faq_custom_1 = jsonb_set(
             jsonb_set(faq_custom_1, ''{question_zh}'', to_jsonb(public.humanize_zh_copy_fixed($2->>''question'')), true),
             ''{answer_zh}'', to_jsonb(public.humanize_zh_copy_fixed($2->>''answer'')), true
           ), updated_at = now()
           WHERE brand_id = $1
             AND position(chr(92) || ''1'' in coalesce(faq_custom_1::text, '''')) > 0'
        USING v_result.brand_id, v_item;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_faq_updates := v_faq_updates + v_rows;
      END IF;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Repaired % descriptions and % FAQ fields',
    v_description_updates, v_faq_updates;
END;
$$;

DROP FUNCTION public.humanize_zh_copy_fixed(text);

COMMIT;
