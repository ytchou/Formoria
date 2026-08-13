create table if not exists public.app_secrets (
  key text primary key,
  value text not null
);

insert into public.app_secrets (key, value)
values
  ('site_url', 'http://127.0.0.1:9'),
  ('cron_base_url', 'http://127.0.0.1:9'),
  ('origin_secret', 'staging-inert-bootstrap')
on conflict (key) do update set value = excluded.value;
