-- Health agent self-heal unblocking: DEV-1429 and DEV-1430.
--
-- Both functions are CREATE OR REPLACE and safe to re-apply.
--
-- Grants deliberately mirror claim_health_fixes / transition_health_fix:
-- service_role and health_agent_writer only. A new function inherits Supabase's
-- default privileges, which include anon and authenticated, so EXECUTE is
-- revoked by role name rather than relying on revoking from PUBLIC alone.

-- DEV-1429 -------------------------------------------------------------------
-- claim_health_fixes increments attempt_count when it claims. A run that dies
-- before the repair stage therefore spends an attempt on nothing, and two
-- crashes retire a finding that was never worked on. Called at the end of every
-- run for rows still sitting in 'claimed' under that run's lease: if a repair
-- had happened, transition_health_fix would already have moved the row out of
-- 'claimed'. Anything still claimed was never attempted, so give the attempt
-- back and return it to the queue.
create or replace function public.release_health_fix_claims(
  p_lease_owner text
)
returns setof public.health_fix_queue
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if p_lease_owner is null or btrim(p_lease_owner) = '' then
    raise exception 'lease owner is required';
  end if;

  return query
  update public.health_fix_queue as queue
  set status = 'pending',
      lease_owner = null,
      lease_expires_at = null,
      attempt_count = greatest(queue.attempt_count - 1, 0),
      next_attempt_at = now(),
      updated_at = now()
  where queue.status = 'claimed'
    and queue.lease_owner = p_lease_owner
  returning queue.*;
end;
$function$;

revoke all on function public.release_health_fix_claims(text) from public;
revoke all on function public.release_health_fix_claims(text) from anon;
revoke all on function public.release_health_fix_claims(text) from authenticated;
grant execute on function public.release_health_fix_claims(text) to service_role;
grant execute on function public.release_health_fix_claims(text) to health_agent_writer;

-- DEV-1430 -------------------------------------------------------------------
-- enqueue_health_fix upserts on fingerprint while the row is in any live status,
-- and 'deployed' is in that set. The canary shipped once, landed on 'deployed',
-- and every later enqueue merely updated it in place — so it never returned to
-- a claimable status and canary_fix has rehearsed nothing since 2026-07-27.
--
-- Restricted to canary fingerprints. This resets attempt_count, so exposing it
-- to arbitrary fingerprints would be a way to bypass the two-attempt retirement
-- budget on real findings.
create or replace function public.rearm_health_fix_canary(
  p_fingerprint text
)
returns setof public.health_fix_queue
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if p_fingerprint is null or btrim(p_fingerprint) = '' then
    raise exception 'fingerprint is required';
  end if;

  if p_fingerprint not like '%:canary:%' then
    raise exception 'rearm is restricted to canary fingerprints: %', p_fingerprint;
  end if;

  -- Exactly one row, not every row sharing the fingerprint. The queue keeps
  -- terminal history (`fixed`, `skipped`) alongside the live row, and
  -- health_fix_queue_active_fingerprint_idx is a partial unique index over the
  -- active statuses — so re-arming every historical row tries to make four rows
  -- active at once and fails with 23505. Target only the row currently holding
  -- the active slot; if it is already pending there is nothing to do.
  return query
  update public.health_fix_queue as queue
  set status = 'pending',
      lease_owner = null,
      lease_expires_at = null,
      attempt_count = 0,
      last_error = null,
      next_attempt_at = now(),
      updated_at = now()
  where queue.id = (
    select active.id
    from public.health_fix_queue as active
    where active.fingerprint = p_fingerprint
      and active.status in (
        'claimed',
        'pr_opened',
        'awaiting_human',
        'merged',
        'deployed',
        'failed',
        'needs_human'
      )
    order by active.updated_at desc
    limit 1
  )
  returning queue.*;
end;
$function$;

revoke all on function public.rearm_health_fix_canary(text) from public;
revoke all on function public.rearm_health_fix_canary(text) from anon;
revoke all on function public.rearm_health_fix_canary(text) from authenticated;
grant execute on function public.rearm_health_fix_canary(text) to service_role;
grant execute on function public.rearm_health_fix_canary(text) to health_agent_writer;
