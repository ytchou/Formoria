begin;

-- Keep the applied owner-pair repair migration immutable while adding the
-- grouped postcondition that catches a one-sided owner lock. A source owner
-- on either subcategory language must leave both final fields owner-protected.
do $migration$
begin
  if exists (
    select state.brand_id
    from public.brand_field_state as state
    where state.field in ('subcategories', 'subcategories_en')
    group by state.brand_id
    having bool_or(state.source = 'owner')
       and count(*) filter (where state.source = 'owner') <> 2
  ) then
    raise exception 'DEV-1503 subcategory owner pair assertion failed' using errcode = 'P0001';
  end if;
end
$migration$;

commit;
