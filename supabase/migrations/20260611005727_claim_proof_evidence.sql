-- Add proof_evidence JSONB and relax single proof_type (DEV-768 '2 of N' model)
alter table public.claim_requests
  add column if not exists proof_evidence jsonb not null default '[]'::jsonb;

alter table public.claim_requests
  alter column proof_type drop not null;

comment on column public.claim_requests.proof_evidence is
  'DEV-768: array of owner-supplied ownership proofs [{ type, url?, imageKey?, note? }] (>=2 enforced in app layer).';
