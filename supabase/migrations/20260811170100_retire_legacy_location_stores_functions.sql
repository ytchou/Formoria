begin;

drop trigger if exists brand_location_candidates_reparent
  on public.brand_submissions;
drop function if exists public.apply_brand_refresh_locations(uuid[], uuid);
drop function if exists public.reparent_brand_location_candidates();
drop function if exists public.merge_verified_location_candidate(jsonb, jsonb);

create or replace function public.apply_brand_refresh(
  p_submission_id uuid,
  p_reviewer_id uuid
)
returns text[]
language plpgsql
set search_path to ''
set lock_timeout to '2s'
as $function$
begin
  return public.apply_brand_refresh_with_protected_location_gate(
    p_submission_id,
    p_reviewer_id
  );
end;
$function$;

create or replace function pg_temp.patch_once(
  v_body text,
  v_old text,
  v_new text,
  v_label text
) returns text
language plpgsql
as $patch_once$
declare
  v_count integer;
begin
  v_count := (length(v_body) - length(replace(v_body, v_old, ''))) / length(v_old);
  if v_count <> 1 then
    raise exception '%: expected one anchor, found %', v_label, v_count;
  end if;
  return replace(v_body, v_old, v_new);
end
$patch_once$;

do $migration$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure
  ) into v_definition;
  if (
    length(v_definition) - length(replace(v_definition, ', ''retail_locations''', ''))
  ) / length(', ''retail_locations''') <> 5 then
    raise exception 'apply_brand_refresh gate: expected five retail_locations allow-list entries';
  end if;
  execute replace(v_definition, ', ''retail_locations''', '');

  select pg_get_functiondef('public.get_brand_quality_metrics()'::regprocedure)
    into v_definition;
  v_definition := pg_temp.patch_once(
    v_definition,
    $old$      + (retail_locations IS NOT NULL
         AND jsonb_typeof(retail_locations) = 'array'
         AND retail_locations != '[]'::jsonb)::int
        AS completed,$old$,
    $new$        AS completed,$new$,
    'get_brand_quality_metrics completeness term'
  );
  execute v_definition;

  select pg_get_functiondef(
    'public.correct_approved_submission_provenance()'::regprocedure
  ) into v_definition;
  v_definition := pg_temp.patch_once(
    v_definition,
    $old$      'retail_locations', new.owner_data -> 'retailLocations',
$old$,
    '',
    'correct_approved_submission_provenance retail locations entry'
  );
  execute v_definition;
end
$migration$;

create or replace function public.revoke_brand_ownership(
  p_brand_id uuid,
  p_revoked_by text,
  p_reason text
)
returns table (revoked_user_id uuid, revoked_user_email text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_owner public.brand_owners%rowtype;
  v_revoked_user_email text;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Revocation reason is required';
  end if;

  select owner_row.*
  into v_owner
  from public.brand_owners as owner_row
  where owner_row.brand_id = p_brand_id
  for update;

  if not found then
    raise exception 'Brand owner not found';
  end if;

  select auth_user.email
  into v_revoked_user_email
  from auth.users as auth_user
  where auth_user.id = v_owner.user_id;

  if v_revoked_user_email is null then
    raise exception 'Brand owner email not found';
  end if;

  delete from public.brand_owners
  where id = v_owner.id;

  insert into public.ownership_revocations (
    brand_id,
    revoked_user_id,
    revoked_user_email,
    revoked_by,
    reason
  ) values (
    p_brand_id,
    v_owner.user_id,
    v_revoked_user_email,
    p_revoked_by,
    p_reason
  );

  update public.brands
  set mit_status = 'unverified',
      mit_declared_scope = null,
      mit_declared_at = null,
      mit_declared_by = null
  where id = p_brand_id
    and mit_status = 'declared';

  update public.brands
  set contact_email = null
  where id = p_brand_id;

  return query
  select v_owner.user_id, v_revoked_user_email;
end;
$function$;

drop function pg_temp.patch_once(text, text, text, text);

revoke all on function public.apply_brand_refresh(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.apply_brand_refresh_with_protected_location_gate(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.get_brand_quality_metrics()
  from public, anon, authenticated;
revoke all on function public.revoke_brand_ownership(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.correct_approved_submission_provenance()
  from public, anon, authenticated;

grant execute on function public.apply_brand_refresh(uuid, uuid) to service_role;
grant execute on function public.apply_brand_refresh_with_protected_location_gate(uuid, uuid)
  to service_role;
grant execute on function public.get_brand_quality_metrics() to service_role;
grant execute on function public.revoke_brand_ownership(uuid, text, text) to service_role;
grant execute on function public.correct_approved_submission_provenance() to service_role;

commit;
