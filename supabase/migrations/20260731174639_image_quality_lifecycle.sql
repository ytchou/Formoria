BEGIN;

ALTER TABLE public.brand_images
  DROP CONSTRAINT IF EXISTS brand_images_status_check;

-- 'draft' must stay: admin brand-catalog uploads stage as draft before publish
-- (admin-brand-review.ts). 20260801095500 added it to fix a 23514 on every admin
-- upload, and this migration sorts earlier, so omitting it here re-breaks that
-- path on the next `db push --include-all`.
ALTER TABLE public.brand_images
  ADD CONSTRAINT brand_images_status_check
  CHECK (status IN ('active', 'candidate', 'draft', 'rejected'));

ALTER TABLE public.submission_images
  DROP CONSTRAINT IF EXISTS submission_images_status_check;

ALTER TABLE public.submission_images
  ADD CONSTRAINT submission_images_status_check
  CHECK (status IN ('active', 'candidate', 'draft', 'rejected'));

ALTER TABLE public.brand_images
  ADD COLUMN IF NOT EXISTS rejection_reasons text[],
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz;

ALTER TABLE public.submission_images
  ADD COLUMN IF NOT EXISTS rejection_reasons text[],
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_metadata jsonb;

ALTER TABLE public.brand_images
  ADD COLUMN IF NOT EXISTS provider_metadata jsonb;

CREATE INDEX IF NOT EXISTS brand_images_rejected_retention_idx
  ON public.brand_images (rejected_at, id)
  WHERE status = 'rejected'
    AND storage_path IS NOT NULL
    AND rejected_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS submission_images_rejected_retention_idx
  ON public.submission_images (rejected_at, id)
  WHERE status = 'rejected'
    AND storage_path IS NOT NULL
    AND rejected_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.copy_submission_image_provider_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.provider_metadata IS NULL AND NEW.source_url IS NOT NULL THEN
    SELECT image.provider_metadata
    INTO NEW.provider_metadata
    FROM public.submission_images AS image
    WHERE image.source_url = NEW.source_url
      AND image.provider_metadata IS NOT NULL
      AND image.status = 'active'
    ORDER BY image.created_at DESC
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS brand_images_copy_provider_metadata
  ON public.brand_images;

CREATE TRIGGER brand_images_copy_provider_metadata
BEFORE INSERT OR UPDATE OF source_url, provider_metadata ON public.brand_images
FOR EACH ROW
EXECUTE FUNCTION public.copy_submission_image_provider_metadata();

-- Only legacy classifier junk receives a prospective seven-day expiry. Human,
-- admin, and overflow removals remain outside this retention policy.
UPDATE public.brand_images
SET rejected_at = COALESCE(rejected_at, now())
WHERE status = 'rejected'
  AND storage_path IS NOT NULL
  AND rejected_at IS NULL
  AND tags && ARRAY['promo', 'text_banner', 'irrelevant']::text[];

UPDATE public.submission_images
SET rejected_at = COALESCE(rejected_at, now())
WHERE status = 'rejected'
  AND storage_path IS NOT NULL
  AND rejected_at IS NULL
  AND tags && ARRAY['promo', 'text_banner', 'irrelevant']::text[];

-- The retention cron that consumes the columns and indexes above is deliberately
-- NOT scheduled here. Scheduling it starts irreversible storage deletion, and
-- DEV-1279 has not yet settled whether rejection should delete at all (see the
-- decouple-deletion work). The statement is parked at
-- supabase/deferred/20260801140000_schedule_classifier_retention_cron.sql --
-- move it into this directory and push when that decision lands.

COMMIT;
