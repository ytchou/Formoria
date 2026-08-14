-- DEV-1455: staging-only Auth email capture.
--
-- The Auth Send Email hook is enabled only in the isolated staging project.
-- Production may receive this inert schema during the normal migration flow,
-- but no production hook is configured and no production email is captured.

create table if not exists public.staging_auth_email_captures (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  recipient text not null,
  token_hash text not null,
  redirect_to text not null,
  created_at timestamptz not null default now(),
  constraint staging_auth_email_captures_action_check
    check (action in ('signup', 'recovery', 'email_change', 'magiclink', 'invite', 'reauthentication')),
  constraint staging_auth_email_captures_recipient_check
    check (recipient like 'e2e-signup-%'),
  constraint staging_auth_email_captures_token_hash_check
    check (length(token_hash) between 16 and 256),
  constraint staging_auth_email_captures_redirect_check
    check (redirect_to like 'https://staging.formoria.com/%')
);

alter table public.staging_auth_email_captures enable row level security;

grant usage on schema public to supabase_auth_admin;
revoke all on table public.staging_auth_email_captures from public;
revoke all on table public.staging_auth_email_captures from anon, authenticated;
revoke all on table public.staging_auth_email_captures from service_role;
grant insert on table public.staging_auth_email_captures to supabase_auth_admin;
grant select, delete on table public.staging_auth_email_captures to service_role;

drop policy if exists staging_auth_email_captures_hook_insert
  on public.staging_auth_email_captures;
create policy staging_auth_email_captures_hook_insert
  on public.staging_auth_email_captures
  for insert
  to supabase_auth_admin
  with check (
    recipient like 'e2e-signup-%'
    and length(token_hash) between 16 and 256
    and redirect_to like 'https://staging.formoria.com/%'
  );

drop policy if exists staging_auth_email_captures_test_access
  on public.staging_auth_email_captures;
create policy staging_auth_email_captures_test_access
  on public.staging_auth_email_captures
  for all
  to service_role
  using (true)
  with check (true);

-- Configure this function as the staging project's Auth > Hooks > Send Email
-- hook. It intentionally runs as the invoking supabase_auth_admin role: the
-- function cannot bypass RLS or write columns outside the capture contract.
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
  redirect_target text := event #>> '{email_data,redirect_to}';
begin
  -- Only the disposable E2E namespace is captured. This avoids turning an
  -- accidentally enabled hook into a general-purpose mail sink.
  if recipient is null or recipient not like 'e2e-signup-%' then
    return jsonb_build_object('success', true);
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

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.staging_capture_auth_email(jsonb) from public;
revoke all on function public.staging_capture_auth_email(jsonb) from anon, authenticated;
grant execute on function public.staging_capture_auth_email(jsonb) to supabase_auth_admin;

comment on table public.staging_auth_email_captures is
  'Staging-only, disposable Auth hook records. Never configure the hook in production.';
comment on function public.staging_capture_auth_email(jsonb) is
  'Invoker-rights Send Email Hook for staging E2E signup and recovery links.';
