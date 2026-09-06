-- DEV-1692 — Mirror candidate-status images through apply_brand_refresh.
--
-- The refresh function currently only carries forward 'active' images.
-- Candidate images (scored but not yet promoted) must also survive the
-- apply step so the proof artifact can show them.
--
-- Four patches:
--   (a) After the active carry-forward UPDATE, add a candidate carry-forward.
--   (b) INSERT filter: accept 'candidate' alongside 'active'.
--   (c) INSERT select: copy the submission image's own status instead of
--       hard-coding 'active'.
--   (d) ON CONFLICT: set status from the excluded row, not a literal.

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

  -- (a) After the active carry-forward UPDATE, add a candidate carry-forward.
  v_def := pg_temp.patch_exact(v_def,
    'and reference.status = ''active'';',
    'and reference.status = ''active'';

  -- Mirror candidate status from submission to brand images
  update public.brand_images as image
    set status = ''candidate''
  from public.submission_images as reference
  where reference.submission_id = p_submission_id
    and reference.origin_brand_image_id = image.id
    and reference.status = ''candidate'';',
    1, 'refresh: candidate carry-forward after active carry-forward'
  );

  -- (b) INSERT filter: accept candidate alongside active.
  v_def := pg_temp.patch_exact(v_def,
    'and image.status = ''active''
    and image.origin_brand_image_id is null',
    'and image.status in (''active'',''candidate'')
    and image.origin_brand_image_id is null',
    1, 'refresh: INSERT filter accepts candidate'
  );

  -- (c) INSERT select: copy the submission image''s own status.
  v_def := pg_temp.patch_exact(v_def,
    'v_brand.id, image.storage_path, image.url, image.source, ''active'',',
    'v_brand.id, image.storage_path, image.url, image.source, image.status,',
    1, 'refresh: INSERT select copies image.status'
  );

  -- (d) ON CONFLICT: set status from the excluded row.
  v_def := pg_temp.patch_exact(v_def,
    'status = ''active'', tags = excluded.tags,',
    'status = excluded.status, tags = excluded.tags,',
    1, 'refresh: ON CONFLICT uses excluded.status'
  );

  execute v_def;
end
$migration$;

drop function pg_temp.patch_exact(text, text, text, integer, text);

notify pgrst, 'reload schema';
