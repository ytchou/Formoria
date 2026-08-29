-- Fix apply_brand_refresh guard: origin-linked submission images have
-- null storage_path by constraint (origin_reference_check), but the
-- uniqueness guard (from 20260824120000) uses count(distinct storage_path)
-- which counts null as 0. Use coalesce(storage_path, url) instead.

create or replace function pg_temp.patch_exact(
  p_body text,
  p_old text,
  p_new text,
  p_expected_count integer,
  p_label text
) returns text
language plpgsql
as $patch$
declare
  v_count integer;
begin
  v_count := (length(p_body) - length(replace(p_body, p_old, '')))
             / nullif(length(p_old), 0);
  if v_count is distinct from p_expected_count then
    raise exception '% — expected % occurrences, found %',
      p_label, p_expected_count, coalesce(v_count, 0)
      using errcode = 'P0001';
  end if;
  return replace(p_body, p_old, p_new);
end
$patch$;

do $migration$
declare
  v_def text;
begin
  v_def := pg_get_functiondef(
    'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure
  );

  v_def := pg_temp.patch_exact(v_def,
    'count(distinct image.storage_path) <> count(*)',
    'count(distinct coalesce(image.storage_path, image.url)) <> count(*)',
    1, 'refresh guard: storage_path uniqueness'
  );

  execute v_def;
end
$migration$;

drop function pg_temp.patch_exact(text, text, text, integer, text);

notify pgrst, 'reload schema';
