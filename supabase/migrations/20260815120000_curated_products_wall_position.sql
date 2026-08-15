alter table public.curated_products
  add column wall_position integer;

alter table public.curated_products
  add constraint curated_products_wall_position_nonneg
  check (wall_position is null or wall_position >= 0);

comment on column public.curated_products.wall_position is
  'Homepage wall ordering, nulls last. Independent of highlight_position (brand-page scoped) and curated_product_selections.position (trail scoped). See docs/decisions/2026-08-15-homepage-wall-ordering-and-eligibility.md';
