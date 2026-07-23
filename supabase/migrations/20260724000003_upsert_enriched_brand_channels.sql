-- Fill-gaps-only upsert for enrichment pipeline
create or replace function public.upsert_enriched_brand_channels(
  p_brand_id uuid,
  p_candidates jsonb
)
returns integer
language plpgsql
security definer
as $$
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
      address,
      url,
      source
    ) values (
      p_brand_id,
      v_candidate ->> 'name',
      v_candidate ->> 'normalized_name',
      v_candidate ->> 'channel_type',
      v_candidate ->> 'category_label',
      v_candidate ->> 'region_label',
      v_candidate ->> 'address',
      v_candidate ->> 'url',
      'enriched'
    )
    on conflict (brand_id, normalized_name) do update set
      category_label = coalesce(brand_channels.category_label, excluded.category_label),
      region_label   = coalesce(brand_channels.region_label,   excluded.region_label),
      address        = coalesce(brand_channels.address,        excluded.address),
      url            = coalesce(brand_channels.url,            excluded.url),
      updated_at     = now()
    where brand_channels.owner_status <> 'rejected'
      and brand_channels.removed_at is null;

    if found then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;
