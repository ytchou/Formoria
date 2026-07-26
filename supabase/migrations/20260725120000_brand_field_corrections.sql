create table public.brand_field_corrections (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  field text not null check (field in ('price_range', 'product_type', 'product_tags')),
  proposed_value jsonb not null,
  previous_value jsonb,
  visitor_hash text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id),
  reviewer_notes text,
  created_at timestamptz not null default now()
);

create unique index brand_field_corrections_pending_uniq
  on public.brand_field_corrections (brand_id, visitor_hash, field)
  where status = 'pending';
create index brand_field_corrections_status_created_idx
  on public.brand_field_corrections (status, created_at desc);
create index brand_field_corrections_brand_idx
  on public.brand_field_corrections (brand_id, status);

alter table public.brand_field_corrections enable row level security;

-- No anon/authenticated policies: submissions and reads both go through the
-- service-role client in the server action. Matches origin_evidence's admin path.
