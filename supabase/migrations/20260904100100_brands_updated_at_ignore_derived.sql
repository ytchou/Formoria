-- DEV-1692 — Brands-specific updated_at trigger that ignores derived columns.
--
-- The existing shared `set_updated_at()` bumps `updated_at` on every UPDATE,
-- including when only derived columns (`model_faq_count`, `search_vector`)
-- change. This causes `apply_brand_refresh` to reject a refresh whose brand
-- was touched by an FAQ recount between submission and approval.
--
-- This trigger replaces the shared one on `brands` only. It compares the row
-- with derived columns stripped; if nothing else changed, `updated_at` is
-- preserved from the old row.
--
-- Excluded: updated_at (the column we control), model_faq_count and
-- search_vector (trigger-maintained derived), seo_promoted (GENERATED ALWAYS —
-- reads as NULL in NEW inside a BEFORE trigger, which creates a false diff).

create or replace function public.set_brands_updated_at()
returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - 'updated_at' - 'model_faq_count' - 'search_vector' - 'seo_promoted')
     is not distinct from
     (to_jsonb(old) - 'updated_at' - 'model_faq_count' - 'search_vector' - 'seo_promoted')
  then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists brands_updated_at on public.brands;
create trigger brands_updated_at
  before update on public.brands
  for each row execute function public.set_brands_updated_at();
