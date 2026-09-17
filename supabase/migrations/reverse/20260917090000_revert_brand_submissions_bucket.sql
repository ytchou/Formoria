-- Reverse DEV-1746 bucket visibility only. Submission history remains in the
-- private bucket so rollback never destroys the sole retained source object.
update storage.buckets
   set public = false
 where id = 'brand-images';

drop trigger if exists preserve_published_submission_image_history
  on public.submission_images;

drop function if exists public.preserve_published_submission_image_history();
