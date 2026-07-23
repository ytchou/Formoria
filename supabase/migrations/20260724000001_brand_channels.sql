-- Brand channels entity model (replaces brands.retail_locations jsonb)

create table public.brand_channels (
  id              uuid primary key default gen_random_uuid(),
  brand_id        uuid not null references public.brands(id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 80),
  normalized_name text not null check (char_length(normalized_name) between 1 and 80),
  channel_type    text not null check (channel_type in ('online','offline')),
  category_label  text check (char_length(category_label) <= 40),
  region_label    text check (char_length(region_label) <= 40),
  address         text check (char_length(address) <= 200),
  url             text check (url ~* '^https?://'),
  source          text not null check (source in ('backfill','enriched','community','owner','admin')),
  owner_status    text not null default 'none' check (owner_status in ('none','confirmed','rejected')),
  owner_status_by uuid references auth.users(id) on delete set null,
  created_by      uuid references auth.users(id) on delete set null,
  removed_at      timestamptz,
  removed_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (brand_id, normalized_name)
);
create index brand_channels_brand_idx on public.brand_channels (brand_id) where removed_at is null;

create table public.brand_channel_confirmations (
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.brand_channels(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (channel_id, user_id)
);
create index brand_channel_confirmations_channel_idx on public.brand_channel_confirmations (channel_id);

alter table public.brand_location_candidates
  add column channel_id uuid references public.brand_channels(id) on delete set null;

-- RLS: brand_channels
alter table public.brand_channels enable row level security;

create policy "Public can read active non-rejected channels"
on public.brand_channels for select
to anon, authenticated
using (removed_at is null and owner_status <> 'rejected');

create policy "Authenticated users can submit community channels"
on public.brand_channels for insert
to authenticated
with check (created_by = auth.uid() and source = 'community');

-- RLS: brand_channel_confirmations
alter table public.brand_channel_confirmations enable row level security;

create policy "Users can read own confirmations"
on public.brand_channel_confirmations for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own confirmations"
on public.brand_channel_confirmations for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can delete own confirmations"
on public.brand_channel_confirmations for delete
to authenticated
using (auth.uid() = user_id);
