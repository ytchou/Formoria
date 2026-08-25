-- DEV-1603: retire alt_zh / alt_en from request_brand_refresh too.
--
-- The column retirement patched the apply and approve functions but missed this
-- older refresh entry point. PostgreSQL stores the function body, so the stale
-- references only fail when an admin requests a refresh.

begin;

do $patch$
declare
  v_body text;
  v_count int;
begin
  v_body := pg_get_functiondef(
    'public.request_brand_refresh(uuid,uuid,text)'::regprocedure
  );

  v_count := (length(v_body) - length(replace(v_body, 'alt_zh', '')))
             / length('alt_zh');
  if v_count = 0 then
    raise notice 'request_brand_refresh: alt_zh already removed — skipping';
    return;
  end if;
  if v_count <> 4 then
    raise exception 'request_brand_refresh: expected 4 occurrences of alt_zh, found %', v_count;
  end if;

  -- Strip the JSON snapshot, INSERT column list, and INSERT SELECT values.
  v_body := regexp_replace(
    v_body,
    '''alt_zh'',\s*image\.alt_zh,\s*''alt_en'',\s*image\.alt_en,\s*',
    '',
    'g'
  );
  v_body := regexp_replace(v_body, 'alt_zh,\s*alt_en,\s*', '', 'g');
  v_body := regexp_replace(
    v_body, 'image\.alt_zh,\s*image\.alt_en,\s*', '', 'g'
  );

  if position('alt_zh' in v_body) > 0 then
    raise exception 'request_brand_refresh: alt_zh references remain after patching';
  end if;
  if position('alt_en' in v_body) > 0 then
    raise exception 'request_brand_refresh: alt_en references remain after patching';
  end if;

  execute v_body;
end $patch$;

commit;
