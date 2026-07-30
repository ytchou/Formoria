begin;

-- Bound how long a service-role request will WAIT for a row lock.
--
-- Follow-up to 20260730120100, which hardened `authenticator`. That was the
-- wrong role for this failure: PostgREST applies the settings of the role it
-- impersonates, and every server action and maintenance script here uses the
-- service-role key. service_role carried no lock_timeout at all, so
-- apply_brand_refresh's `select ... for update` waited unbounded on a contended
-- row until the API gateway gave up at ~60s -- and the backend it left behind
-- kept holding the lock for the next caller.
--
-- lock_timeout only caps lock *waiting*, not work, so long service-role jobs
-- (enrichment, backfills, curation) are unaffected. statement_timeout is left
-- unset on purpose for exactly that reason.
do $migration$
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise notice 'role service_role not present; skipping lock_timeout';
    return;
  end if;

  execute 'alter role service_role set lock_timeout = ''8s''';
end
$migration$;

commit;
