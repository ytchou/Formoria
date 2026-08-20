-- DEPLOY ORDER: apply this migration to staging BEFORE merging the code.
--
-- It is backward-compatible in both directions, which is the whole point: the
-- currently deployed code supplies `channel_type` on every write and keeps
-- working unchanged, and the code in this PR omits it and is accepted from the
-- moment this lands. There is no window where one of the two is broken, so it
-- can be applied at any time before the merge.
--
-- Two statements, and the second is NOT optional.
--
-- `channel_type` is `not null` with no default today. A column DEFAULT fires
-- only when the column is OMITTED from the INSERT, and
-- `upsert_enriched_brand_channels` names `channel_type` explicitly and supplies
-- `v_candidate ->> 'channel_type'`. Once the new `buildEnrichedChannelRows`
-- (src/lib/services/brand-channels.ts) stops putting that key in the candidate
-- JSON, the expression evaluates to an explicitly-supplied NULL, the table
-- default never fires, and every enriched or imported upsert raises 23502. The
-- `coalesce` below is what actually closes that window; the `set default`
-- covers the plain INSERT paths that do omit the column.
--
-- Nothing catches this at build time: the Supabase service client is created
-- without the <Database> generic, so tsc and ESLint accept an RPC payload that
-- has stopped carrying a not-null column. The failure surfaces only at runtime.
--
-- Contains no `drop` of any kind. The column itself is dropped by
-- 20260821140000_drop_brand_channel_type.sql, AFTER the deploy lands.

begin;

alter table public.brand_channels
  alter column channel_type set default 'offline';

-- Body identical to the live staging function (last defined by migration
-- 20260817054048) except for the single `coalesce` on the channel_type value.
-- The `on conflict` clause never named `channel_type` and is untouched.
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
      coalesce(v_candidate ->> 'channel_type', 'offline'),
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

-- Restated on every `create or replace`: a replaced function keeps its existing
-- grants, but stating them here is what makes each migration file a complete
-- description of the privileges the function ends up with.
revoke all on function public.upsert_enriched_brand_channels(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.upsert_enriched_brand_channels(uuid, jsonb)
  to service_role;

commit;
