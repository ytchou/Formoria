-- DEPLOY ORDER: ship the application code FIRST, then apply this migration.
--
-- Railway auto-deploys on push but Supabase migrations are applied by hand, so
-- code and schema move at different times. The pre-change CHANNEL_READ_SELECT
-- (src/lib/services/brand-channels.ts) and scripts/story-facts.ts both name
-- `category_label`. Applying this migration before the deploy lands makes
-- Postgres return 42703 on every brand-detail channel read until it does; the
-- reverse order is safe because the new code never names the column.
--
-- Nothing catches this at build time: the Supabase service client is created
-- without the <Database> generic, so tsc and ESLint accept a .select() string
-- naming a column that no longer exists. The failure surfaces only at runtime.

begin;

create or replace function public.upsert_enriched_brand_channels(
  p_brand_id uuid,
  p_candidates jsonb
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_count integer := 0;
  v_candidate jsonb;
begin
  for v_candidate in select * from jsonb_array_elements(p_candidates)
  loop
    insert into public.brand_channels (
      brand_id,
      name,
      normalized_name,
      channel_type,
      region_label,
      district,
      address,
      url,
      source,
      source_url,
      fetched_at,
      location_type,
      country,
      last_confirmed_at,
      provider_metadata
    ) values (
      p_brand_id,
      v_candidate ->> 'name',
      v_candidate ->> 'normalized_name',
      v_candidate ->> 'channel_type',
      v_candidate ->> 'region_label',
      v_candidate ->> 'district',
      v_candidate ->> 'address',
      v_candidate ->> 'url',
      coalesce(v_candidate ->> 'source', 'enriched'),
      v_candidate ->> 'source_url',
      (v_candidate ->> 'fetched_at')::timestamptz,
      v_candidate ->> 'location_type',
      v_candidate ->> 'country',
      (v_candidate ->> 'last_confirmed_at')::timestamptz,
      v_candidate -> 'provider_metadata'
    )
    on conflict (brand_id, normalized_name) do update set
      region_label = coalesce(brand_channels.region_label, excluded.region_label),
      district = coalesce(brand_channels.district, excluded.district),
      address = coalesce(brand_channels.address, excluded.address),
      url = coalesce(brand_channels.url, excluded.url),
      source_url = coalesce(brand_channels.source_url, excluded.source_url),
      fetched_at = coalesce(brand_channels.fetched_at, excluded.fetched_at),
      location_type = coalesce(brand_channels.location_type, excluded.location_type),
      country = coalesce(brand_channels.country, excluded.country),
      last_confirmed_at = coalesce(
        brand_channels.last_confirmed_at,
        excluded.last_confirmed_at
      ),
      provider_metadata = coalesce(
        brand_channels.provider_metadata,
        excluded.provider_metadata
      ),
      updated_at = now()
    where brand_channels.owner_status <> 'rejected'
      and brand_channels.removed_at is null;

    if found then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$function$;

revoke all on function public.upsert_enriched_brand_channels(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.upsert_enriched_brand_channels(uuid, jsonb)
  to service_role;

alter table public.brand_channels
  drop column category_label;

commit;
