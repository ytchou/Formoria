-- DEV-1720: restore staging_capture_auth_email hook grants.
--
-- The original migration 20260814084238 is in the schema_migrations ledger but
-- its GRANT/REVOKE statements are not in force in the live staging DB.
-- supabase_auth_admin has 0 table privileges in public, so the SECURITY INVOKER
-- hook fails with "permission denied" on every INSERT.
--
-- A re-push cannot restore the grants because the migration is already recorded.
-- This migration restores exactly the capture-table contract — nothing wider.
-- The schema-wide ACL drift (anon = ALL on 53 tables) is a separate issue.

-- 1. Table grants — restore the original contract
grant usage on schema public to supabase_auth_admin;

revoke all on table public.staging_auth_email_captures from public;
revoke all on table public.staging_auth_email_captures from anon, authenticated;
revoke all on table public.staging_auth_email_captures from service_role;

grant insert on table public.staging_auth_email_captures to supabase_auth_admin;
grant select, delete on table public.staging_auth_email_captures to service_role;

-- 2. Codify the live function body — the hand-patched coalesce default for
--    redirect_to keeps the insert NULL-safe and satisfies the CHECK constraint
--    (redirect_to like 'https://staging.formoria.com/%').
--    No DROP FUNCTION — that re-grants anon execute. CREATE OR REPLACE only.
create or replace function public.staging_capture_auth_email(event jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  recipient text := event #>> '{user,email}';
  email_action text := event #>> '{email_data,email_action_type}';
  token_hash_value text := event #>> '{email_data,token_hash}';
  redirect_target text := coalesce(
    event #>> '{email_data,redirect_to}',
    'https://staging.formoria.com/auth/callback'
  );
begin
  if recipient is null or recipient not like 'e2e-signup-%' then
    return '{}'::jsonb;
  end if;

  insert into public.staging_auth_email_captures (
    action,
    recipient,
    token_hash,
    redirect_to
  ) values (
    email_action,
    recipient,
    token_hash_value,
    redirect_target
  );

  return '{}'::jsonb;
end;
$$;

-- Keep function privileges unchanged — do not re-grant.
-- EXECUTE is already granted to supabase_auth_admin and revoked from public/anon/authenticated.
