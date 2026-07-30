begin;

-- Stop abandoned PostgREST transactions from holding row locks forever.
--
-- apply_brand_refresh opens with `select ... for update`. When a request dies at
-- the API gateway's ~60s ceiling the client disappears, but the backend keeps
-- running and keeps the lock. On 2026-07-30 two brand_submissions rows were
-- pinned this way for over 19 hours, and every retry queued behind the zombie
-- and became another one, so the symptom presented as "the function is slow"
-- rather than "the row is locked".
--
-- Two settings, because the zombies showed up in two different states:
--   * idle_in_transaction_session_timeout reaps 'idle in transaction' and
--     'idle in transaction (aborted)' backends — the 19-hour one.
--   * client_connection_check_interval makes Postgres notice a vanished client
--     *during* query execution and abort — the 'active' + ClientRead ones.
--
-- Scoped to `authenticator` (PostgREST's login role) so ordinary psql sessions,
-- migrations, and maintenance scripts keep their current behaviour. Both are
-- USERSET GUCs and apply to sessions opened after this runs.
do $migration$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    raise notice 'role authenticator not present; skipping timeout hardening';
    return;
  end if;

  -- Generous next to a sub-second PostgREST transaction, tight next to 19 hours.
  execute 'alter role authenticator set idle_in_transaction_session_timeout = ''120s''';
  execute 'alter role authenticator set client_connection_check_interval = ''10s''';
end
$migration$;

commit;
