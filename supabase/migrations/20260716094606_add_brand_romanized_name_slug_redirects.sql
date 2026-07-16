alter table public.brands
  add column romanized_name text;

update public.brands
set romanized_name = btrim(replace(slug, '-', ' '))
where romanized_name is null
  and char_length(btrim(replace(slug, '-', ' '))) between 1 and 100
  and btrim(replace(slug, '-', ' ')) ~ '^[a-zA-Z0-9 .''-]+$';

alter table public.brands
  add constraint brands_romanized_name_format
  check (
    romanized_name is null
    or (
      char_length(btrim(romanized_name)) between 1 and 100
      and btrim(romanized_name) ~ '^[a-zA-Z0-9 .''-]+$'
    )
  );

comment on column public.brands.romanized_name is
  'Owner-supplied English or romanized display metadata used to derive the public slug.';

create or replace function public.apply_brand_patch(
  p_brand_id uuid,
  p_patch jsonb,
  p_source text,
  p_actor uuid,
  p_job_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  patch_entry record;
  v_old_value jsonb;
  v_old_slug text;
  v_new_slug text;
begin
  select slug
  into v_old_slug
  from public.brands
  where id = p_brand_id
  for update;

  if not found then
    raise exception 'Brand not found' using errcode = 'P0002';
  end if;

  for patch_entry in
    select key, value
    from jsonb_each(p_patch)
  loop
    execute format(
      'select to_jsonb(%I) from public.brands where id = $1',
      patch_entry.key
    )
    into v_old_value
    using p_brand_id;

    execute format(
      'update public.brands set %1$I = (jsonb_populate_record(null::public.brands, jsonb_build_object($1, $2))).%1$I where id = $3',
      patch_entry.key
    )
    using patch_entry.key, patch_entry.value, p_brand_id;

    insert into public.brand_field_state (
      brand_id,
      field,
      source,
      updated_by,
      updated_at
    )
    values (
      p_brand_id,
      patch_entry.key,
      p_source,
      p_actor,
      now()
    )
    on conflict (brand_id, field) do update
    set source = excluded.source,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

    insert into public.brand_field_events (
      brand_id,
      field,
      old_value,
      new_value,
      source,
      actor,
      job_id
    )
    values (
      p_brand_id,
      patch_entry.key,
      v_old_value,
      patch_entry.value,
      p_source,
      p_actor,
      p_job_id
    );
  end loop;

  select slug into v_new_slug
  from public.brands
  where id = p_brand_id;

  if v_new_slug is distinct from v_old_slug then
    insert into public.brand_slug_redirects (old_slug, new_slug)
    values (v_old_slug, v_new_slug)
    on conflict (old_slug) do update
    set new_slug = excluded.new_slug;
  end if;
end;
$$;

revoke execute on function public.apply_brand_patch(uuid, jsonb, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.apply_brand_patch(uuid, jsonb, text, uuid, uuid)
  to service_role;

create or replace function public.approve_submission_with_romanized_name(
  p_submission_id uuid,
  p_reviewer_id uuid,
  p_brand_data jsonb
)
returns table (
  brand_id uuid,
  submitter_email text,
  brand_name text,
  submitter_name text,
  is_brand_owner boolean,
  suggested_tags jsonb
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_approval record;
begin
  select *
  into v_approval
  from public.approve_submission(
    p_submission_id,
    p_reviewer_id,
    p_brand_data
  );

  if not found then
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;

  update public.brands
  set romanized_name = nullif(btrim(p_brand_data ->> 'romanized_name'), '')
  where id = v_approval.brand_id;

  return query
  select
    v_approval.brand_id,
    v_approval.submitter_email,
    v_approval.brand_name,
    v_approval.submitter_name,
    v_approval.is_brand_owner,
    v_approval.suggested_tags;
end;
$$;

revoke execute on function public.approve_submission_with_romanized_name(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.approve_submission_with_romanized_name(uuid, uuid, jsonb)
  to service_role;
