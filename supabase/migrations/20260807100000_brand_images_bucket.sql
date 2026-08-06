-- brand-images is the only production-critical bucket with no migration; its
-- config has lived solely in the Supabase dashboard. Live state at authoring:
-- public=true, file_size_limit=null, allowed_mime_types=null.
--
-- This codifies public=true (unchanged) and adds a 10 MB cap plus a MIME
-- allow-list. The app caps uploads at 5 MB (MAX_FILE_SIZE in
-- src/app/api/upload/route.ts and the admin image routes, plus
-- maxFileSizeBytes in src/lib/security/image-processor.ts), so the bucket
-- ceiling sits at 2x the app ceiling and cannot reject an upload the app
-- already accepted. Uploads are normalized to image/webp; jpeg/png/avif stay
-- allowed for objects written by other paths.
--
-- Idempotent upsert of bucket config only -- no object rows are touched.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'brand-images', 'brand-images', true, 10485760,
  array['image/webp','image/jpeg','image/png','image/avif']
)
on conflict (id) do update
   set public             = excluded.public,
       file_size_limit    = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;
