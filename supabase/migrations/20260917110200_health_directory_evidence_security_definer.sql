-- DEV-1748 -- switch read_health_directory_database_evidence to SECURITY DEFINER.
--
-- WHY: the new health agent connects with a scoped database role
-- (health_agent_reader) that has no direct access to pg_catalog views like
-- pg_stat_activity, pg_settings, pg_stat_user_tables, or pg_class.
-- SECURITY INVOKER means the function runs as that caller and sees nothing.
-- SECURITY DEFINER makes it run as the function owner (postgres), which does
-- have access. The function is read-only (STABLE) and already has its grants
-- locked down to service_role + health_agent_reader.
--
-- Body copied verbatim from
-- 20260727130000_unify_health_lifecycle.sql lines 165-212.
-- Only change: SECURITY INVOKER -> SECURITY DEFINER.
--
-- CREATE OR REPLACE, deliberately NOT DROP: preserves existing ACL.
--
-- ROLLBACK: CREATE OR REPLACE with SECURITY INVOKER.

CREATE OR REPLACE FUNCTION public.read_health_directory_database_evidence()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
  SELECT jsonb_build_object(
    'connections', jsonb_build_object(
      'total', (SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE datname = current_database()),
      'maximum', (SELECT setting::integer FROM pg_catalog.pg_settings WHERE name = 'max_connections')
    ),
    'activeQueries', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'queryId', md5(COALESCE(query, '') || ':' || pid::text),
        'durationSeconds', EXTRACT(EPOCH FROM (clock_timestamp() - query_start))
      ) ORDER BY pid)
      FROM pg_catalog.pg_stat_activity
      WHERE datname = current_database() AND state = 'active' AND pid <> pg_backend_pid()
    ), '[]'::jsonb),
    'deadTupleSnapshots', jsonb_build_array(jsonb_build_object(
      'snapshotDate', current_date,
      'tables', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'tableName', stats.relname,
          'liveTuples', stats.n_live_tup,
          'deadTuples', stats.n_dead_tup,
          'autovacuumThreshold', COALESCE(
            (SELECT split_part(option, '=', 2)::numeric FROM unnest(classes.reloptions) AS option WHERE option LIKE 'autovacuum_vacuum_threshold=%'),
            current_setting('autovacuum_vacuum_threshold')::numeric
          ) + COALESCE(
            (SELECT split_part(option, '=', 2)::numeric FROM unnest(classes.reloptions) AS option WHERE option LIKE 'autovacuum_vacuum_scale_factor=%'),
            current_setting('autovacuum_vacuum_scale_factor')::numeric
          ) * stats.n_live_tup,
          'deadTuplePercent', CASE
            WHEN stats.n_live_tup + stats.n_dead_tup > 0
              THEN 100.0 * stats.n_dead_tup / (stats.n_live_tup + stats.n_dead_tup)
            ELSE 0
          END
        ) ORDER BY stats.relname)
        FROM pg_catalog.pg_stat_user_tables AS stats
        JOIN pg_catalog.pg_class AS classes ON classes.oid = stats.relid
        WHERE stats.schemaname = 'public'
      ), '[]'::jsonb)
    )),
    'indexConcerns', '[]'::jsonb
  );
$$;

-- Re-state grants from 20260727130000_unify_health_lifecycle.sql lines 239, 251-254.
REVOKE ALL ON FUNCTION public.read_health_directory_database_evidence()
  FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.read_health_directory_database_evidence()
      TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'health_agent_writer') THEN
    GRANT EXECUTE ON FUNCTION public.read_health_directory_database_evidence()
      TO health_agent_writer;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'health_agent_reader') THEN
    GRANT EXECUTE ON FUNCTION public.read_health_directory_database_evidence()
      TO health_agent_reader;
  END IF;
END;
$$;
