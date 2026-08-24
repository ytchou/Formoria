-- DEV-1603: Retire alt_zh / alt_en columns
-- Uses pg_get_functiondef + regexp_replace to patch the live function bodies,
-- following the pattern established in 20260824120000.

begin;

-- 1. approve_submission — strip alt_zh/alt_en from brand_images INSERT
do $patch$
declare
  v_body text;
  v_count int;
begin
  v_body := pg_get_functiondef(
    'public.approve_submission(uuid,uuid,jsonb)'::regprocedure
  );

  -- Expect exactly 2 occurrences of 'alt_zh':
  --   1 in INSERT column list (bare alt_zh)
  --   1 in SELECT (image.alt_zh)
  v_count := (length(v_body) - length(replace(v_body, 'alt_zh', '')))
             / length('alt_zh');
  if v_count = 0 then
    raise notice 'approve_submission: alt_zh already removed — skipping';
    return;
  end if;
  if v_count <> 2 then
    raise exception 'approve_submission: expected 2 occurrences of alt_zh, found %', v_count;
  end if;

  -- Strip "image.alt_zh, image.alt_en, " from SELECT expressions
  v_body := regexp_replace(
    v_body, 'image\.alt_zh,\s*image\.alt_en,\s*', '', 'g'
  );

  -- Strip "alt_zh, alt_en, " from INSERT column list
  v_body := regexp_replace(
    v_body, 'alt_zh,\s*alt_en,\s*', '', 'g'
  );

  -- Final validation: no alt_zh or alt_en should remain
  if position('alt_zh' in v_body) > 0 then
    raise exception 'approve_submission: alt_zh references remain after patching';
  end if;
  if position('alt_en' in v_body) > 0 then
    raise exception 'approve_submission: alt_en references remain after patching';
  end if;

  execute v_body;
end $patch$;

-- 2. apply_brand_refresh_with_protected_location_gate — strip alt_zh/alt_en
do $patch$
declare
  v_body text;
  v_count int;
begin
  v_body := pg_get_functiondef(
    'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure
  );

  -- Expect exactly 8 occurrences of 'alt_zh':
  --   2 in jsonb_build_object ('alt_zh' key + image.alt_zh value)
  --   2 in UPDATE SET (alt_zh = reference.alt_zh)
  --   1 in INSERT column list (bare alt_zh)
  --   1 in INSERT SELECT (image.alt_zh)
  --   2 in ON CONFLICT SET (alt_zh = excluded.alt_zh)
  v_count := (length(v_body) - length(replace(v_body, 'alt_zh', '')))
             / length('alt_zh');
  if v_count = 0 then
    raise notice 'apply_brand_refresh: alt_zh already removed — skipping';
    return;
  end if;
  if v_count <> 8 then
    raise exception 'apply_brand_refresh: expected 8 occurrences of alt_zh, found %', v_count;
  end if;

  -- Strip "'alt_zh', image.alt_zh, 'alt_en', image.alt_en, " from jsonb_build_object
  v_body := regexp_replace(
    v_body,
    '''alt_zh'',\s*image\.alt_zh,\s*''alt_en'',\s*image\.alt_en,\s*',
    '',
    'g'
  );

  -- Strip "alt_zh = reference.alt_zh, alt_en = reference.alt_en, " from UPDATE SET
  v_body := regexp_replace(
    v_body,
    'alt_zh\s*=\s*reference\.alt_zh,\s*alt_en\s*=\s*reference\.alt_en,\s*',
    '',
    'g'
  );

  -- Strip "image.alt_zh, image.alt_en, " from INSERT SELECT
  v_body := regexp_replace(
    v_body, 'image\.alt_zh,\s*image\.alt_en,\s*', '', 'g'
  );

  -- Strip "alt_zh = excluded.alt_zh, alt_en = excluded.alt_en, " from ON CONFLICT
  v_body := regexp_replace(
    v_body,
    'alt_zh\s*=\s*excluded\.alt_zh,\s*alt_en\s*=\s*excluded\.alt_en,\s*',
    '',
    'g'
  );

  -- Strip "alt_zh, alt_en, " from INSERT column list
  v_body := regexp_replace(
    v_body, 'alt_zh,\s*alt_en,\s*', '', 'g'
  );

  -- Final validation: no alt_zh or alt_en should remain
  if position('alt_zh' in v_body) > 0 then
    raise exception 'apply_brand_refresh: alt_zh references remain after patching';
  end if;
  if position('alt_en' in v_body) > 0 then
    raise exception 'apply_brand_refresh: alt_en references remain after patching';
  end if;

  execute v_body;
end $patch$;

-- 3. Drop columns
ALTER TABLE brand_images DROP COLUMN IF EXISTS alt_zh, DROP COLUMN IF EXISTS alt_en;
ALTER TABLE submission_images DROP COLUMN IF EXISTS alt_zh, DROP COLUMN IF EXISTS alt_en;
ALTER TABLE event_exhibitors DROP COLUMN IF EXISTS image_alt_zh, DROP COLUMN IF EXISTS image_alt_en;

commit;
