-- Origin-linked submission images reference an existing brand image and must
-- not claim ownership of that image's storage object. Repair environments
-- where request_brand_refresh drifted to copying the brand storage path.

do $migration$
declare
  v_def text;
  v_drifted text := 'v_submission_id, image.storage_path, image.url';
  v_expected text := 'v_submission_id, null, image.url';
  v_drifted_count integer;
  v_expected_count integer;
begin
  v_def := pg_get_functiondef(
    'public.request_brand_refresh(uuid,uuid,text)'::regprocedure
  );
  v_drifted_count := (length(v_def) - length(replace(v_def, v_drifted, '')))
                     / length(v_drifted);
  v_expected_count := (length(v_def) - length(replace(v_def, v_expected, '')))
                      / length(v_expected);

  if v_drifted_count = 1 and v_expected_count = 0 then
    execute replace(v_def, v_drifted, v_expected);
  elsif v_drifted_count <> 0 or v_expected_count <> 1 then
    raise exception
      'request_brand_refresh storage identity drift: drifted %, expected %',
      v_drifted_count,
      v_expected_count;
  end if;
end
$migration$;

do $verify$
declare
  v_def text;
begin
  v_def := pg_get_functiondef(
    'public.request_brand_refresh(uuid,uuid,text)'::regprocedure
  );
  if position('v_submission_id, null, image.url' in v_def) = 0
     or position('v_submission_id, image.storage_path, image.url' in v_def) > 0
  then
    raise exception 'request_brand_refresh still copies origin storage paths';
  end if;
end
$verify$;

notify pgrst, 'reload schema';
