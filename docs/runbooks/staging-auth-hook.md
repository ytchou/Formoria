# Staging Auth capture runbook

Apply the migration through the guarded staging migration command, then enable
`public.staging_capture_auth_email(jsonb)` as the staging Supabase Auth Send
Email Hook. Configure no production hook and no SMTP/external provider for
this flow.

The hook accepts only recipients beginning `e2e-signup-` and stores the action,
recipient, token hash, redirect target, and timestamp. `supabase_auth_admin`
has insert/execute only; the staging service role has test select/delete access;
anonymous and authenticated clients have no access. Verify RLS and grants
before the first suite run.
