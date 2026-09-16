-- DEV-1743 -- get_explore_brand_pool RPC.
--
-- The homepage explore rail needs N brands per visible L1 category, rotated
-- daily. It used to fetch every approved brand (~795 rows in production, plus
-- a whole-corpus `brand_images` hydration) and pick 3 per category in JS.
-- Doing the per-category selection here removes ~96% of both reads.
--
-- The ordering key is `md5(id::text || seed)`, not a plain `.limit()`: the
-- table's natural order is `seo_promoted DESC, id ASC`, so truncating before a
-- shuffle would skew the rail toward promoted and old brands. The seed is
-- passed in (TS already owns the daily rotation via `getDailySeed()`), so the
-- rotation logic is not duplicated in two languages and the function stays
-- `stable` — `setseed()` is session-scoped and hostile to a pooled connection.

create or replace function public.get_explore_brand_pool(
  category_slugs text[],
  per_category int,
  seed text
)
returns table(brand_id uuid, brand_slug text, category text)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with ranked as (
    select
      b.id,
      b.slug,
      b.category,
      row_number() over (
        partition by b.category
        order by md5(b.id::text || seed)
      ) as rn
    from public.brands b
    where b.status = 'approved'
      and b.category = any(category_slugs)
      -- Mirrors excludeTestBrands() in src/lib/services/public-brand-filter.ts.
      -- The slug-rehydration path does not filter this, so the RPC is the only
      -- place e2e seed brands can be kept off the public homepage.
      and b.name not like '[E2E-TEST]%'
  )
  select
    ranked.id as brand_id,
    ranked.slug as brand_slug,
    ranked.category
  from ranked
  where ranked.rn <= per_category;
$$;

revoke all on function public.get_explore_brand_pool(text[], int, text)
  from public, anon, authenticated;
grant execute on function public.get_explore_brand_pool(text[], int, text)
  to postgres, service_role;

comment on function public.get_explore_brand_pool is
  'Per-category random sample of approved brands for the homepage explore rail. '
  'Deterministic for a given seed; excludes [E2E-TEST] seed brands. '
  'Returns ids/slugs only — callers rehydrate through getBrandsBySlugs.';
