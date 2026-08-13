-- Curated products (DEV-1404): the durable identity for editorially selected
-- products rendered on /brands/[slug].
--
-- Three tables, one responsibility each:
--   * curated_products            — the product itself, keyed editorially;
--   * curated_product_sources     — provenance. A factual claim may only exist
--                                   attached to the row that cites its source;
--   * curated_product_selections  — where a product is placed (trail/section)
--                                   and why, so the same product can appear in
--                                   more than one editorial context.
--
-- Deliberately NOT modelled: price, stock, inventory, availability, offers, and
-- variants. This is a discovery surface, not a commerce catalog; storing any of
-- those would create a freshness obligation nothing in the product can honour.
--
-- Every child FK cascades. `deleteBrand` in src/lib/services/brands.ts is a bare
-- DELETE that enumerates no children, so ON DELETE CASCADE is the only cleanup
-- path these rows have.

create table public.curated_products (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  -- Editorial product key, kebab-case. Stable across renames of name_zh/name_en
  -- so the YAML sync can upsert on (brand_id, key) instead of matching titles.
  key text not null,
  name_zh text not null,
  name_en text,
  -- Same 12-value list as brands.product_type
  -- (20260713100002_expand_product_type_check.sql).
  l1 text not null check (l1 in (
    'fashion', 'bags-accessories', 'jewelry', 'beauty', 'home', 'food-drink',
    'crafts', 'stationery', 'tech', 'outdoor', 'fitness', 'kids-pets'
  )),
  -- Unconstrained by design: the L2 vocabulary lives in TypeScript and changes
  -- faster than a migration cadence can follow.
  l2 text[] not null default '{}',
  official_url text,
  image_url text,
  -- The page the image was taken from, kept separately so usage rights can be
  -- re-checked without re-deriving the CDN URL.
  image_source_url text,
  image_usage text not null default 'none'
    check (image_usage in ('none', 'permitted', 'licensed')),
  lifecycle text not null default 'candidate'
    check (lifecycle in ('candidate', 'needs_review', 'published', 'retired')),
  link_state text not null default 'unchecked'
    check (link_state in ('unchecked', 'ok', 'redirected', 'broken')),
  link_checked_at timestamptz,
  source_checked_at timestamptz,
  review_due_at timestamptz,
  notes_zh text,
  notes_en text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, key)
);

-- The brand page reads published rows for one brand; the review queue reads
-- needs_review rows. Both are served by this index.
create index curated_products_brand_lifecycle_idx
  on public.curated_products (brand_id, lifecycle);

create table public.curated_product_sources (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null
    references public.curated_products (id) on delete cascade,
  url text not null,
  source_type text not null default 'official'
    check (source_type in ('official', 'press', 'retailer', 'other')),
  -- Optional factual note this URL supports. A claim cannot exist without the
  -- provenance row it hangs on, which is why it is a column here and not on
  -- curated_products.
  claim_zh text,
  claim_en text,
  checked_at timestamptz,
  state text not null default 'active' check (state in ('active', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Conflict target for the idempotent YAML sync. Without it a partially
  -- applied run duplicates rows instead of converging on re-run.
  unique (product_id, url)
);

create table public.curated_product_selections (
  product_id uuid not null
    references public.curated_products (id) on delete cascade,
  trail_slug text not null,
  section_key text not null,
  position integer not null default 0,
  -- zh is the authoring locale and is required; en is filled by translation.
  rationale_zh text not null,
  rationale_en text,
  state text not null default 'active' check (state in ('active', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (product_id, trail_slug, section_key)
);

create trigger curated_products_updated_at
  before update on public.curated_products
  for each row execute function set_updated_at();

create trigger curated_product_sources_updated_at
  before update on public.curated_product_sources
  for each row execute function set_updated_at();

create trigger curated_product_selections_updated_at
  before update on public.curated_product_selections
  for each row execute function set_updated_at();

-- No anon/authenticated policies: reads and writes both go through the
-- service-role client in the service layer. RLS with no policy already denies
-- both roles, but it does not remove the default grants Supabase applies to
-- tables in `public` — the revoke is what closes those.
alter table public.curated_products enable row level security;

revoke all on table public.curated_products from anon, authenticated;

alter table public.curated_product_sources enable row level security;

revoke all on table public.curated_product_sources from anon, authenticated;

alter table public.curated_product_selections enable row level security;

revoke all on table public.curated_product_selections from anon, authenticated;

comment on table public.curated_products is
  'Editorially selected products rendered on /brands/[slug]. No price, stock, or availability by design. Read exclusively through the service layer.';

comment on column public.curated_products.key is
  'Kebab-case editorial key, unique per brand. Upsert conflict target for the YAML sync.';

comment on column public.curated_products.image_usage is
  'none = do not render the image; permitted = owner/source allows use; licensed = formal licence on file.';

comment on column public.curated_products.lifecycle is
  'Only published rows render publicly. retired rows are kept so a key is never silently reused.';

comment on table public.curated_product_sources is
  'Provenance for a curated product. unique (product_id, url) is the sync conflict target — do not drop it.';

comment on table public.curated_product_selections is
  'Placement of a product within an editorial trail/section, with the rationale shown alongside it.';
