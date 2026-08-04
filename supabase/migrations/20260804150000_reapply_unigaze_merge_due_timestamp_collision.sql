-- Reconstructed from the remote ledger on 2026-08-05 (DEV-1316 audit-logging branch).
--
-- WHY THIS FILE EXISTS. DEV-1322's brand-merge data migration was authored as
-- 20260804100000_merge_duplicate_unigaze_brands.sql, but that version number was
-- already occupied remotely by this branch's 20260804100000_external_call_audit.sql
-- (pushed first). Supabase matches ledger rows by VERSION, not by name, so the
-- unigaze file was silently treated as already applied and its data change never ran.
--
-- It was therefore re-applied out of band under this unique version. That left a
-- remote ledger row with no local file, which makes every subsequent
-- `supabase db push` fail with LegacyDbPushMissingLocalError. This file closes
-- that gap; it is already applied remotely and will NOT be re-executed by a push.
--
-- The statements below are copied verbatim from supabase_migrations.schema_migrations.
-- Do not "clean them up" - they must stay byte-faithful to what actually ran.
--
-- Process lesson: two branches picking the same YYYYMMDDHHMMSS is not a merge
-- conflict, it is a silent skip. Prefer a minute-precision timestamp taken at
-- authoring time over a round number like 100000.

begin;

update public.brand_submissions
set brand_id = '31057ae8-2147-46ac-bbc8-9dbf9df5c5ec'
where id = '5878bd45-89a8-4670-b5db-b0786c3529c9'
  and brand_id = 'a378682e-a570-44c0-994c-f05f28b1de2f';

with keeper_gallery as (
  select coalesce(max(sort_order), -1) as max_sort_order
  from public.brand_images
  where brand_id = '31057ae8-2147-46ac-bbc8-9dbf9df5c5ec'
),
movable as (
  select
    losing_image.id,
    row_number() over (order by losing_image.sort_order, losing_image.created_at) as offset_rank
  from public.brand_images as losing_image
  where losing_image.brand_id = 'a378682e-a570-44c0-994c-f05f28b1de2f'
    and not exists (
      select 1
      from public.brand_images as keeper_image
      where keeper_image.brand_id = '31057ae8-2147-46ac-bbc8-9dbf9df5c5ec'
        and keeper_image.phash = losing_image.phash
    )
)
update public.brand_images as image
set
  brand_id = '31057ae8-2147-46ac-bbc8-9dbf9df5c5ec',
  sort_order = keeper_gallery.max_sort_order + movable.offset_rank
from movable, keeper_gallery
where image.id = movable.id;

delete from public.brands
where id = 'a378682e-a570-44c0-994c-f05f28b1de2f';

update public.brands
set slug = 'unigaze'
where id = '31057ae8-2147-46ac-bbc8-9dbf9df5c5ec'
  and slug = 'unigaze-metal-art-studio';

update public.brand_field_state
set source = 'admin', updated_at = now()
where brand_id = '31057ae8-2147-46ac-bbc8-9dbf9df5c5ec'
  and field = 'slug';

insert into public.brand_slug_redirects (old_slug, new_slug)
values ('unigaze-metal-art-studio', 'unigaze')
on conflict (old_slug) do update
set new_slug = excluded.new_slug;

do $$
declare
  keeper_slug text;
  keeper_images integer;
  survivors integer;
  orphan_submissions integer;
begin
  select slug into keeper_slug
  from public.brands
  where id = '31057ae8-2147-46ac-bbc8-9dbf9df5c5ec';

  if keeper_slug is distinct from 'unigaze' then
    raise exception 'DEV-1322: keeper slug is %, expected unigaze', keeper_slug;
  end if;

  select count(*) into survivors
  from public.brands
  where id = 'a378682e-a570-44c0-994c-f05f28b1de2f';

  if survivors <> 0 then
    raise exception 'DEV-1322: losing brand row still present';
  end if;

  select count(*) into keeper_images
  from public.brand_images
  where brand_id = '31057ae8-2147-46ac-bbc8-9dbf9df5c5ec';

  if keeper_images < 3 then
    raise exception 'DEV-1322: keeper has only % images, expected at least 3', keeper_images;
  end if;

  select count(*) into orphan_submissions
  from public.brand_submissions
  where id in (
    'af9ca166-ed30-4288-8815-b3e46b0fb664',
    '5878bd45-89a8-4670-b5db-b0786c3529c9'
  )
  and brand_id is distinct from '31057ae8-2147-46ac-bbc8-9dbf9df5c5ec';

  if orphan_submissions <> 0 then
    raise exception 'DEV-1322: % submission(s) not pointing at the keeper', orphan_submissions;
  end if;
end $$;

commit;
