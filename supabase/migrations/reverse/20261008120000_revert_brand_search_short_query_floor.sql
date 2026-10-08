-- Reverts 20261008120000_brand_search_short_query_floor.sql
-- Restores the fixed 0.25 trigram floor in search_brand_page and
-- search_brands, then drops public.brand_trgm_floor (DEV-1970).
-- Short and repeated-character queries (zzzz, aaaa) match again.

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
begin
  execute pg_temp.patch_once(
    pg_get_functiondef(
      'public.search_brand_page(text,text[],text[],text,integer,text)'::regprocedure
    ),
    '      AND base.trgm_rank >= public.brand_trgm_floor(sanitized_query)',
    '      AND base.trgm_rank >= 0.25',
    'search_brand_page trigram floor'
  );

  execute pg_temp.patch_once(
    pg_get_functiondef(
      'public.search_brands(text,integer,boolean,text[],text[],text,text,boolean)'::regprocedure
    ),
    '      ) >= public.brand_trgm_floor(search_query)',
    '      ) >= 0.25',
    'search_brands trigram floor'
  );
end
$migration$;

-- PL/pgSQL bodies are not dependency-tracked, so the patches above must run
-- first: dropping the helper earlier would break both RPCs at call time.
drop function public.brand_trgm_floor(text);

drop function pg_temp.patch_once(text, text, text, text);

notify pgrst, 'reload schema';

commit;
