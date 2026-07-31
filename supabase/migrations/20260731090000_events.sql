-- Events entity: Taiwanese brand events (markets, pop-ups, exhibitions) and the
-- brand lineup exhibiting at each one. Read exclusively through
-- src/lib/services/events.ts.

create table public.events (
  id uuid primary key default gen_random_uuid(),
  -- Kebab-case, 3-80 chars, must start alphanumeric. Matches the brand slug
  -- shape so /events/[slug] and /brands/[slug] validate identically.
  slug text not null unique
    check (slug ~ '^[a-z0-9][a-z0-9-]{2,79}$'),
  name text not null,
  name_en text,
  summary text not null check (char_length(summary) <= 300),
  summary_en text,
  description text,
  description_en text,
  -- date, NOT timestamptz: an event runs on Taipei calendar days. Stored as a
  -- timestamptz, a midnight-Taipei 8/6 start renders (and is emitted into
  -- schema.org startDate) as 8/5 for any UTC-or-earlier reader.
  starts_on date not null,
  ends_on date not null check (ends_on >= starts_on),
  venue_name text,
  venue_name_en text,
  venue_address text,
  city text,
  organizer_name text,
  official_url text,
  ticket_url text,
  -- Tri-state: true = free entry, false = ticketed, null = not yet known.
  -- A two-state boolean would force unresearched events to claim "ticketed".
  is_free boolean,
  hero_image_url text,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.event_brands (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  brand_id uuid not null references public.brands (id) on delete cascade,
  booth text,
  area text,
  area_en text,
  note text,
  note_en text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (event_id, brand_id)
);

create trigger events_updated_at
  before update on public.events
  for each row execute function set_updated_at();

-- The hub lists published events newest-first by end date, so the partial index
-- covers both the filter and the ordering without touching draft/hidden rows.
create index events_published_recent_idx
  on public.events (ends_on desc, starts_on desc)
  where status = 'published';
-- Detail page lineup: one event's rows already in render order. `id` is the
-- tiebreak so pagination and repeated reads cannot reorder equal sort_order rows.
create index event_brands_event_sort_idx
  on public.event_brands (event_id, sort_order, id);
-- Exists so deleting a brand does not seq-scan event_brands to satisfy the
-- on-delete cascade. Postgres does not index the referencing side automatically.
create index event_brands_brand_idx
  on public.event_brands (brand_id);

alter table public.events enable row level security;
alter table public.event_brands enable row level security;

comment on table public.events is
  'Taiwanese brand events. Only status = published is publicly readable, and that filter lives in the service layer.';
comment on table public.event_brands is
  'Brand lineup for an event: one row per (event, brand), ordered by sort_order.';
comment on column public.events.starts_on is
  'Taipei calendar date. Must stay `date` — a timestamptz shifts the day backwards for UTC readers.';
comment on column public.events.ends_on is
  'Taipei calendar date, inclusive. The last day still counts as ongoing.';
comment on column public.events.is_free is
  'Tri-state: true = free entry, false = ticketed, null = unknown.';
comment on column public.events.status is
  'draft = not yet public, published = live, hidden = withdrawn after publication.';
comment on column public.event_brands.sort_order is
  'Editorial ordering within an event; ties fall back to brand name in the service layer.';

-- No anon/authenticated policies: reads and writes both go through the
-- service-role client in the service layer. Matches feature_requests.
