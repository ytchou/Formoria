alter table public.brand_ai_results
  add column if not exists audit_span_id uuid;

alter table public.brand_search_results
  add column if not exists audit_span_id uuid;

comment on column public.brand_ai_results.audit_span_id is
  'Correlates this deep-store row with its span in public.external_call_audit. Plain uuid by design - no FK, because span_id is non-unique (two rows share it) and the audit trail must outlive its subjects.';

comment on column public.brand_search_results.audit_span_id is
  'Correlates this deep-store row with its span in public.external_call_audit. Plain uuid by design - no FK, because span_id is non-unique (two rows share it) and the audit trail must outlive its subjects.';

create index if not exists brand_search_results_audit_span_idx
  on public.brand_search_results (audit_span_id);
