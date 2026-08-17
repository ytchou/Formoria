-- Collapse the curated product record to one description column (DEV-1496).
--
-- Formoria records no per-product reason for selecting a product; the reasoning
-- lives in discovery-trail prose. See
-- docs/decisions/2026-08-18-curated-product-single-text-field.md.

-- Purge the DEV-1477 throwaway fixture set BEFORE the NOT NULL below.
-- Production is a no-op here: it holds zero rows.
-- FK CASCADE removes their sources and trail placements.
delete from public.curated_products
where id::text like '53000000-0000-4000-8000-%';

-- Staging also held 19 hand-entered rows outside the fixture range with no
-- rationale at all, so the constraint cannot be added while they exist and no
-- description may be invented for them. They are re-authored with real
-- descriptions in DEV-1496's editorial pass.
delete from public.curated_products
where highlight_rationale_zh is null;

alter table public.curated_products
  drop constraint if exists curated_products_highlight_needs_rationale;

alter table public.curated_products
  rename column highlight_rationale_zh to product_description_zh;
alter table public.curated_products
  rename column highlight_rationale_en to product_description_en;
alter table public.curated_products
  rename column highlight_position to product_position;

alter table public.curated_products drop column notes_zh;
alter table public.curated_products drop column notes_en;

alter table public.curated_product_selections drop column rationale_zh;
alter table public.curated_product_selections drop column rationale_en;

-- Safe only after the delete above.
alter table public.curated_products
  alter column product_description_zh set not null;

comment on column public.curated_products.product_description_zh is
  'What the product IS: durable facts only — material, size, use, made-where. Never price, stock, discount, variants or delivery. Formoria records no reason for selecting a product; see docs/decisions/2026-08-18-curated-product-single-text-field.md.';
comment on column public.curated_products.product_description_en is
  'English twin of product_description_zh. Nullable; the renderer falls back to zh.';
comment on column public.curated_products.product_position is
  'Editorial order on the brand page. Nulls last. Distinct from wall_position, which pins a product on the shuffled homepage wall.';
comment on column public.curated_products.wall_position is
  'Optional pin on the homepage wall: pinned products sort ahead of the daily shuffle. Independent of product_position.';
