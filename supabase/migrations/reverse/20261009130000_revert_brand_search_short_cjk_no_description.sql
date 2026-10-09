-- Reverts 20261009130000_brand_search_short_cjk_no_description.sql (DEV-1991 / R2-13).
-- A one-character CJK brand query matches descriptions again, through both the
-- full-text prefix arm and the ILIKE description branch (包 → ~229 brands).
-- Apply this before reverse/20261009120000_revert_brand_search_short_cjk_arm.sql.

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
  v_body := pg_get_functiondef(
    'public.search_brand_page(text,text[],text[],text,integer,text)'::regprocedure
  );
  v_body := pg_temp.patch_once(
    v_body,
    $old$            WHEN char_length(sanitized_query) = 2
              AND b.description ILIKE '%' || sanitized_query || '%' THEN 0.3::real$old$,
    $new$            WHEN b.description ILIKE '%' || sanitized_query || '%' THEN 0.3::real$new$,
    'search_brand_page description branch'
  );
  v_body := pg_temp.patch_once(
    v_body,
    $old$    WHERE base.has_fts AND base.ilike_rank = 0
      AND NOT (has_cjk AND char_length(sanitized_query) = 1)$old$,
    '    WHERE base.has_fts AND base.ilike_rank = 0',
    'search_brand_page fts arm single-character skip'
  );
  execute v_body;

  v_body := pg_get_functiondef(
    'public.search_brands(text,integer,boolean,text[],text[],text,text,boolean)'::regprocedure
  );
  v_body := pg_temp.patch_once(
    v_body,
    $old$        OR (char_length(search_query) = 2
          AND b.description ILIKE '%' || search_query || '%')$old$,
    $new$        OR b.description ILIKE '%' || search_query || '%'$new$,
    'search_brands description disjunct'
  );
  v_body := pg_temp.patch_once(
    v_body,
    $old$    WHERE tsq IS NOT NULL
      AND NOT (has_cjk AND char_length(search_query) = 1)
      AND b.search_vector @@ tsq$old$,
    $new$    WHERE tsq IS NOT NULL
      AND b.search_vector @@ tsq$new$,
    'search_brands fts single-character skip'
  );
  execute v_body;
end
$migration$;

drop function pg_temp.patch_once(text, text, text, text);

notify pgrst, 'reload schema';

commit;
