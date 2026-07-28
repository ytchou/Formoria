create table public.feature_requests (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 4 and 120),
  body text check (char_length(body) <= 2000),
  category text not null check (category in ('owner', 'visitor')),
  status text not null default 'open'
    check (status in ('open', 'planned', 'in_progress', 'shipped', 'declined', 'duplicate')),
  submitted_by uuid references auth.users (id) on delete set null, -- internal only
  merged_into_id uuid references public.feature_requests (id) on delete set null,
  is_seed boolean not null default false,
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.feature_request_votes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.feature_requests (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (request_id, user_id)
);

create index feature_requests_unmerged_idx
  on public.feature_requests (created_at desc)
  where merged_into_id is null;
create index feature_requests_status_created_idx
  on public.feature_requests (status, created_at desc);
create index feature_request_votes_user_idx
  on public.feature_request_votes (user_id);

alter table public.feature_requests enable row level security;
alter table public.feature_request_votes enable row level security;

comment on table public.feature_requests is
  'Public feature request board entries. submitted_by is internal only and never exposed publicly.';
comment on table public.feature_request_votes is
  'One vote per (request, user). Vote counts are aggregated server-side.';

-- No anon/authenticated policies: reads and writes both go through the
-- service-role client in the service layer. Matches brand_field_corrections.
