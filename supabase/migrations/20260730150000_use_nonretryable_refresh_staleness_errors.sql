begin;

-- Staleness is a permanent precondition failure. SQLSTATE 40001 tells clients
-- to retry the same transaction, which hides the real error behind a timeout.
do $migration$
declare
  v_definition text;
  v_updated_definition text;
  v_match_count integer;
begin
  select pg_get_functiondef(
    'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure
  ) into v_definition;

  v_match_count := (
    length(v_definition) - length(replace(v_definition, 'using errcode = ''40001''', ''))
  ) / length('using errcode = ''40001''');
  if v_match_count <> 3 then
    raise exception 'Expected three refresh staleness SQLSTATE guards, found %', v_match_count;
  end if;

  v_updated_definition := replace(
    v_definition,
    'using errcode = ''40001''',
    'using errcode = ''P0001'''
  );
  execute v_updated_definition;

  select pg_get_functiondef(
    'public.apply_brand_refresh_locations(uuid[],uuid)'::regprocedure
  ) into v_definition;

  v_match_count := (
    length(v_definition) - length(replace(v_definition, 'using errcode = ''40001''', ''))
  ) / length('using errcode = ''40001''');
  if v_match_count <> 1 then
    raise exception 'Expected one location refresh staleness SQLSTATE guard, found %', v_match_count;
  end if;

  v_updated_definition := replace(
    v_definition,
    'using errcode = ''40001''',
    'using errcode = ''P0001'''
  );
  execute v_updated_definition;
end
$migration$;

commit;
