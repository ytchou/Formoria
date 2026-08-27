-- DEV-1619 Release 1: product-level Made in Taiwan qualification.
--
-- Additive first. Brand-level MIT columns and the dormant evidence system stay
-- intact until the product read/write path is deployed and verified.

begin;

-- The government archive contains one row per product/model variant and reuses
-- certificate numbers. `record_key` is stable across expiry refreshes while the
-- normalized tuple supports exact, batched lookup without fuzzy matching.
alter table public.mit_registry
  add column if not exists record_key text,
  add column if not exists normalized_brand text,
  add column if not exists normalized_product text,
  add column if not exists normalized_model text;

update public.mit_registry
set record_key = md5(concat_ws(
      E'\x1f',
      cert_number,
      coalesce(company_name, ''),
      coalesce(brand_name, ''),
      coalesce(product_name, ''),
      coalesce(product_model, ''),
      coalesce(industry_type, '')
    )),
    normalized_brand = lower(regexp_replace(coalesce(brand_name, ''), '[^[:alnum:]]+', '', 'g')),
    normalized_product = lower(regexp_replace(coalesce(product_name, ''), '[^[:alnum:]]+', '', 'g')),
    normalized_model = lower(regexp_replace(coalesce(product_model, ''), '[^[:alnum:]]+', '', 'g'))
where record_key is null
   or normalized_brand is null
   or normalized_product is null
   or normalized_model is null;

alter table public.mit_registry
  alter column record_key set not null,
  alter column normalized_brand set not null,
  alter column normalized_product set not null,
  alter column normalized_model set not null;

drop index if exists public.idx_mit_registry_cert_number;
alter table public.mit_registry
  drop constraint if exists mit_registry_cert_number_key;

create unique index if not exists mit_registry_record_key_idx
  on public.mit_registry (record_key);
create index if not exists mit_registry_cert_number_idx
  on public.mit_registry (cert_number);
create index if not exists mit_registry_exact_product_idx
  on public.mit_registry (normalized_brand, normalized_product, normalized_model);
create index if not exists mit_registry_synced_at_idx
  on public.mit_registry (synced_at desc);

comment on column public.mit_registry.record_key is
  'Stable source-record identity. Certificate numbers are deliberately non-unique because the archive publishes product/model variants.';

alter table public.curated_product_candidates
  add column if not exists deterministic_origin_assessment jsonb,
  add column if not exists llm_origin_assessment jsonb,
  add column if not exists registry_origin_assessment jsonb,
  add column if not exists mit_qualified boolean,
  add column if not exists qualification_method text
    check (qualification_method in ('registry', 'consensus'));

alter table public.curated_products
  add column if not exists made_in_taiwan_confirmed boolean not null default false,
  add column if not exists materials_from_taiwan_confirmed boolean not null default false,
  add column if not exists mit_registry_id integer
    references public.mit_registry (id) on delete set null,
  add column if not exists origin_candidate_id uuid
    references public.curated_product_candidates (id) on delete set null;

create index if not exists curated_products_mit_registry_idx
  on public.curated_products (mit_registry_id)
  where mit_registry_id is not null;
create index if not exists curated_products_origin_candidate_idx
  on public.curated_products (origin_candidate_id)
  where origin_candidate_id is not null;

comment on column public.curated_products.made_in_taiwan_confirmed is
  'Stored consensus fact from the assessed official product URL; never inherited from the brand.';
comment on column public.curated_products.materials_from_taiwan_confirmed is
  'Stored consensus fact that all primary materials are explicitly Taiwan-origin.';

create or replace function public.clear_curated_product_origin_on_url_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.official_url is distinct from old.official_url then
    new.made_in_taiwan_confirmed := false;
    new.materials_from_taiwan_confirmed := false;
    new.mit_registry_id := null;
    new.origin_candidate_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists clear_curated_product_origin_on_url_change
  on public.curated_products;
create trigger clear_curated_product_origin_on_url_change
before update of official_url on public.curated_products
for each row execute function public.clear_curated_product_origin_on_url_change();

-- Restore the audited weekly mirror sync. Dispatch logging and timeout match
-- the other pg_cron HTTP jobs and the route's 300-second duration.
do $$ begin
  perform cron.unschedule('sync-mit-registry-weekly');
exception when others then
  null;
end $$;

select cron.schedule(
  'sync-mit-registry-weekly',
  '0 2 * * 0',
  $job$
  insert into public.cron_http_dispatch (request_id, job_name)
  values (
    (select net.http_post(
       url := (select value from public.app_secrets where key = 'cron_base_url')
         || '/api/cron/sync-mit-registry',
       headers := jsonb_build_object(
         'x-origin-verify', (select value from public.app_secrets where key = 'origin_secret'),
         'Content-Type', 'application/json'
       ),
       body := jsonb_build_object('triggered_by', 'pg_cron', 'run_at', now()::text),
       timeout_milliseconds := 300000
     )),
    'sync-mit-registry-weekly'
  );
  $job$
);

commit;
