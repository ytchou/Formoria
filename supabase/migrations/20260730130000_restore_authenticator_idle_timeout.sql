begin;

-- Restore the 10s idle_in_transaction_session_timeout that 20260730030000 set
-- on `authenticator`.
--
-- 20260730120100 raised it to 120s. Both migrations were written the same day
-- against the same incident, and because 120100 sorts later it silently
-- loosened a guard 030000 had deliberately tightened -- an abandoned
-- transaction now squats for two minutes instead of ten seconds. 030000's value
-- is the intended one: service_role already sits at 10s, so this also puts the
-- two PostgREST roles back in agreement.
--
-- client_connection_check_interval from 120100 is deliberately left in place.
-- It covers a case neither idle timeout does: a backend still 'active' on a
-- query whose client has gone away, which is the state several of the squatting
-- apply_brand_refresh backends were found in.
do $migration$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    raise notice 'role authenticator not present; skipping';
    return;
  end if;

  execute 'alter role authenticator set idle_in_transaction_session_timeout = ''10s''';
end
$migration$;

commit;
