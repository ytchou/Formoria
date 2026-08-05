begin;

-- Append-only span index for external and internal service calls. Every call
-- writes exactly two rows: one `started` row when the call is dispatched and
-- one terminal row when it settles. Rows are never updated or deleted, so the
-- table is a durable trace even when the subject it describes is gone.
create table public.external_call_audit (
  id uuid primary key default gen_random_uuid(),
  span_id uuid not null,
  correlation_id uuid not null,
  causation_id uuid,
  kind text not null check (kind in ('external', 'service')),
  subject_id uuid,
  job_id uuid references public.curation_jobs(id) on delete set null,
  status text not null check (
    status in (
      'started',
      'succeeded',
      'empty',
      'failed',
      'malformed',
      'timeout',
      'network_error'
    )
  ),
  provider text not null,
  operation text not null,
  latency_ms integer,
  retry_attempt integer,
  payload_storage_path text,
  summary jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

comment on table public.external_call_audit is
  'Append-only audit trail for external and internal service calls: two rows per span (one `started`, one terminal). Rows are never updated or deleted. `causation_id` and `subject_id` are deliberately plain uuid columns and NOT foreign keys — `span_id` is non-unique so `causation_id` cannot reference it, and the audit trail must outlive (and never cascade with) the subjects it describes.';

comment on column public.external_call_audit.span_id is
  'Groups the `started` row with its terminal row. Not unique: exactly two rows share it.';

comment on column public.external_call_audit.causation_id is
  'The span_id of the call that caused this one. Plain uuid by design — no FK, no cascade.';

comment on column public.external_call_audit.subject_id is
  'The domain entity this call was made for (brand, image, …). Plain uuid by design — audit outlives its subjects.';

comment on column public.external_call_audit.latency_ms is
  'Set on terminal rows only; null on `started` rows.';

create index external_call_audit_span_idx
  on public.external_call_audit (span_id);

create index external_call_audit_correlation_idx
  on public.external_call_audit (correlation_id);

create index external_call_audit_job_created_idx
  on public.external_call_audit (job_id, created_at);

create index external_call_audit_provider_created_idx
  on public.external_call_audit (provider, created_at desc);

-- Failure triage reads only non-happy-path terminal rows, which are a small
-- fraction of the table.
create index external_call_audit_problem_status_idx
  on public.external_call_audit (status)
  where status not in ('started', 'succeeded');

-- Makes a duplicate start row for the same span impossible, so a span can never
-- be double-opened by a retried dispatch.
create unique index external_call_audit_started_span_unique
  on public.external_call_audit (span_id)
  where status = 'started';

alter table public.external_call_audit enable row level security;

revoke all on table public.external_call_audit from public, anon, authenticated;

grant all on table public.external_call_audit to service_role;

-- Collapses the two rows of a span into one row so latency, terminal status and
-- provider can be read without hand-writing the self-join each time.
create or replace view public.external_call_audit_spans
with (security_invoker = true) as
select
  started.span_id,
  started.correlation_id,
  started.causation_id,
  started.kind,
  started.subject_id,
  started.job_id,
  started.provider,
  started.operation,
  started.created_at as started_at,
  finished.created_at as finished_at,
  finished.status as terminal_status,
  finished.latency_ms,
  finished.retry_attempt,
  coalesce(finished.payload_storage_path, started.payload_storage_path)
    as payload_storage_path,
  finished.summary,
  finished.error_message
from public.external_call_audit as started
left join lateral (
  select terminal.*
  from public.external_call_audit as terminal
  where terminal.span_id = started.span_id
    and terminal.status <> 'started'
  order by terminal.created_at desc
  limit 1
) as finished on true
where started.status = 'started';

comment on view public.external_call_audit_spans is
  'One row per call span: the `started` row joined to its terminal row, exposing start time, finish time, terminal status and latency. `terminal_status` is null while a span is still in flight.';

revoke all on table public.external_call_audit_spans from public, anon, authenticated;

grant select on table public.external_call_audit_spans to service_role;

commit;
