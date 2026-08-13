do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'health_agent_reader') then
    create role health_agent_reader nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'health_agent_writer') then
    create role health_agent_writer nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end
$$;

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
