-- Reconciles brand_images.status after two migrations set it to incompatible
-- values from opposite directions:
--
--   20260731174639_image_quality_lifecycle  -> adds 'candidate' (classifier
--       staging for automated images), authored on feat/dev-1279, never applied.
--   20260801095500_brand_images_draft_status -> adds 'draft' (admin catalog
--       uploads stage before publish), applied to production out-of-band and
--       committed retroactively.
--
-- 095500 sorts last, so on a fresh database it would drop 'candidate' and the
-- classifier pipeline would fail 23514 on every automated image. Production is
-- the mirror case: it has 'draft' but not 'candidate'. Both need all four.
--
-- submission_images already allows all four (set by 20260731174639); it is
-- restated here so a fresh database and production converge on one definition
-- regardless of which migrations each had already applied.

BEGIN;

ALTER TABLE public.brand_images
  DROP CONSTRAINT IF EXISTS brand_images_status_check;

ALTER TABLE public.brand_images
  ADD CONSTRAINT brand_images_status_check
  CHECK (status IN ('active', 'candidate', 'draft', 'rejected'));

ALTER TABLE public.submission_images
  DROP CONSTRAINT IF EXISTS submission_images_status_check;

ALTER TABLE public.submission_images
  ADD CONSTRAINT submission_images_status_check
  CHECK (status IN ('active', 'candidate', 'draft', 'rejected'));

COMMIT;
