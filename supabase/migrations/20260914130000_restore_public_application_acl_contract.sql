-- DEV-1722: restore the P0 application ACL contract.
--
-- The original migration 20260806020000_contract_public_application_acl is
-- recorded in supabase_migrations.schema_migrations but its GRANT/REVOKE
-- effects are absent from the live staging database — anon holds ALL on 53
-- of 54 public tables. A re-push cannot restore the grants because the
-- migration version is already in the ledger. This migration re-applies the
-- full contract. Idempotent: safe on production whether or not the same
-- drift exists there.
--
-- The staging_auth_email_captures table has its own ACL contract (migration
-- 20260914120000, DEV-1720). The broad GRANT ALL TO service_role here
-- widens service_role on that table from SELECT+DELETE to ALL — acceptable
-- because service_role is the administrative role, and the important
-- restrictions (anon/authenticated revoked) are preserved.

BEGIN;

-- 1. Revoke application JWT roles from all public objects.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- 2. Close the door for future objects created by postgres.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO service_role;

-- 3. Restore service_role access.
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- 4. Restore health-agent role grants.
DO $$
DECLARE
  routine record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'health_agent_reader') THEN
    GRANT USAGE ON SCHEMA public TO health_agent_reader;
    GRANT SELECT ON TABLE
      public.brands,
      public.health_fix_queue,
      public.health_snapshots,
      public.link_check_results,
      public.health_agent_run_ledger
      TO health_agent_reader;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'health_agent_writer') THEN
    GRANT USAGE ON SCHEMA public TO health_agent_writer;
  END IF;

  FOR routine IN
    SELECT n.nspname AS schema_name,
           p.proname AS function_name,
           pg_get_function_identity_arguments(p.oid) AS arguments
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'claim_health_agent_run',
        'claim_health_fixes',
        'complete_health_agent_run',
        'enqueue_health_fix',
        'fail_health_agent_run',
        'read_health_directory_database_evidence',
        'record_health_snapshot',
        'record_link_health_result',
        'reconcile_health_fix_lifecycle',
        'transition_health_fix',
        'verify_health_fix_absence'
      )
  LOOP
    IF routine.function_name = 'read_health_directory_database_evidence' THEN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'health_agent_reader') THEN
        EXECUTE format(
          'GRANT EXECUTE ON FUNCTION %I.%I(%s) TO health_agent_reader',
          routine.schema_name,
          routine.function_name,
          routine.arguments
        );
      END IF;
    ELSIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'health_agent_writer') THEN
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION %I.%I(%s) TO health_agent_writer',
        routine.schema_name,
        routine.function_name,
        routine.arguments
      );
    END IF;
  END LOOP;
END;
$$;

-- 5. Re-enable RLS on all ordinary and partitioned tables (idempotent).
DO $$
DECLARE
  relation record;
BEGIN
  FOR relation IN
    SELECT c.relname
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation.relname);
  END LOOP;
END;
$$;

-- 6. Keep search paths immutable on public-facing SECURITY DEFINER RPCs.
--    Dynamic: signatures evolve across migrations; hardcoding them breaks.
DO $$
DECLARE
  routine record;
BEGIN
  FOR routine IN
    SELECT n.nspname AS schema_name,
           p.proname AS function_name,
           pg_get_function_identity_arguments(p.oid) AS arguments
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('search_brands', 'search_brand_page')
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I.%I(%s) SET search_path = public, pg_temp',
      routine.schema_name,
      routine.function_name,
      routine.arguments
    );
  END LOOP;
END;
$$;

-- 7. Close GraphQL RPC surface.
DO $$
DECLARE
  routine record;
BEGIN
  FOR routine IN
    SELECT n.nspname AS schema_name,
           p.proname AS function_name,
           pg_get_function_identity_arguments(p.oid) AS arguments
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('graphql_public', 'public')
      AND p.proname = 'graphql'
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated',
      routine.schema_name,
      routine.function_name,
      routine.arguments
    );
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION %I.%I(%s) TO service_role',
        routine.schema_name,
        routine.function_name,
        routine.arguments
      );
    END IF;
  END LOOP;
END;
$$;

-- 8. Restore the staging_auth_email_captures per-table contract (DEV-1720).
--    The broad service_role grant above gave ALL; narrow back to the hook's
--    original design: supabase_auth_admin INSERT, service_role SELECT+DELETE.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'staging_auth_email_captures'
  ) THEN
    REVOKE ALL ON TABLE public.staging_auth_email_captures FROM service_role;
    GRANT SELECT, DELETE ON TABLE public.staging_auth_email_captures TO service_role;
    -- supabase_auth_admin INSERT grant is already in place from DEV-1720 migration
  END IF;
END;
$$;

COMMIT;
