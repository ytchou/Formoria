-- Flip brand-images back to public, now that promoteApprovedBrandImages
-- (DEV-1551) plus a daily sweep cron (DEV-1744 task 1) keep submissions/
-- residue at zero before this runs. Idempotent upsert of bucket config
-- only; no object rows are touched. Reverses 20260822110000_brand_images_private.sql.
--
-- DEPLOYMENT ORDER (availability, not privacy — this is in addition to the
-- manual submissions/-residue census named above, which is the privacy
-- precondition): this migration must be applied to a given environment
-- BEFORE, or atomically with, the code
-- deploy that carries `imagePathToUrl`'s public-URL branch
-- (`src/lib/images/image-url.ts`). If the code ships first, `imagePathToUrl`
-- starts emitting public Supabase storage URLs for a bucket that is still
-- private, and every published image on the site 400s until this file runs.
-- Railway runs no migrations against production, so on production this file is
-- applied BY HAND and that hand-application must precede the promotion deploy.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'brand-images', 'brand-images', true, 10485760,
  array['image/webp','image/jpeg','image/png','image/avif']
)
on conflict (id) do update set public = excluded.public;
