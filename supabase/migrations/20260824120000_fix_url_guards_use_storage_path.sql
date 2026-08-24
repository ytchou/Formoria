-- DEV-1592: fix image uniqueness/count guards that use url (now always '').
--
-- Migration 20260822110100_image_url_default.sql set url DEFAULT '' so that
-- TypeScript can stop writing it. This silently broke two hand-patched
-- functions whose publishable-core guards counted distinct urls:
--
-- 1. apply_brand_refresh_with_protected_location_gate:
--    `count(distinct image.url) <> count(*)` fires when every url is ''
--    because count(distinct '') = 1 while count(*) >= 2. The refresh
--    transaction rolls back — the brand description is never written.
--
-- 2. approve_submission:
--    `count(distinct image.url) < 1` and `> 10` — with all urls '', the
--    count is always 1, so the guard passes accidentally. But the INSERT
--    copies the empty url into brand_images, where the e2e test then asserts
--    it should be a path. The real fix is the same: count by storage_path,
--    the column that now carries the image identity.
--
-- Both functions are hand-patched with no source file. This migration uses
-- the safe pg_get_functiondef → replace → execute pattern to swap the column
-- reference without touching any other part of the body.

begin;

-- 1. apply_brand_refresh_with_protected_location_gate
do $patch$
declare
  v_body text;
begin
  v_body := pg_get_functiondef(
    'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure
  );

  -- The exact substring from the live function body:
  --   count(distinct image.url) <> count(*)
  -- Replace with storage_path (the column that now carries identity).
  if position('count(distinct image.url) <> count(*)' in v_body) = 0 then
    raise exception 'apply_brand_refresh: expected url guard not found — function body has diverged';
  end if;

  v_body := replace(
    v_body,
    'count(distinct image.url) <> count(*)',
    'count(distinct image.storage_path) <> count(*)'
  );

  execute v_body;
end $patch$;

-- 2. approve_submission (two occurrences of the same subquery)
do $patch$
declare
  v_body text;
  v_count int;
begin
  v_body := pg_get_functiondef(
    'public.approve_submission(uuid,uuid,jsonb)'::regprocedure
  );

  -- Count occurrences — must be exactly 2 (the < 1 and > 10 guards).
  v_count := (length(v_body) - length(replace(v_body, 'count(distinct image.url)', '')))
             / length('count(distinct image.url)');
  if v_count <> 2 then
    raise exception 'approve_submission: expected 2 occurrences of url count guard, found %', v_count;
  end if;

  v_body := replace(
    v_body,
    'count(distinct image.url)',
    'count(distinct image.storage_path)'
  );

  execute v_body;
end $patch$;

commit;
