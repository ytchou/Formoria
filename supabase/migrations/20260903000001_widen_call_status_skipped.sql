-- Widen call_status CHECK to include 'skipped' (directive-driven skip in scraper)
do $$
begin
  -- brand_search_results
  if exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public' and table_name = 'brand_search_results'
      and constraint_name = 'brand_search_results_call_status_check'
  ) then
    alter table public.brand_search_results drop constraint brand_search_results_call_status_check;
  end if;
  alter table public.brand_search_results add constraint brand_search_results_call_status_check
    check (call_status in ('started','succeeded','empty','failed','malformed','timeout','network_error','skipped'));

  -- external_call_audit (inline CHECK, not named — Postgres auto-names it)
  if exists (
    select 1 from information_schema.check_constraints
    where constraint_schema = 'public'
      and constraint_name like 'external_call_audit_%check%'
      and check_clause like '%network_error%'
      and check_clause not like '%skipped%'
  ) then
    -- The auto-generated name follows the pattern external_call_audit_status_check
    -- but Postgres may suffix it. Find and drop it dynamically.
    execute (
      select format('alter table public.external_call_audit drop constraint %I',
                    constraint_name)
      from information_schema.check_constraints
      where constraint_schema = 'public'
        and constraint_name like 'external_call_audit_%check%'
        and check_clause like '%network_error%'
      limit 1
    );
  end if;
  alter table public.external_call_audit add constraint external_call_audit_status_check
    check (status in ('started','succeeded','empty','failed','malformed','timeout','network_error','skipped'));
end $$;
