-- Row-based FAQ storage for the DEV-1317 preset catalog.
--
-- Replaces the fixed-column `brand_faq` shape (one jsonb column per question)
-- with one row per (brand, preset, position). Three things the columns could
-- not express and this can:
--   * provenance — `source` distinguishes a model answer from a human-authored
--     one, so the enrichment write can skip human copy by a real check instead
--     of the "looks filled" heuristic it uses today;
--   * unbounded customs — customs are quality-bounded, not slot-bounded by
--     `faq_custom_1..4`;
--   * independent locale sides — a zh-only row no longer blocks its own en
--     half from ever being filled, because the two sides are columns of one
--     row keyed by preset rather than a single opaque jsonb blob.
--
-- Template floors are deliberately NOT persisted: they are computed at render
-- from live brand columns, so a stored copy would go stale the moment
-- `price_range` or `founding_year` changes. Only 'model' and 'human' rows exist.
--
-- `brand_faq` is intentionally left in place as the rollback path; it is
-- dropped in a later task once every reader has moved.

create table public.brand_faq_entries (
  brand_id uuid not null references public.brands (id) on delete cascade,
  -- Catalog preset id (e.g. 'taiwan-origin', 'main-products', 'custom').
  -- Deliberately unconstrained text: the catalog lives in TypeScript
  -- (src/lib/brands/faq-presets/) and a CHECK here would need a migration
  -- every time a preset is added or renamed, which is exactly the coupling
  -- the registry exists to avoid.
  preset_id text not null,
  -- Always 0 for single-answer presets; 0..n for 'custom', which is the only
  -- preset that legitimately holds more than one entry per brand.
  position smallint not null default 0,
  question_zh text,
  answer_zh text,
  question_en text,
  answer_en text,
  source text not null check (source in ('model', 'human')),
  updated_at timestamptz not null default now(),
  -- The only read pattern is "every entry for one brand", and this PK's
  -- leading column already serves it in catalog-resolution order. No second
  -- index: it would only add write cost to a table nothing else queries.
  primary key (brand_id, preset_id, position)
);

create trigger brand_faq_entries_updated_at
  before update on public.brand_faq_entries
  for each row execute function set_updated_at();

-- No anon/authenticated policies: reads and writes both go through the
-- service-role client in src/lib/services/brand-faq.ts. Matches `events` and
-- `feature_requests`. The revoke is belt-and-braces — RLS with no policy
-- already denies both roles — but it also removes the table from the default
-- grants Supabase applies to `public`.
alter table public.brand_faq_entries enable row level security;
revoke all on table public.brand_faq_entries from anon, authenticated;

comment on table public.brand_faq_entries is
  'Stored FAQ answers per brand, one row per (preset, position). Read exclusively through src/lib/services/brand-faq.ts. Template-floor answers are never stored here — they are computed at render.';
comment on column public.brand_faq_entries.preset_id is
  'Id from the TypeScript preset catalog (src/lib/brands/faq-presets/). Unconstrained by design so adding a preset needs no migration.';
comment on column public.brand_faq_entries.position is
  'Ordering within a preset. 0 for every single-answer preset; 0..n for custom.';
comment on column public.brand_faq_entries.source is
  'model = LLM-authored and overwritable by an explicit faq-phase run; human = never touched by enrichment.';

-- Backfill the surviving presets from `brand_faq`.
--
-- Every extant row is `source = 'model'`: no admin or owner FAQ editor has
-- ever existed, so all current content came out of the enrichment pipeline.
--
-- Deliberately NOT migrated:
--   * faq_where_to_buy, faq_founded — presets cut from the catalog;
--   * faq_mit — code-generated at render from mit_status/mit_story, so storing
--     it would freeze a verification claim that can legitimately change.
insert into public.brand_faq_entries (
  brand_id, preset_id, position,
  question_zh, answer_zh, question_en, answer_en,
  source, updated_at
)
select
  faq.brand_id,
  mapping.preset_id,
  mapping.position,
  nullif(btrim(mapping.entry ->> 'question_zh'), ''),
  nullif(btrim(mapping.entry ->> 'answer_zh'), ''),
  nullif(btrim(mapping.entry ->> 'question_en'), ''),
  nullif(btrim(mapping.entry ->> 'answer_en'), ''),
  'model',
  coalesce(faq.updated_at, now())
from public.brand_faq as faq
cross join lateral (
  values
    (faq.faq_products, 'main-products', 0::smallint),
    (faq.faq_price, 'price-positioning', 0::smallint),
    (faq.faq_reputation, 'reputation', 0::smallint),
    (faq.faq_custom_1, 'custom', 0::smallint),
    (faq.faq_custom_2, 'custom', 1::smallint),
    (faq.faq_custom_3, 'custom', 2::smallint),
    (faq.faq_custom_4, 'custom', 3::smallint)
) as mapping (entry, preset_id, position)
where mapping.entry is not null
  -- A row is worth migrating only if at least one locale actually renders.
  -- An entry with a question and no answer (or vice versa) shows nothing on
  -- the page, and carrying it over would block the gap-fill that should
  -- replace it.
  and (
    (
      nullif(btrim(mapping.entry ->> 'question_zh'), '') is not null
      and nullif(btrim(mapping.entry ->> 'answer_zh'), '') is not null
    )
    or (
      nullif(btrim(mapping.entry ->> 'question_en'), '') is not null
      and nullif(btrim(mapping.entry ->> 'answer_en'), '') is not null
    )
  )
on conflict (brand_id, preset_id, position) do nothing;
