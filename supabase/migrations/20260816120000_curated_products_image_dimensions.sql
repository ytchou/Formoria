-- DEV-1479: intrinsic image dimensions for the native-ratio homepage wall.
--
-- Nullable by design: NULL is the backfill cursor
-- (`scripts/curated-products/backfill-image-dimensions.ts` resumes on it), and
-- the renderer falls back to 4:3 for any row that never measured. Additive
-- only — no DROP, no NOT NULL, no DEFAULT.
alter table public.curated_products
  add column if not exists image_width  integer,
  add column if not exists image_height integer;

comment on column public.curated_products.image_width is
  'Intrinsic width of the stored image object in px. NULL = not yet backfilled; renderer falls back to 4:3.';
comment on column public.curated_products.image_height is
  'Intrinsic height of the stored image object in px. NULL = not yet backfilled; renderer falls back to 4:3.';
