begin;

alter table public.brand_channels
  add column district text;

comment on column public.brand_channels.district is
  'Official 鄉/鎮/市/區 name, matched from address against a city-scoped whitelist. Null = unmatched; rendered in the unassigned bucket.';

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
      category_label,
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
      v_candidate ->> 'category_label',
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
      category_label = coalesce(brand_channels.category_label, excluded.category_label),
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

create or replace function public.update_brand_channel_districts(
  p_updates jsonb
)
returns integer
language sql
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with updated as (
    update public.brand_channels as channel
    set
      district = update_row.district,
      updated_at = now()
    from jsonb_to_recordset(coalesce(p_updates, '[]'::jsonb)) as update_row(
      id uuid,
      district text
    )
    where channel.id = update_row.id
    returning channel.id
  )
  select count(*)::integer from updated;
$function$;

revoke all on function public.update_brand_channel_districts(jsonb)
  from public, anon, authenticated;
grant execute on function public.update_brand_channel_districts(jsonb)
  to service_role;

commit;
