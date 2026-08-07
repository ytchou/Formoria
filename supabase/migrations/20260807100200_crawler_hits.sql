create table if not exists public.crawler_hits (
  day          date not null,
  crawler_name text not null,
  path_class   text not null,
  count        bigint not null default 0,
  primary key (day, crawler_name, path_class)
);

alter table public.crawler_hits enable row level security;
revoke all on table public.crawler_hits from anon, authenticated;

-- Atomic increment, same shape as increment_brand_link_click. The writer buffers
-- hits in module memory and flushes from `after()`, so two flushes can overlap
-- inside one container -- a read-modify-write would have both read the same
-- total and the later write would discard the earlier one. `excluded.count`
-- makes the add happen in the database instead.
--
-- The rows are pre-aggregated by key before the call, but the group by is kept
-- so a duplicate key in one payload cannot raise "ON CONFLICT DO UPDATE command
-- cannot affect row a second time".
create or replace function public.increment_crawler_hits(p_rows jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.crawler_hits (day, crawler_name, path_class, count)
  select
    (row_value->>'day')::date,
    row_value->>'crawler_name',
    row_value->>'path_class',
    sum((row_value->>'count')::bigint)
  from jsonb_array_elements(p_rows) as row_value
  group by 1, 2, 3
  on conflict (day, crawler_name, path_class)
  do update set count = crawler_hits.count + excluded.count;
end; $$;

-- Grant by role name, never by relying on defaults: creating (or replacing) a
-- public function re-applies Supabase's default execute grant to anon and
-- authenticated, and revoking from `public` alone does not undo it.
grant execute on function public.increment_crawler_hits(jsonb) to service_role;
revoke execute on function public.increment_crawler_hits(jsonb) from public, anon, authenticated;
