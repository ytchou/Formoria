-- Collapse the curated product record to one boolean (DEV-1485).
--
-- wall_position, image_usage, and the four-state lifecycle all encoded the same
-- question in three places: does this product appear on the site? The homepage
-- wall is now a pure shuffle, so no row carries a hand-placed slot, and image
-- usage stopped gating rendering. `visible` replaces all three.
--
-- ORDERING IS LOAD-BEARING, IN TWO PLACES.
--
--   1. Against the deployment: the previously deployed service selected all
--      three columns. This migration runs only after the DEV-1485 code has
--      merged AND Railway has deployed it, or every homepage read 42703s.
--   2. Inside this file: the backfill below sits BETWEEN the add and the drop.
--      `visible` is `not null default true`, so a drop that ran first would
--      leave every retired product publicly visible, with nothing to detect it.

-- Belt and braces. DEV-1496's migration already removed these rows, so this is
-- expected to affect zero rows on every environment; it stays because the
-- fixture range is the one thing that must never survive into a public read.
-- FK CASCADE removes their sources and trail placements.
delete from public.curated_products
where id::text like '53000000-0000-4000-8000-%';

alter table public.curated_products
  add column visible boolean not null default true;

-- THE BACKFILL. Must precede the drops (see note 2 above). Only 'published'
-- rows were publicly readable, so every other lifecycle state becomes hidden.
update public.curated_products set visible = (lifecycle = 'published');

alter table public.curated_products
  drop constraint if exists curated_products_wall_position_nonneg;

alter table public.curated_products drop column wall_position;
alter table public.curated_products drop column image_usage;
alter table public.curated_products drop column lifecycle;

-- Dropping the column drops curated_products_brand_lifecycle_idx with it
-- (20260813120000_curated_products.sql:60). The brand page still reads by brand
-- and filters on the publication flag, so the index is re-created in the new
-- shape rather than silently lost.
create index curated_products_brand_visible_idx
  on public.curated_products (brand_id, visible);

comment on column public.curated_products.visible is
  'Whether the product renders on public surfaces. Replaces the four-state lifecycle: rows are never deleted, because (brand_id, key) is unique and a delete-then-recreate suffixes the key permanently.';
