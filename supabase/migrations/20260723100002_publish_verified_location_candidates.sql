begin;

-- Apply verified location augmentations inside the existing approval/refresh
-- transaction. Protected non-empty values remain authoritative.
create or replace function public.merge_verified_location_candidate(
  p_existing jsonb,
  p_incoming jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_locations jsonb := case
    when jsonb_typeof(p_existing) = 'array' then p_existing
    else '[]'::jsonb
  end;
  v_incoming_address text;
  v_incoming_identity text;
  v_incoming_name text;
  v_match_index integer := null;
  v_name_match_index integer := null;
  v_name_match_count integer := 0;
  v_index integer;
  v_location jsonb;
  v_address text;
  v_identity text;
  v_name text;
  v_key text;
begin
  if jsonb_typeof(p_incoming) <> 'object'
    or p_incoming ->> 'kind' <> 'location' then
    return v_locations;
  end if;

  v_incoming_address := regexp_replace(
    regexp_replace(lower(coalesce(p_incoming ->> 'address', '')), '[[:space:]]', '', 'g'),
    '[，,。．.、\-—_#號樓室]', '', 'g'
  );
  v_incoming_name := regexp_replace(lower(coalesce(p_incoming ->> 'name', '')), '[[:space:]]', '', 'g');
  v_incoming_identity := v_incoming_name || '|'
    || regexp_replace(lower(coalesce(p_incoming ->> 'city', '')), '[[:space:]]', '', 'g') || '|'
    || regexp_replace(lower(coalesce(p_incoming ->> 'venueName', '')), '[[:space:]]', '', 'g');

  if jsonb_array_length(v_locations) > 0 then
    for v_index in 0..jsonb_array_length(v_locations) - 1 loop
      v_location := v_locations -> v_index;
      if jsonb_typeof(v_location) <> 'object' or v_location ->> 'kind' <> 'location' then
        continue;
      end if;

      v_address := regexp_replace(
        regexp_replace(lower(coalesce(v_location ->> 'address', '')), '[[:space:]]', '', 'g'),
        '[，,。．.、\-—_#號樓室]', '', 'g'
      );
      v_name := regexp_replace(lower(coalesce(v_location ->> 'name', '')), '[[:space:]]', '', 'g');
      v_identity := v_name || '|'
        || regexp_replace(lower(coalesce(v_location ->> 'city', '')), '[[:space:]]', '', 'g') || '|'
        || regexp_replace(lower(coalesce(v_location ->> 'venueName', '')), '[[:space:]]', '', 'g');

      if v_match_index is null and v_incoming_address <> '' and v_address = v_incoming_address then
        v_match_index := v_index;
      elsif v_match_index is null and v_identity = v_incoming_identity then
        v_match_index := v_index;
      end if;

      if v_name <> '' and v_name = v_incoming_name then
        v_name_match_count := v_name_match_count + 1;
        v_name_match_index := v_index;
      end if;
    end loop;
  end if;

  if v_match_index is null and v_name_match_count = 1 then
    v_match_index := v_name_match_index;
  end if;

  if v_match_index is null then
    return v_locations || jsonb_build_array(p_incoming);
  end if;

  v_location := v_locations -> v_match_index;
  v_address := regexp_replace(
    regexp_replace(lower(coalesce(v_location ->> 'address', '')), '[[:space:]]', '', 'g'),
    '[，,。．.、\-—_#號樓室]', '', 'g'
  );
  if v_address <> '' and v_incoming_address <> '' and v_address <> v_incoming_address then
    return v_locations;
  end if;
  foreach v_key in array array['address', 'city', 'district', 'venueName', 'floorOrCounter', 'availabilityNote', 'latitude', 'longitude'] loop
    if nullif(btrim(v_location ->> v_key), '') is null
      and nullif(btrim(p_incoming ->> v_key), '') is not null then
      v_location := jsonb_set(v_location, array[v_key], p_incoming -> v_key, true);
    end if;
  end loop;

  if p_incoming ->> 'verificationStatus' = 'verified'
    and v_location ->> 'verificationStatus' <> 'verified' then
    v_location := jsonb_set(v_location, '{verificationStatus}', '"verified"'::jsonb, true);
  end if;

  return jsonb_set(v_locations, array[v_match_index::text], v_location, false);
end;
$$;

create or replace function public.reparent_brand_location_candidates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_locations jsonb;
  v_new_locations jsonb;
  v_candidate record;
  v_job_id uuid;
begin
  if new.status = 'approved' and new.brand_id is not null then
    if not (coalesce(new.review_overrides, '{}'::jsonb) ? 'retail_locations')
      and not exists (
        select 1
        from public.brand_field_state as state
        where state.brand_id = new.brand_id
          and state.field = 'retail_locations'
          and (state.admin_locked or state.source in ('owner', 'admin', 'submitted'))
      ) then
      select coalesce(retail_locations, '[]'::jsonb)
      into v_old_locations
      from public.brands
      where id = new.brand_id
      for update;

      v_new_locations := v_old_locations;
      for v_candidate in
        select location, job_id
        from public.brand_location_candidates
        where submission_id = new.id
          and verification_decision = 'verified'
        order by created_at, id
      loop
        v_new_locations := public.merge_verified_location_candidate(
          v_new_locations,
          v_candidate.location
        );
        v_job_id := v_candidate.job_id;
      end loop;

      if v_new_locations is distinct from v_old_locations then
        update public.brands
        set retail_locations = v_new_locations
        where id = new.brand_id;

        insert into public.brand_field_state (brand_id, field, source, updated_by, updated_at)
        values (new.brand_id, 'retail_locations', 'enriched', null, now())
        on conflict (brand_id, field) do nothing;

        insert into public.brand_field_events (
          brand_id, field, old_value, new_value, source, actor, job_id
        ) values (
          new.brand_id, 'retail_locations', v_old_locations, v_new_locations,
          'enriched', null, v_job_id
        );
      end if;
    end if;

    update public.brand_location_candidates
    set brand_id = new.brand_id,
        submission_id = null,
        updated_at = now()
    where submission_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists brand_location_candidates_reparent
  on public.brand_submissions;

create trigger brand_location_candidates_reparent
after update of status, brand_id on public.brand_submissions
for each row
when (new.status = 'approved' and new.brand_id is not null)
execute function public.reparent_brand_location_candidates();

revoke all on function public.merge_verified_location_candidate(jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.reparent_brand_location_candidates()
  from public, anon, authenticated;

commit;
