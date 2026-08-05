begin;

alter table public.admin_audit_log
  add column if not exists correlation_id uuid;

comment on column public.admin_audit_log.correlation_id is
  'Plain uuid by design - no FK; the audit trail outlives its subjects. Nullable because Railway deploys application code and migrations non-atomically.';

create index if not exists idx_admin_audit_correlation
  on public.admin_audit_log (correlation_id);

commit;

-- Railway can deploy application code before this migration. Keep the column
-- nullable and the write path compatible with the pre-migration schema.
