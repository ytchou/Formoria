-- Close the public access gaps identified in DEV-1288.

alter table public.app_secrets enable row level security;
revoke all on table public.app_secrets from public, anon, authenticated;

alter table public.mit_registry enable row level security;
create policy mit_registry_public_read
  on public.mit_registry for select
  using (true);

alter table public.brand_faq enable row level security;
create policy brand_faq_public_read
  on public.brand_faq for select
  using (true);

alter table public.product_tag_translations enable row level security;
create policy product_tag_translations_public_read
  on public.product_tag_translations for select
  using (true);

-- The enrichment RPC bypasses brand_channels RLS by design and is service-only.
alter function public.upsert_enriched_brand_channels(uuid, jsonb)
  set search_path = public, pg_temp;

revoke all on function public.upsert_enriched_brand_channels(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.upsert_enriched_brand_channels(uuid, jsonb)
  to service_role;
