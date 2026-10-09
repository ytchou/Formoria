-- Answer one- and two-character CJK brand searches (DEV-1991 / DS2-02).
--
-- `/brands?search=茶` (and 陶, 包, 襪, 喵) returned 0 brands, even though
-- 「Miaoisland 喵島」 is listed. Two causes:
--   1. search_brand_page returned early when char_length(query) < 2.
--   2. A lone ideograph gets neither search arm: brand_search_tsquery builds
--      bigrams only from runs of 2+ ideographs (a single one becomes a whole-run
--      english token that matches almost nothing), and the trigram arm is
--      skipped for every CJK query.
--
-- This migration:
--   * search_brand_page: a 1-character query passes the floor only when it is
--     CJK. One Latin letter or digit is still rejected.
--   * search_brand_page: a new ILIKE arm for CJK queries of at most 2
--     characters (after sanitizing). It matches '%' || q || '%' over
--     name / romanized_name (rank 1.0), blurb (0.6) and description (0.3),
--     with search_source 'ilike'. No escaping: sanitizing already strips % and _.
--   * search_brands (autocomplete, prefix_mode): the same ILIKE fallback, so the
--     typeahead finds 喵島 for 喵. It skips any query that still carries a LIKE
--     wildcard or a backslash (the prefix sanitizer keeps % and _).
--
-- Arm design: UNION with the full-text arm, de-duplicated, not a fallback that
-- runs only when full text found nothing. A fallback would let one stray
-- whole-token full-text hit for 茶 suppress every substring match, which is the
-- bug this ticket fixes. Each id appears once:
--   * search_brand_page: a row with ilike_rank > 0 is admitted by the ILIKE arm
--     only; the fts arm takes `has_fts AND ilike_rank = 0`. Ranking is
--     predictable: name hits, then blurb hits, then description hits, then
--     full-text-only hits (ts_rank is well below 0.3). Filters, sort,
--     pagination and total_count are the existing CTE chain, unchanged.
--   * search_brands: ilike_results excludes ids already in fts_results and is
--     capped at result_limit minus the full-text count, so the response never
--     exceeds result_limit.
-- Effect on 2-character queries that already worked (陶瓷 -> 7): results are a
-- superset, and substring hits now sort above full-text-only hits.
--
-- Deliberate shortcut: an unindexed ILIKE scan over the filtered approved
-- brands, run only for 1-2 character CJK queries. Ceiling: fine at the current
-- catalog size (low thousands of brands); description is the longest column.
-- Upgrade path: index CJK unigrams in search_vector (or a dedicated unigram
-- GIN index), answer short queries from full text, then drop this arm.
--
-- Neither RPC has a canonical source file, so both bodies are read live with
-- pg_get_functiondef and rewritten through pg_temp.patch_once, which refuses
-- unless its anchor appears exactly once. CREATE OR REPLACE with an unchanged
-- signature keeps the ACL; the contract fingerprint and closing assertions
-- prove it.
--
-- Rollback: supabase/migrations/reverse/20261009120000_revert_brand_search_short_cjk_arm.sql
-- (reverse patch_once restoring each anchor).
--
-- Pattern: 20261008120000_brand_search_short_query_floor.sql (DEV-1970).

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

-- One text fingerprint of everything a recreate could silently change:
-- arguments, result, ACL, SECURITY DEFINER, volatility and search path.
create or replace function pg_temp.dev1991_contract(p_sig regprocedure)
returns text
language sql
as $contract$
  select concat_ws(
    ' | ',
    pg_get_function_arguments(p.oid),
    pg_get_function_result(p.oid),
    coalesce(array_to_string(p.proacl, ','), '<default>'),
    p.prosecdef::text,
    p.provolatile::text,
    coalesce(array_to_string(p.proconfig, ','), '<none>')
  )
  from pg_proc p
  where p.oid = p_sig;
$contract$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Patch both search RPCs in place
-- ─────────────────────────────────────────────────────────────────────────────

do $migration$
declare
  v_page_sig constant regprocedure :=
    'public.search_brand_page(text,text[],text[],text,integer,text)'::regprocedure;
  v_search_sig constant regprocedure :=
    'public.search_brands(text,integer,boolean,text[],text[],text,text,boolean)'::regprocedure;
  v_page_before constant text := pg_temp.dev1991_contract(
    'public.search_brand_page(text,text[],text[],text,integer,text)'::regprocedure
  );
  v_search_before constant text := pg_temp.dev1991_contract(
    'public.search_brands(text,integer,boolean,text[],text[],text,text,boolean)'::regprocedure
  );
  v_sig regprocedure;
  v_body text;
  v_role text;
begin
  -- search_brand_page ---------------------------------------------------------
  v_body := pg_get_functiondef(v_page_sig);

  -- (a) A single character passes the floor only when it is CJK.
  v_body := pg_temp.patch_once(
    v_body,
    '    OR char_length(normalized_query) < 2',
    $new$    OR (char_length(normalized_query) < 2
      AND normalized_query !~ '[㐀-䶿一-鿿豈-﫿]')$new$,
    'search_brand_page length floor'
  );

  -- (b) The ILIKE rank, computed in `base` behind a CASE so the scans run only
  --     for short CJK queries.
  v_body := pg_temp.patch_once(
    v_body,
    '      bo.brand_id IS NOT NULL AS is_owned',
    $new$      -- DEV-1991: substring rank for 1-2 character CJK queries, which the
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
      bo.brand_id IS NOT NULL AS is_owned$new$,
    'search_brand_page ilike_rank column'
  );

  -- (c) Rows the ILIKE arm admits leave the fts arm, so each id appears once.
  v_body := pg_temp.patch_once(
    v_body,
    '    WHERE base.has_fts',
    '    WHERE base.has_fts AND base.ilike_rank = 0',
    'search_brand_page fts arm de-duplication'
  );

  -- (d) The ILIKE arm, appended after the trigram arm of `ranked`.
  v_body := pg_temp.patch_once(
    v_body,
    '      AND base.trgm_rank >= public.brand_trgm_floor(sanitized_query)',
    $new$      AND base.trgm_rank >= public.brand_trgm_floor(sanitized_query)
    UNION ALL
    SELECT base.id, base.name, base.created_at, base.founding_year,
      base.ilike_rank AS rank_score, 'ilike'::text AS search_source
    FROM base
    WHERE base.ilike_rank > 0$new$,
    'search_brand_page ilike arm'
  );

  execute v_body;

  -- search_brands -------------------------------------------------------------
  v_body := pg_get_functiondef(v_search_sig);

  -- (e) A short CJK query must reach the ILIKE arm even when its tsquery is NULL.
  v_body := pg_temp.patch_once(
    v_body,
    '  IF tsq IS NULL AND prefix_mode THEN RETURN; END IF;',
    $new$  IF tsq IS NULL AND prefix_mode
    AND NOT (has_cjk AND char_length(search_query) <= 2)
  THEN
    RETURN;
  END IF;$new$,
    'search_brands null tsquery return'
  );

  -- (f) The ILIKE CTE and its place in the final UNION.
  v_body := pg_temp.patch_once(
    v_body,
    $old$  )
  SELECT * FROM fts_results
  UNION ALL
  SELECT * FROM trgm_results;$old$,
    $new$  ),
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
  SELECT * FROM ilike_results;$new$,
    'search_brands ilike arm'
  );

  execute v_body;

  -- Signature, volatility, security mode, search path and ACL are unchanged.
  if pg_temp.dev1991_contract(v_page_sig) is distinct from v_page_before then
    raise exception 'DEV-1991 search_brand_page contract drifted: % -> %',
      v_page_before, pg_temp.dev1991_contract(v_page_sig)
      using errcode = 'P0001';
  end if;
  if pg_temp.dev1991_contract(v_search_sig) is distinct from v_search_before then
    raise exception 'DEV-1991 search_brands contract drifted: % -> %',
      v_search_before, pg_temp.dev1991_contract(v_search_sig)
      using errcode = 'P0001';
  end if;

  foreach v_sig in array array[v_page_sig, v_search_sig]
  loop
    if not has_function_privilege('service_role', v_sig, 'EXECUTE') then
      raise exception 'DEV-1991 % lost EXECUTE for service_role', v_sig
        using errcode = 'P0001';
    end if;
    foreach v_role in array array['anon', 'authenticated']
    loop
      if has_function_privilege(v_role, v_sig, 'EXECUTE') then
        raise exception 'DEV-1991 % is executable by %', v_sig, v_role
          using errcode = 'P0001';
      end if;
    end loop;
  end loop;
end
$migration$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Closing assertions
-- ─────────────────────────────────────────────────────────────────────────────

do $assertions$
declare
  v_page_sig constant regprocedure :=
    'public.search_brand_page(text,text[],text[],text,integer,text)'::regprocedure;
  v_search_sig constant regprocedure :=
    'public.search_brands(text,integer,boolean,text[],text[],text,text,boolean)'::regprocedure;
  v_body text;
  v_count bigint;
begin
  -- The patched bodies carry the new arms and keep the DEV-1970 floor.
  v_body := pg_get_functiondef(v_page_sig);
  if position('AS ilike_rank' in v_body) = 0
    or position('''ilike''::text AS search_source' in v_body) = 0
    or position('WHERE base.has_fts AND base.ilike_rank = 0' in v_body) = 0
    or position('AND normalized_query !~' in v_body) = 0
  then
    raise exception 'DEV-1991 search_brand_page is missing the short-CJK arm'
      using errcode = 'P0001';
  end if;
  if position('brand_trgm_floor(sanitized_query)' in v_body) = 0 then
    raise exception 'DEV-1991 search_brand_page lost the DEV-1970 trigram floor'
      using errcode = 'P0001';
  end if;

  v_body := pg_get_functiondef(v_search_sig);
  if position('ilike_results AS (' in v_body) = 0
    or position('SELECT * FROM ilike_results;' in v_body) = 0
  then
    raise exception 'DEV-1991 search_brands is missing the short-CJK arm'
      using errcode = 'P0001';
  end if;
  if position('brand_trgm_floor(search_query)' in v_body) = 0 then
    raise exception 'DEV-1991 search_brands lost the DEV-1970 trigram floor'
      using errcode = 'P0001';
  end if;

  -- PL/pgSQL plans its SQL on first execution, so run each patched path once:
  -- a column or syntax error in the new arms fails here, not in production.
  -- Data-independent: only the row-count for a Latin character is asserted.
  select count(*) into v_count from public.search_brand_page('茶');
  select count(*) into v_count from public.search_brand_page('陶瓷');
  select count(*) into v_count from public.search_brand_page('lamp');
  select count(*) into v_count from public.search_brands('喵', 5, true);
  select count(*) into v_count from public.search_brands('陶瓷', 5, true);

  select count(*) into v_count from public.search_brand_page('a');
  if v_count <> 0 then
    raise exception 'DEV-1991 a 1-character Latin query must return nothing, got %',
      v_count using errcode = 'P0001';
  end if;

  select count(*) into v_count from public.search_brands('喵', 1, true);
  if v_count > 1 then
    raise exception 'DEV-1991 search_brands exceeded result_limit 1: %', v_count
      using errcode = 'P0001';
  end if;

  if pg_get_function_arguments(v_page_sig) is distinct from
    'search_query text, filter_categories text[] DEFAULT NULL::text[], '
    || 'filter_subcategories text[] DEFAULT NULL::text[], '
    || 'filter_verification text DEFAULT NULL::text, '
    || 'page_offset integer DEFAULT 0, sort_mode text DEFAULT ''rank''::text'
  then
    raise exception 'DEV-1991 search_brand_page argument contract drifted'
      using errcode = 'P0001';
  end if;
  if pg_get_function_arguments(v_search_sig) is distinct from
    'search_query text, result_limit integer DEFAULT NULL::integer, '
    || 'prefix_mode boolean DEFAULT false, '
    || 'filter_categories text[] DEFAULT NULL::text[], '
    || 'filter_subcategories text[] DEFAULT NULL::text[], '
    || 'filter_verification text DEFAULT NULL::text, '
    || 'filter_status text DEFAULT ''approved''::text, '
    || 'include_test_brands boolean DEFAULT false'
  then
    raise exception 'DEV-1991 search_brands argument contract drifted'
      using errcode = 'P0001';
  end if;
end
$assertions$;

drop function pg_temp.dev1991_contract(regprocedure);
drop function pg_temp.patch_once(text, text, text, text);

notify pgrst, 'reload schema';

commit;
