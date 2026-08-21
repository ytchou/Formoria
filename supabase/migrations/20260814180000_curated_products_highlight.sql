-- Brand-page highlight ordering (DEV-1466): product-scoped editorial authority.
--
-- Trail placement remains on curated_product_selections. These columns belong
-- to the product's own brand-page presentation, so brand-page sorting and its
-- editorial rationale do not inherit a trail's position or copy.

alter table public.curated_products
  add column highlight_position integer,
  add column highlight_rationale_zh text,
  add column highlight_rationale_en text,
  add constraint curated_products_highlight_needs_rationale check (
    highlight_position is null
    or (highlight_position >= 0 and highlight_rationale_zh is not null)
  );

comment on column public.curated_products.highlight_position is
  'Brand-page ordering, nulls last. Independent of curated_product_selections.position, which is trail-scoped. A non-null value requires highlight_rationale_zh.';
comment on column public.curated_products.highlight_rationale_zh is
  'Product-scoped editorial reason rendered under the 「Formoria 選物」 badge. Never brand-supplied — that is notes_zh, which renders under 「品牌提供」.';
