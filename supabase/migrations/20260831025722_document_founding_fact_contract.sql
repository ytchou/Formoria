comment on column public.brands.city is
  'Taiwan county/city where the brand was founded, stored as an existing city slug. Not headquarters, contact, studio, store, showroom, or current operating location; overseas founding locations remain null.';

comment on column public.brands.founding_year is
  'Calendar year when the brand was founded. Store only evidence-backed or explicitly reviewed values; absence of evidence does not clear an existing value.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint as c
    join pg_class as t on t.oid = c.conrelid
    where t.relname = 'brand_ai_results'
      and c.conname = 'brand_ai_results_phase_check'
  ) then
    raise exception
      'brand_ai_results_phase_check is missing; reconcile the latest phase constraint before adding founding-fact phases';
  end if;
end;
$$;

alter table public.brand_ai_results
  drop constraint brand_ai_results_phase_check;

alter table public.brand_ai_results
  add constraint brand_ai_results_phase_check
  check (
    phase in (
      'triage',
      'detect',
      'classification',
      'classify_images',
      'facts',
      'founding_facts',
      'founding_facts_verify',
      'descriptions',
      'reputation',
      'names',
      'faq',
      'site_identity',
      'products',
      'description',
      'expansion'
    )
  );

create or replace function public.apply_founding_fact_audit_patch(
  p_brand_id uuid,
  p_patch jsonb,
  p_expected jsonb,
  p_expected_protection jsonb,
  p_source text,
  p_actor uuid,
  p_allow_protected boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_brand public.brands%rowtype;
  v_field text;
  v_actual_protection text;
begin
  if p_source is null or p_source not in ('enriched', 'admin') then
    raise exception 'unsupported founding-fact audit source';
  end if;

  if (p_source = 'admin' and p_actor is null)
    or (p_allow_protected and p_source <> 'admin')
  then
    raise exception 'founding-fact audit actor does not match its source';
  end if;

  if p_patch = '{}'::jsonb
    or exists (
      select 1
      from jsonb_object_keys(p_patch) as key(field)
      where key.field not in ('city', 'founding_year')
    )
    or not (
      select coalesce(bool_and(p_expected ? key.field), false)
      from jsonb_object_keys(p_patch) as key(field)
    )
    or not (
      select coalesce(bool_and(p_expected_protection ? key.field), false)
      from jsonb_object_keys(p_patch) as key(field)
    )
  then
    raise exception 'founding-fact audit patch contains an unsupported or unguarded field';
  end if;

  select *
  into v_brand
  from public.brands
  where id = p_brand_id
  for update;

  if not found or v_brand.status <> 'approved' then
    return false;
  end if;

  for v_field in select jsonb_object_keys(p_patch)
  loop
    if (to_jsonb(v_brand) -> v_field) is distinct from (p_expected -> v_field) then
      return false;
    end if;

    select case
      when state.source = 'owner' then 'protected:owner'
      when state.source = 'admin' and state.updated_by is not null
        then 'protected:admin'
      else null
    end
    into v_actual_protection
    from public.brand_field_state as state
    where state.brand_id = p_brand_id
      and state.field = v_field;

    if coalesce(to_jsonb(v_actual_protection), 'null'::jsonb)
      is distinct from (p_expected_protection -> v_field)
    then
      return false;
    end if;

    if not p_allow_protected and v_actual_protection is not null then
      return false;
    end if;
  end loop;

  perform public.apply_brand_patch(
    p_brand_id,
    p_patch,
    p_source,
    p_actor,
    null
  );
  return true;
end;
$$;

revoke all on function public.apply_founding_fact_audit_patch(
  uuid,
  jsonb,
  jsonb,
  jsonb,
  text,
  uuid,
  boolean
) from public, anon, authenticated;

grant execute on function public.apply_founding_fact_audit_patch(
  uuid,
  jsonb,
  jsonb,
  jsonb,
  text,
  uuid,
  boolean
) to service_role;
