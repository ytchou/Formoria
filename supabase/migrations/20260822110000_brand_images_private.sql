-- Flip brand-images to private. Idempotent upsert of bucket config only;
-- no object rows are touched. Reverses 20260807100000_brand_images_bucket.sql,
-- which codified public=true as inherited dashboard state, never a decision.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'brand-images', 'brand-images', false, 10485760,
  array['image/webp','image/jpeg','image/png','image/avif']
)
on conflict (id) do update set public = excluded.public;
