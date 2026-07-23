begin;

alter function public.apply_brand_refresh(uuid, uuid)
  rename to apply_brand_refresh_with_protected_location_gate;

create function public.apply_brand_refresh(
  p_submission_id uuid,
  p_reviewer_id uuid
)
returns text[]
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_brand_id uuid;
  v_has_location_patch boolean := false;
  v_location_state public.brand_field_state%rowtype;
  v_restore_location_state boolean := false;
  v_storage_paths text[];
begin
  select submission.brand_id,
    coalesce(submission.enriched_data, '{}'::jsonb) ? 'retail_locations'
  into v_brand_id, v_has_location_patch
  from public.brand_submissions as submission
  where submission.id = p_submission_id
  for update;

  if found and v_brand_id is not null then
    perform 1
    from public.brands
    where id = v_brand_id
    for update;
  end if;

  select state.*
  into v_location_state
  from public.brand_field_state as state
  where v_has_location_patch
    and state.brand_id = v_brand_id
    and state.field = 'retail_locations'
    and (state.admin_locked or state.source in ('owner', 'admin', 'submitted'))
  for update;

  if found then
    v_restore_location_state := true;
    update public.brand_field_state
    set source = 'enriched', admin_locked = false
    where brand_id = v_location_state.brand_id
      and field = v_location_state.field;
  end if;

  v_storage_paths := public.apply_brand_refresh_with_protected_location_gate(
    p_submission_id,
    p_reviewer_id
  );

  if v_restore_location_state then
    update public.brand_field_state
    set source = v_location_state.source,
        updated_by = v_location_state.updated_by,
        admin_locked = v_location_state.admin_locked,
        updated_at = v_location_state.updated_at
    where brand_id = v_location_state.brand_id
      and field = v_location_state.field;
  end if;

  return v_storage_paths;
end;
$$;

revoke all on function public.apply_brand_refresh(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.apply_brand_refresh(uuid, uuid)
  to service_role;

commit;
