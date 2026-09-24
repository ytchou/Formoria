-- DEV-1854: hand an ops-bot e2e dispatch (prod) to the staging e2e agent via a claim endpoint.
alter table public.ops_agent_requests
  add column if not exists dispatched_at timestamptz,
  add column if not exists dispatch_claimed_at timestamptz,
  add column if not exists dispatch_run_id text,
  add column if not exists dispatch_completed_at timestamptz;

create index if not exists ops_agent_requests_pending_dispatch_idx
  on public.ops_agent_requests (dispatched_at)
  where dispatched_at is not null and dispatch_claimed_at is null;
