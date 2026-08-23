-- DEV-1551 (task 12): let the image writers stop filling `url`.
--
-- `brand_images.url` and `submission_images.url` are both `text not null` with
-- no default (20260708100000_brand_images.sql:5 and
-- 20260715045959_submission_enrichment_staging.sql). Task 12 stops TypeScript
-- writing them, which without this migration turns every image insert into a
-- 23502 not-null violation at runtime.
--
-- The COLUMNS STAY. Seven Postgres functions still read them, and two of those
-- (`approve_submission`, `apply_brand_refresh*`) have no source file in this
-- repo — they were hand-patched via `pg_temp.patch_once` and are guarded only
-- by the md5 pin in `scripts/verify-contract-fingerprints.ts`, which detects
-- that they changed and never whether they are correct. Dropping the columns
-- would break them with no way to see it coming.
--
-- A default of '' rather than dropping NOT NULL: an empty string is visibly
-- "nothing was written here", whereas relaxing the constraint would make the
-- column silently optional for the SQL functions too.
--
-- Ceiling: '' is a placeholder, not data. When every hand-patched function has
-- a source file and has been moved onto `storage_path`, drop both columns and
-- this default with them.

begin;

alter table public.brand_images
  alter column url set default '';

alter table public.submission_images
  alter column url set default '';

commit;
