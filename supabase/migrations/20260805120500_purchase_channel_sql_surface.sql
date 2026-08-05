-- DEV-1307 — read-only introspection accessor for the purchase-channel parity test.
--
-- Split out of `20260805120000_add_purchase_myship.sql` so that migration stays
-- free of any `pg_get_functiondef` reference: the function bodies there are full
-- literal re-materializations, never anchor-patched, and a grep gate enforces it.
--
-- PostgREST exposes only the `public` schema, so an integration test using
-- the Supabase JS client cannot read `information_schema` / `pg_catalog`
-- directly. This narrow, read-only accessor returns exactly the four
-- surfaces the parity test asserts on. It is NOT a general SQL executor;
-- the object names it reads are fixed literals.
--
-- Execute is revoked from anon/authenticated so function bodies are never
-- reachable from the browser.
-- =====================================================================

create or replace function public.purchase_channel_sql_surface()
 returns jsonb
 language sql
 stable
 set search_path to ''
as $function$
  select jsonb_build_object(
    'columns', (
      select coalesce(jsonb_agg(column_entry.qualified order by column_entry.qualified), '[]'::jsonb)
      from (
        select c.table_name || '.' || c.column_name as qualified
        from information_schema.columns as c
        where c.table_schema = 'public'
          and c.table_name in ('brands', 'brand_submissions')
      ) as column_entry
    ),
    'constraints', (
      select coalesce(jsonb_object_agg(con.conname::text, pg_catalog.pg_get_constraintdef(con.oid)), '{}'::jsonb)
      from pg_catalog.pg_constraint as con
      where con.conname in (
        'link_check_results_field_check',
        'brand_field_corrections_field_check'
      )
    ),
    'functions', (
      select coalesce(jsonb_object_agg(routine.proname, routine.definition), '{}'::jsonb)
      from (
        select p.proname::text as proname,
               string_agg(pg_catalog.pg_get_functiondef(p.oid), E'\n') as definition
        from pg_catalog.pg_proc as p
        join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in (
            'approve_submission',
            'apply_brand_refresh_with_protected_location_gate',
            'correct_approved_submission_provenance',
            'get_brand_quality_metrics'
          )
        group by p.proname
      ) as routine
    )
  );
$function$;

revoke all on function public.purchase_channel_sql_surface() from public;
revoke all on function public.purchase_channel_sql_surface() from anon;
revoke all on function public.purchase_channel_sql_surface() from authenticated;
grant execute on function public.purchase_channel_sql_surface() to service_role;
