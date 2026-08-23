-- DEV-1551 (task 5): give every hero image a bucket-relative companion path.
--
-- `brand_images`, `submission_images` and `event_exhibitors` already carry a
-- path column next to their url. The three hero columns below did not, so a
-- same-origin `/i/<bucket-relative-path>` read had no key to serve and the
-- `brand-images` bucket could not be flipped private without breaking them.
--
-- Deliberately additive and nullable: the backfill
-- (`scripts/backfill-storage-paths.ts`) populates these separately, and the
-- existing `hero_image_url` columns stay in the schema permanently — nothing
-- here drops or alters them.

begin;

alter table public.brands
  add column if not exists hero_image_storage_path text;

alter table public.brand_submissions
  add column if not exists hero_image_storage_path text;

alter table public.events
  add column if not exists hero_image_storage_path text;

comment on column public.brands.hero_image_storage_path is
  'Bucket-relative key in `brand-images` for hero_image_url; enables private-bucket reads via /i/<path>.';
comment on column public.brand_submissions.hero_image_storage_path is
  'Bucket-relative key in `brand-images` for hero_image_url; enables private-bucket reads via /i/<path>.';
comment on column public.events.hero_image_storage_path is
  'Bucket-relative key in `brand-images` for hero_image_url; enables private-bucket reads via /i/<path>.';

commit;
