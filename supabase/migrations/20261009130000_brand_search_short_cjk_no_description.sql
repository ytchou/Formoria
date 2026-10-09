-- One-character brand search no longer matches descriptions (DEV-1991 / R2-13).
--
-- 20261009120000_brand_search_short_cjk_arm.sql ranks a 1-2 character CJK
-- query over name / romanized_name (1.0), blurb (0.6) and description (0.3).
-- For one character the description arm matches too much: 包 hits 包裝 / 包含
-- / 包覆 in long descriptions and returned 225 of 329 brands on staging.
--
-- Two arms let a single ideograph match far more than its name or blurb:
--   1. The full-text arm. brand_search_tsquery turns a lone ideograph into the
--      prefix query '包':*, which matches every indexed lexeme starting with 包,
--      description text included: 220 of the 229 staging hits.
--   2. The ILIKE arm's description branch (包裝, 包含, 包覆).
--
-- For a 1-character CJK query this migration answers from the ILIKE arm only
-- (name, romanized_name, blurb) in both RPCs. Two-character queries keep the
-- full-text arm and the description branch.
--   * search_brand_page: the fts arm skips a 1-character CJK query, and the
--     `ilike_rank` CASE gates its description branch to 2 characters.
--   * search_brands (typeahead): fts_results skips a 1-character CJK query, and
--     the ilike_results WHERE gates its description disjunct. Its rank CASE has
--     no description branch (ELSE 0.3), so a row reaches it only through the
--     gated disjunct.
--
-- Same mechanism as 20261009120000: bodies are read live and rewritten through
-- pg_temp.patch_once, which refuses unless its anchor appears exactly once.
--
-- Rollback: supabase/migrations/reverse/20261009130000_revert_brand_search_short_cjk_no_description.sql.
-- Apply it before the 20261009120000 reverse, whose anchors expect the
-- ungated description lines.

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
  v_body text;
begin
  v_body := pg_get_functiondef(v_page_sig);
  v_body := pg_temp.patch_once(
    v_body,
    $old$            WHEN b.description ILIKE '%' || sanitized_query || '%' THEN 0.3::real$old$,
    $new$            WHEN char_length(sanitized_query) = 2
              AND b.description ILIKE '%' || sanitized_query || '%' THEN 0.3::real$new$,
    'search_brand_page description branch'
  );
  v_body := pg_temp.patch_once(
    v_body,
    '    WHERE base.has_fts AND base.ilike_rank = 0',
    $new$    WHERE base.has_fts AND base.ilike_rank = 0
      AND NOT (has_cjk AND char_length(sanitized_query) = 1)$new$,
    'search_brand_page fts arm single-character skip'
  );
  execute v_body;

  v_body := pg_get_functiondef(v_search_sig);
  v_body := pg_temp.patch_once(
    v_body,
    $old$        OR b.description ILIKE '%' || search_query || '%'$old$,
    $new$        OR (char_length(search_query) = 2
          AND b.description ILIKE '%' || search_query || '%')$new$,
    'search_brands description disjunct'
  );
  v_body := pg_temp.patch_once(
    v_body,
    $old$    WHERE tsq IS NOT NULL
      AND b.search_vector @@ tsq$old$,
    $new$    WHERE tsq IS NOT NULL
      AND NOT (has_cjk AND char_length(search_query) = 1)
      AND b.search_vector @@ tsq$new$,
    'search_brands fts single-character skip'
  );
  execute v_body;

  if pg_temp.dev1991_contract(v_page_sig) is distinct from v_page_before then
    raise exception 'R2-13 search_brand_page contract drifted' using errcode = 'P0001';
  end if;
  if pg_temp.dev1991_contract(v_search_sig) is distinct from v_search_before then
    raise exception 'R2-13 search_brands contract drifted' using errcode = 'P0001';
  end if;
end
$migration$;

do $assertions$
declare
  v_count bigint;
begin
  if position('WHEN char_length(sanitized_query) = 2' in pg_get_functiondef(
    'public.search_brand_page(text,text[],text[],text,integer,text)'::regprocedure
  )) = 0 then
    raise exception 'R2-13 search_brand_page description gate missing' using errcode = 'P0001';
  end if;
  if position('AND NOT (has_cjk AND char_length(sanitized_query) = 1)' in pg_get_functiondef(
    'public.search_brand_page(text,text[],text[],text,integer,text)'::regprocedure
  )) = 0 then
    raise exception 'R2-13 search_brand_page fts skip missing' using errcode = 'P0001';
  end if;
  if position('OR (char_length(search_query) = 2' in pg_get_functiondef(
    'public.search_brands(text,integer,boolean,text[],text[],text,text,boolean)'::regprocedure
  )) = 0 then
    raise exception 'R2-13 search_brands description gate missing' using errcode = 'P0001';
  end if;
  if position('AND NOT (has_cjk AND char_length(search_query) = 1)' in pg_get_functiondef(
    'public.search_brands(text,integer,boolean,text[],text[],text,text,boolean)'::regprocedure
  )) = 0 then
    raise exception 'R2-13 search_brands fts skip missing' using errcode = 'P0001';
  end if;

  -- Plan each patched path once, so a syntax error fails here.
  select count(*) into v_count from public.search_brand_page('包');
  select count(*) into v_count from public.search_brand_page('陶瓷');
  select count(*) into v_count from public.search_brands('包', 5, true);
  select count(*) into v_count from public.search_brands('陶瓷', 5, true);
end
$assertions$;

drop function pg_temp.dev1991_contract(regprocedure);
drop function pg_temp.patch_once(text, text, text, text);

notify pgrst, 'reload schema';

commit;
