-- Canonical, event-scoped exhibitor roster for DEV-1370.
--
-- This is deliberately additive: existing event_brands placement columns and
-- the event page contract remain intact until the DEV-1372 UI/contract wave.

create table public.event_exhibitors (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  source_key text not null check (char_length(btrim(source_key)) > 0),
  name text not null check (char_length(btrim(name)) > 0),
  name_en text,
  booth text,
  area text,
  area_en text,
  zone text,
  event_category text not null check (char_length(btrim(event_category)) > 0),
  source_url text not null check (source_url ~* '^https?://'),
  website_url text check (website_url is null or website_url ~* '^https?://'),
  verified_at date not null,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, source_key)
);

alter table public.event_brands
  add column event_exhibitor_id uuid references public.event_exhibitors (id);

-- A canonical exhibitor can point to zero or one Formoria brands in one event.
create unique index event_brands_event_exhibitor_unique_idx
  on public.event_brands (event_id, event_exhibitor_id)
  where event_exhibitor_id is not null;

create index event_exhibitors_event_sort_idx
  on public.event_exhibitors (event_id, sort_order, id);

create index event_exhibitors_event_zone_idx
  on public.event_exhibitors (event_id, zone, sort_order);

create trigger event_exhibitors_updated_at
  before update on public.event_exhibitors
  for each row execute function set_updated_at();

alter table public.event_exhibitors enable row level security;

comment on table public.event_exhibitors is
  'Canonical event-scoped exhibitor roster. Reads and writes are service-role-only; a row may remain unlinked to a Formoria brand.';
comment on column public.event_exhibitors.source_key is
  'Stable identity from the authoritative event ledger, normally a namespaced official source ID; booth assignment is stored separately because it can drift.';
comment on column public.event_exhibitors.event_category is
  'Official event taxonomy only; never derived from brands.product_type.';
comment on column public.event_brands.event_exhibitor_id is
  'Nullable compatibility link to the canonical event exhibitor. Legacy rows may remain null until reconciliation.';

-- Default privileges and the public ACL contract already grant service_role
-- access and revoke application roles. Keep this explicit so the migration is
-- safe when applied on a database that predates that contract migration.
grant select, insert, update, delete on table public.event_exhibitors to service_role;
grant select, insert, update, delete on table public.event_brands to service_role;
