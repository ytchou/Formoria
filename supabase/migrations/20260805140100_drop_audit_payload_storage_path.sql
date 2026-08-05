begin;

-- DEV-1347: the raw-payload blob tier of the DEV-1316 audit design was never
-- built. `payload_storage_path` shipped with the table and nothing has ever
-- written it, so it is a trap for the next reader of the schema. Drop it; build
-- the tier (bucket, upload, redaction-before-gzip, size cap, pg_net purge) if an
-- unaudited provider ever burns us, at which point its shape will be known.

-- The view selects the column, so it has to go first; `create or replace view`
-- cannot drop a column from an existing view.
drop view public.external_call_audit_spans;

alter table public.external_call_audit
  drop column payload_storage_path;

create view public.external_call_audit_spans
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

-- A recreated view gets default privileges, so the original grants have to be
-- re-applied by role name.
revoke all on table public.external_call_audit_spans from public, anon, authenticated;

grant select on table public.external_call_audit_spans to service_role;

commit;
