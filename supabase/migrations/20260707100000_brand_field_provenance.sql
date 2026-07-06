-- Brand field provenance: per-field write tracking
create table brand_field_state (
  brand_id uuid not null references brands(id) on delete cascade,
  field text not null,
  source text not null check (source in ('enriched','owner','admin')),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  admin_locked boolean not null default false,
  primary key (brand_id, field)
);

create table brand_field_events (
  id bigserial primary key,
  brand_id uuid not null references brands(id) on delete cascade,
  field text not null,
  old_value jsonb,
  new_value jsonb,
  source text not null,
  actor uuid,
  job_id uuid references curation_jobs(id) on delete set null,
  created_at timestamptz not null default now()
);

create index brand_field_events_brand_idx on brand_field_events (brand_id, created_at desc);

alter table brand_field_state enable row level security;
alter table brand_field_events enable row level security;

create or replace function apply_brand_patch(
  p_brand_id uuid,
  p_patch jsonb,
  p_source text,
  p_actor uuid,
  p_job_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  patch_entry record;
  v_old_value jsonb;
begin
  for patch_entry in
    select key, value
    from jsonb_each(p_patch)
  loop
    execute format('select to_jsonb(%I) from brands where id = $1', patch_entry.key)
    into v_old_value
    using p_brand_id;

    execute format(
      'update brands set %1$I = (jsonb_populate_record(null::brands, jsonb_build_object($1, $2))).%1$I where id = $3',
      patch_entry.key
    )
    using patch_entry.key, patch_entry.value, p_brand_id;

    insert into brand_field_state (
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

    insert into brand_field_events (
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
end;
$$;
