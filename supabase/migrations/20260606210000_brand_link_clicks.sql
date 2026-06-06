create table public.brand_link_clicks (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references public.brands(id) on delete cascade,
  date        date not null default current_date,
  destination text not null,
  clicks      int  not null default 0,
  created_at  timestamptz not null default now(),
  unique (brand_id, date, destination)
);
create index idx_brand_link_clicks_brand_date on public.brand_link_clicks (brand_id, date desc);

alter table public.brand_link_clicks enable row level security;

create policy service_role_full_access on public.brand_link_clicks
  for all to service_role using (true) with check (true);

create policy owners_read_own on public.brand_link_clicks
  for select using (
    exists (select 1 from public.brand_owners bo
            where bo.brand_id = brand_link_clicks.brand_id and bo.user_id = auth.uid())
  );

create or replace function public.increment_brand_link_click(p_brand_id uuid, p_destination text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.brand_link_clicks (brand_id, date, destination, clicks)
  values (p_brand_id, current_date, p_destination, 1)
  on conflict (brand_id, date, destination)
  do update set clicks = brand_link_clicks.clicks + 1;
end; $$;

grant execute on function public.increment_brand_link_click(uuid, text) to service_role;
