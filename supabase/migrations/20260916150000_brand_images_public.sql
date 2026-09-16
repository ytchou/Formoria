-- Flip brand-images back to public, now that promoteApprovedBrandImages
-- (DEV-1551) plus a daily sweep cron (DEV-1744 task 1) keep submissions/
-- residue at zero before this runs. Idempotent upsert of bucket config
-- only; no object rows are touched. Reverses 20260822110000_brand_images_private.sql.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'brand-images', 'brand-images', true, 10485760,
  array['image/webp','image/jpeg','image/png','image/avif']
)
on conflict (id) do update set public = excluded.public;
