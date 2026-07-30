-- Bulk approval hangs for 20-40s whenever a refresh submission is in the batch.
--
-- Cause: apply_brand_refresh opens with `select ... for update` on the
-- submission and its brand. When an earlier caller's HTTP request goes away
-- mid-flight (aborted fetch, closed tab, gateway timeout), PostgREST leaves the
-- transaction open and those row locks squat. `inspect db locks` shows the
-- squatters parked on `BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE`, and
-- `inspect db blocking` shows one apply_brand_refresh blocked by another. The
-- function itself is fast — a full apply runs in ~190ms on a quiet database.
--
-- Two guards, because either alone leaves a hole:
--   A. lock_timeout on the apply functions, so a blocked caller fails in 2s with
--      a retryable error instead of hanging until the client gives up.
--   B. idle_in_transaction_session_timeout on the PostgREST roles, so abandoned
--      transactions release their locks instead of squatting indefinitely.

begin;

-- A. Function-scoped lock_timeout. Applies to everything the function calls, so
-- the gate function inherits it when reached through the wrapper; it is set
-- there too because the gate is callable on its own.
alter function public.apply_brand_refresh(uuid, uuid)
  set lock_timeout = '2s';
alter function public.apply_brand_refresh_with_protected_location_gate(uuid, uuid)
  set lock_timeout = '2s';

-- B. PostgREST applies pg_db_role_setting entries per request, which is how the
-- existing statement_timeout works for the non-login roles anon/authenticated.
-- service_role deliberately has no statement_timeout (admin work can be slow),
-- but nothing should sit idle *inside* a transaction: a healthy PostgREST
-- request is BEGIN -> query -> COMMIT with no gap, so this only ever fires on a
-- transaction whose caller has vanished.
alter role service_role set idle_in_transaction_session_timeout = '10s';
alter role authenticator set idle_in_transaction_session_timeout = '10s';

commit;

-- Role settings are cached in the PostgREST schema cache.
notify pgrst, 'reload config';
