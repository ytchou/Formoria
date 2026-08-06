create table if not exists public.crawler_hits (
  day          date not null,
  crawler_name text not null,
  path_class   text not null,
  count        bigint not null default 0,
  primary key (day, crawler_name, path_class)
);

alter table public.crawler_hits enable row level security;
revoke all on table public.crawler_hits from anon, authenticated;
