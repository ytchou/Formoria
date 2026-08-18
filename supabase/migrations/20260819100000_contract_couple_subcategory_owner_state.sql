begin;

-- A subcategory owner lock is a coupled zh-TW/English contract. The initial
-- contraction selected each language independently, which could leave an
-- owner lock on one language paired with an enriched lock on the other. Pick
-- the newest owner row (with the zh-TW field as the stable tie-break), then
-- apply that owner metadata to both final fields.
with owner_pair_winner as (
  select distinct on (brand_id)
    brand_id,
    source,
    updated_by,
    updated_at,
    admin_locked
  from public.brand_field_state
  where field in ('subcategories', 'subcategories_en')
    and source = 'owner'
  order by brand_id,
    updated_at desc nulls last,
    (field = 'subcategories') desc,
    field
), owner_pair as (
  select
    winner.brand_id,
    fields.field,
    winner.source,
    winner.updated_by,
    winner.updated_at,
    winner.admin_locked
  from owner_pair_winner as winner
  cross join (values ('subcategories'::text), ('subcategories_en'::text)) as fields(field)
)
insert into public.brand_field_state (
  brand_id,
  field,
  source,
  updated_by,
  updated_at,
  admin_locked
)
select
  brand_id,
  field,
  source,
  updated_by,
  updated_at,
  admin_locked
from owner_pair
on conflict (brand_id, field) do update
set source = excluded.source,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at,
    admin_locked = excluded.admin_locked;

do $migration$
begin
  if exists (
    select 1
    from public.brand_field_state as state
    where state.source = 'owner'
      and state.field in ('subcategories', 'subcategories_en')
      and not exists (
        select 1
        from public.brand_field_state as paired
        where paired.brand_id = state.brand_id
          and paired.field in ('subcategories', 'subcategories_en')
          and paired.source = 'owner'
      )
  ) then
    raise exception 'DEV-1503 subcategory owner pair repair failed' using errcode = 'P0001';
  end if;
end
$migration$;

commit;
