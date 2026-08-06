BEGIN;

-- P0 contract: application JWT roles must not read or execute application
-- objects directly. Service-role and health-agent grants are restored below;
-- Auth and Storage schemas are intentionally outside this migration.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- New public objects must not silently reopen the Data API surface.
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

-- Keep service_role's existing application access explicit after the broad
-- revokes. Trigger functions remain callable internally; no direct execution
-- grant to application roles is needed for a trigger to fire.
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Health-agent roles are deliberately preserved. Their direct table grants
-- and the narrowly scoped function grants mirror the foundations migration.
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

-- RLS remains defense in depth even though application JWT roles no longer
-- have table privileges. Only ordinary and partitioned tables are included;
-- views and Auth/Storage schemas are untouched.
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

-- Keep search paths immutable for the application RPCs used by the public
-- directory. The ACL change must not introduce a mutable path into a
-- SECURITY DEFINER function.
ALTER FUNCTION public.search_brands(text, integer, boolean, text[], text[], text, text, boolean)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.search_brand_page(text, text[], text[], text, integer[], integer)
  SET search_path = public, pg_temp;

-- The API schema list intentionally contains only public. This explicit
-- revoke also closes a direct GraphQL RPC if the hosted project still has the
-- graphql_public helper function after config push.
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

COMMIT;
