begin;

-- `approve_submission` has no canonical source file: patch the live definition
-- before dropping the column it still snapshots. Each replacement is guarded
-- so a drifted definition fails loudly instead of silently losing a field.
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
  if v_body is null then
    raise exception '%: function definition is missing', v_label;
  end if;

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
  v_updated text;
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'brands'
      and column_name = 'retail_locations'
  ) then
    raise exception 'brands.retail_locations precondition failed: column is missing';
  end if;

  if exists (
    select 1
    from public.brands
    where coalesce(retail_locations, '[]'::jsonb) <> '[]'::jsonb
  ) then
    raise exception 'brands.retail_locations precondition failed: non-empty data remains';
  end if;

  select pg_get_functiondef(
    'public.approve_submission(uuid,uuid,jsonb)'::regprocedure
  ) into v_definition;

  v_updated := pg_temp.patch_once(
    v_definition,
    $old$purchase_shopee, purchase_myship, other_urls, retail_locations, contact_email$old$,
    $new$purchase_shopee, purchase_myship, other_urls, contact_email$new$,
    'approve_submission brands insert columns'
  );
  v_updated := pg_temp.patch_once(
    v_updated,
    $old$brand.purchase_shopee, brand.purchase_myship, coalesce(brand.other_urls, '[]'::jsonb),
    coalesce(brand.retail_locations, '[]'::jsonb), brand.contact_email$old$,
    $new$brand.purchase_shopee, brand.purchase_myship, coalesce(brand.other_urls, '[]'::jsonb),
    brand.contact_email$new$,
    'approve_submission brands select values'
  );
  v_updated := pg_temp.patch_once(
    v_updated,
    $old$other_urls jsonb, retail_locations jsonb, contact_email text$old$,
    $new$other_urls jsonb, contact_email text$new$,
    'approve_submission jsonb input declaration'
  );

  if position('retail_locations' in v_updated) > 0 then
    raise exception 'approve_submission post-patch guard failed: retail_locations reference remains';
  end if;

  execute v_updated;

  select pg_get_functiondef(
    'public.approve_submission(uuid,uuid,jsonb)'::regprocedure
  ) into v_definition;
  if position('retail_locations' in v_definition) > 0 then
    raise exception 'approve_submission post-execute guard failed: retail_locations reference remains';
  end if;
end
$migration$;

alter table public.brands drop column retail_locations;

do $postcondition$
declare
  v_definition text;
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'brands'
      and column_name = 'retail_locations'
  ) then
    raise exception 'brands.retail_locations postcondition failed: column still exists';
  end if;

  select pg_get_functiondef(
    'public.approve_submission(uuid,uuid,jsonb)'::regprocedure
  ) into v_definition;
  if position('retail_locations' in v_definition) > 0 then
    raise exception 'approve_submission postcondition failed: retail_locations reference remains';
  end if;
end
$postcondition$;

drop function pg_temp.patch_once(text, text, text, text);

commit;
