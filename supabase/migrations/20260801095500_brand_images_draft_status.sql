begin;

-- Admin brand-catalog edits stage uploads as drafts before publish, mirroring the
-- submission review flow. 20260718064325 widened submission_images to allow
-- 'draft' but left brand_images on the original active/rejected constraint, so
-- every admin brand image upload failed the check with a 23514.
alter table public.brand_images
  drop constraint if exists brand_images_status_check;

alter table public.brand_images
  add constraint brand_images_status_check
    check (status in ('active', 'draft', 'rejected'));

commit;
