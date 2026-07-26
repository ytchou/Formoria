REVOKE EXECUTE ON FUNCTION public.reconcile_health_fix_lifecycle(text[])
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reconcile_health_fix_lifecycle(text[])
TO health_agent_writer, service_role;
