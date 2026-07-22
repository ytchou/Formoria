create table public.origin_evidence (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  user_id uuid not null references auth.users (id),
  stance text not null check (stance in ('supports', 'contradicts')),
  product_name text,
  source_type text not null check (
    source_type in ('product_label', 'packaging', 'official_site', 'in_store', 'other')
  ),
  notes text not null check (char_length(notes) <= 1000),
  photo_paths text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id),
  reviewer_notes text,
  created_at timestamptz not null default now()
);

create index origin_evidence_brand_status_idx on public.origin_evidence (brand_id, status);
create index origin_evidence_user_created_idx on public.origin_evidence (user_id, created_at desc);

alter table public.origin_evidence enable row level security;

create policy "Users can view own evidence"
  on public.origin_evidence for select
  using (auth.uid() = user_id);

create policy "Users can insert own evidence"
  on public.origin_evidence for insert
  with check (auth.uid() = user_id);

-- Admin reads/reviews go through the service-role client; no admin RLS policy.

insert into storage.buckets (id, name, public)
values ('origin-evidence', 'origin-evidence', false)
on conflict (id) do nothing;
