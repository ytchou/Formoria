-- Origin-linked submission images intentionally have no storage_path, and
-- their legacy url column defaults to an empty string. Treat the origin image
-- id as their stable identity so distinct snapshot rows do not collapse into
-- one empty-string value in the refresh publishability guard.

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
    'count(distinct coalesce(image.storage_path, image.url)) <> count(*)',
    'count(distinct coalesce(image.storage_path, nullif(image.url, ''''), image.origin_brand_image_id::text)) <> count(*)',
    1, 'refresh guard: origin-linked image identity'
  );

  execute v_def;
end
$migration$;

drop function pg_temp.patch_exact(text, text, text, integer, text);

do $verify$
declare
  v_def text;
begin
  v_def := pg_get_functiondef(
    'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure
  );
  if position(
    'count(distinct coalesce(image.storage_path, nullif(image.url, ''''), image.origin_brand_image_id::text)) <> count(*)'
    in v_def
  ) = 0 then
    raise exception 'refresh guard: origin-linked image identity patch was not applied';
  end if;
end
$verify$;

notify pgrst, 'reload schema';
