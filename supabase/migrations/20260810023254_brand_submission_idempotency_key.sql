begin;

alter table public.brand_submissions
  add column idempotency_key uuid;

comment on column public.brand_submissions.idempotency_key is
  'Stable client-generated request identity for public submission retries; null for legacy and non-interactive callers.';

create unique index brand_submissions_idempotency_key_idx
  on public.brand_submissions (idempotency_key)
  where idempotency_key is not null;

commit;
