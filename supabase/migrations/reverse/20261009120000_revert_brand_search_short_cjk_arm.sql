-- Reverts 20261009120000_brand_search_short_cjk_arm.sql (DEV-1991).
-- Removes the short-CJK ILIKE arm from search_brand_page and search_brands and
-- restores search_brand_page's 2-character floor. One-character CJK queries
-- (茶, 喵) return nothing again.

begin;

create or replace function pg_temp.patch_once(
  v_body text,
  v_old text,
  v_new text,
  v_label text
) returns text
language plpgsql
as $patch_once$
declare
  v_count integer;
begin
  if v_body is null then
    raise exception '%: function definition is missing', v_label;
  end if;

  v_count := (length(v_body) - length(replace(v_body, v_old, ''))) / length(v_old);
  if v_count <> 1 then
    raise exception '%: expected one anchor, found %', v_label, v_count;
  end if;

  return replace(v_body, v_old, v_new);
end
$patch_once$;

do $migration$
declare
  v_body text;
begin
  -- search_brand_page: undo (d), (c), (b), (a).
  v_body := pg_get_functiondef(
    'public.search_brand_page(text,text[],text[],text,integer,text)'::regprocedure
  );

  v_body := pg_temp.patch_once(
    v_body,
    $old$      AND base.trgm_rank >= public.brand_trgm_floor(sanitized_query)
    UNION ALL
    SELECT base.id, base.name, base.created_at, base.founding_year,
      base.ilike_rank AS rank_score, 'ilike'::text AS search_source
    FROM base
    WHERE base.ilike_rank > 0$old$,
    '      AND base.trgm_rank >= public.brand_trgm_floor(sanitized_query)',
    'search_brand_page ilike arm'
  );

  v_body := pg_temp.patch_once(
    v_body,
    '    WHERE base.has_fts AND base.ilike_rank = 0',
    '    WHERE base.has_fts',
    'search_brand_page fts arm de-duplication'
  );

  v_body := pg_temp.patch_once(
    v_body,
    $old$      -- DEV-1991: substring rank for 1-2 character CJK queries, which the
      -- bigram tsquery cannot answer for a lone ideograph.
      CASE
        WHEN has_cjk AND char_length(sanitized_query) <= 2 THEN
          CASE
            WHEN b.name ILIKE '%' || sanitized_query || '%'
              OR b.romanized_name ILIKE '%' || sanitized_query || '%'
              THEN 1.0::real
            WHEN b.blurb ILIKE '%' || sanitized_query || '%' THEN 0.6::real
            WHEN b.description ILIKE '%' || sanitized_query || '%' THEN 0.3::real
            ELSE 0::real
          END
        ELSE 0::real
      END AS ilike_rank,
      bo.brand_id IS NOT NULL AS is_owned$old$,
    '      bo.brand_id IS NOT NULL AS is_owned',
    'search_brand_page ilike_rank column'
  );

  v_body := pg_temp.patch_once(
    v_body,
    $old$    OR (char_length(normalized_query) < 2
      AND normalized_query !~ '[㐀-䶿一-鿿豈-﫿]')$old$,
    '    OR char_length(normalized_query) < 2',
    'search_brand_page length floor'
  );

  execute v_body;

  -- search_brands: undo (f), (e).
  v_body := pg_get_functiondef(
    'public.search_brands(text,integer,boolean,text[],text[],text,text,boolean)'::regprocedure
  );

  v_body := pg_temp.patch_once(
    v_body,
    $old$  ),
  -- DEV-1991: substring match for 1-2 character CJK queries. Excludes ids
  -- already in fts_results and fills only what result_limit leaves.
  ilike_results AS (
    SELECT
      b.id, b.name, b.slug, b.hero_image_url,
      b.category AS primary_category_name,
      CASE
        WHEN b.name ILIKE '%' || search_query || '%'
          OR b.romanized_name ILIKE '%' || search_query || '%'
          THEN 1.0::real
        WHEN b.blurb ILIKE '%' || search_query || '%' THEN 0.6::real
        ELSE 0.3::real
      END AS rank_score,
      'ilike'::text AS search_source
    FROM brands b
    LEFT JOIN brand_owners bo ON bo.brand_id = b.id
    WHERE has_cjk
      AND char_length(search_query) <= 2
      AND search_query !~ '[%_\\]'
      AND NOT EXISTS (SELECT 1 FROM fts_results AS f WHERE f.id = b.id)
      AND (
        b.name ILIKE '%' || search_query || '%'
        OR b.romanized_name ILIKE '%' || search_query || '%'
        OR b.blurb ILIKE '%' || search_query || '%'
        OR b.description ILIKE '%' || search_query || '%'
      )
      AND b.status = filter_status
      AND (include_test_brands OR b.is_demo IS NOT TRUE)
      AND (filter_categories IS NULL OR b.category = ANY(filter_categories))
      AND (
        filter_verification IS NULL
        OR (filter_verification = 'owned' AND bo.brand_id IS NOT NULL)
      )
    ORDER BY 6 DESC, b.name ASC, b.id ASC
    LIMIT CASE
      WHEN result_limit IS NULL THEN NULL
      ELSE greatest(result_limit - (SELECT count(*) FROM fts_results)::integer, 0)
    END
  )
  SELECT * FROM fts_results
  UNION ALL
  SELECT * FROM trgm_results
  UNION ALL
  SELECT * FROM ilike_results;$old$,
    $new$  )
  SELECT * FROM fts_results
  UNION ALL
  SELECT * FROM trgm_results;$new$,
    'search_brands ilike arm'
  );

  v_body := pg_temp.patch_once(
    v_body,
    $old$  IF tsq IS NULL AND prefix_mode
    AND NOT (has_cjk AND char_length(search_query) <= 2)
  THEN
    RETURN;
  END IF;$old$,
    '  IF tsq IS NULL AND prefix_mode THEN RETURN; END IF;',
    'search_brands null tsquery return'
  );

  execute v_body;

  if not has_function_privilege(
    'service_role',
    'public.search_brand_page(text,text[],text[],text,integer,text)'::regprocedure,
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.search_brands(text,integer,boolean,text[],text[],text,text,boolean)'::regprocedure,
    'EXECUTE'
  ) then
    raise exception 'DEV-1991 revert lost EXECUTE for service_role'
      using errcode = 'P0001';
  end if;
end
$migration$;

drop function pg_temp.patch_once(text, text, text, text);

notify pgrst, 'reload schema';

commit;
