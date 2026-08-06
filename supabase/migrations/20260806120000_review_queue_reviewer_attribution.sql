-- Reviewer attribution for the shared admin review queue.
-- Brings brand_reports and moderation_flags in line with the existing precedent in
-- brand_field_corrections, origin_evidence, and claim_requests so every review domain
-- records who decided and why.
--
-- No backfill: both columns are nullable and historical rows keep NULL attribution,
-- which honestly reflects that those decisions predate attribution.
-- reviewed_by has no `on delete` clause (RESTRICT) to match the precedent tables.

alter table public.brand_reports
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists reviewer_notes text;

alter table public.moderation_flags
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists reviewer_notes text;
