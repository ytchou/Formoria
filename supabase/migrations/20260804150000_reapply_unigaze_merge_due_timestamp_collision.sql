begin;

-- Renamed from 20260804100000_merge_duplicate_unigaze_brands.sql. That version
-- was already occupied remotely by the external_call_audit migration, so this
-- data migration was applied under 20260804150000 instead. The filename now
-- matches the version that actually ran.

-- DEV-1322 — merge the two duplicate UNIGAZE brand rows into one.
--
-- Two brand_submissions for the same studio, both carrying
-- website_url = https://www.instagram.com/unigaze_metalart, were approved ten
-- minutes apart on 2026-08-03 and minted two live brands:
--
--   a378682e-a570-44c0-994c-f05f28b1de2f  UNIGAZE                unigaze
--   31057ae8-2147-46ac-bbc8-9dbf9df5c5ec  UNIGAZE 慢火金工創作室  unigaze-metal-art-studio
--
-- 31057ae8 is the keeper. a378682e's enrichment ran on the bare token
-- "UNIGAZE" and described an unrelated gaze-estimation research project: its
-- description, blurb and social_instagram (instagram.com/github) all belong to
-- the wrong entity, and it carries no city, founding year, channel, FAQ or
-- purchase link. Nothing on it is worth reconciling except its images, which
-- are genuine Pinkoi product photos of the real studio.
--
-- Neither row has user-generated data (no likes, saves, owners, claim requests
-- or reports), so the merge is an image move followed by a delete. The
-- remaining children of a378682e are re-derivable enrichment artifacts
-- (brand_ai_results, brand_search_results, brand_field_state) and are allowed
-- to cascade away.
--
-- The keeper moves onto the short slug `unigaze`: its own enriched_data
-- proposed exactly that slug and only fell back to the long form because
-- a378682e had claimed `unigaze` ten minutes earlier.
--
-- Related: DEV-1321 (the name truncation that produced the short name),
-- DEV-1325 (duplicate detection never gates approval — why this pair went
-- live at all; deliberately out of scope here).

-- 1. Re-point the losing submission at the keeper before the delete, so the
--    ON DELETE SET NULL on brand_submissions.brand_id never fires and the
--    submission is not orphaned.
update public.brand_submissions
set brand_id = '31057ae8-2147-46ac-bbc8-9dbf9df5c5ec'
where id = '5878bd45-89a8-4670-b5db-b0786c3529c9'
  and brand_id = 'a378682e-a570-44c0-994c-f05f28b1de2f';

-- 2. Move the losing row's images onto the keeper, appending after the
--    keeper's existing gallery order. Images whose phash already exists on the
--    keeper are left behind to cascade away — one of the four is a byte
--    identical re-download of the same Pinkoi source. Comparing with `=`
--    rather than `is not distinct from` is deliberate: a null phash must fall
--    through to "move it" rather than "assume it is a duplicate and drop it".
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

-- 3. Delete the losing brand. Everything still attached to it at this point is
--    a re-derivable enrichment artifact or the deduplicated image.
delete from public.brands
where id = 'a378682e-a570-44c0-994c-f05f28b1de2f';

-- 4. Move the keeper onto the freed short slug. Must run after the delete —
--    `unigaze` is unique and occupied until then. The brands_search_vector
--    and updated_at triggers fire on this update, so no manual reindex.
update public.brands
set slug = 'unigaze'
where id = '31057ae8-2147-46ac-bbc8-9dbf9df5c5ec'
  and slug = 'unigaze-metal-art-studio';

-- 5. Record the slug as an admin decision so a later curation refresh does not
--    re-derive `unigaze-metal-art-studio` from the brand name and undo this.
update public.brand_field_state
set source = 'admin', updated_at = now()
where brand_id = '31057ae8-2147-46ac-bbc8-9dbf9df5c5ec'
  and field = 'slug';

-- brand_image_provenance needs no step of its own: it is a view joining
-- brand_images to brands, so its brand_slug/brand_name follow both the image
-- move in step 2 and the rename in step 4 automatically.

-- 6. Keep the retired slug resolving. Only the keeper's former slug needs a
--    redirect: `unigaze` is now the live slug and must not redirect to itself.
--    Inserted after step 4 because new_slug is a foreign key onto brands.slug.
insert into public.brand_slug_redirects (old_slug, new_slug)
values ('unigaze-metal-art-studio', 'unigaze')
on conflict (old_slug) do update
set new_slug = excluded.new_slug;

-- 7. Fail loudly rather than half-applying if the data moved underneath us.
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
