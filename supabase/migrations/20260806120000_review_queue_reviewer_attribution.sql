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

-- Keep the new attribution columns off the owner-readable surface.
--
-- brand_reports carries `owner_select_brand_reports`, which lets a brand owner
-- SELECT their own brand's reports and has NO column restriction. anon and
-- authenticated hold a TABLE-level SELECT grant, so a newly added column is
-- readable the moment it exists — meaning an admin's internal note ("reporter
-- is a competitor, ignoring") would be readable by the very brand it is about.
-- Postgres has no column-level RLS, so the grant is the only lever: replace the
-- table-level grant with an explicit column list.
--
-- This is deliberately NOT applied to moderation_flags: that table has only a
-- service_role policy, so it has no owner-facing read path to protect.
--
-- App code is unaffected — every brand_reports query in src/lib/services/
-- goes through createServiceClient(), and service_role bypasses both RLS and
-- column grants. This narrows direct PostgREST access only.
--
-- CEILING: this is an allowlist. Any column added to brand_reports later is
-- invisible to owners until it is added below. If that becomes a recurring
-- trip hazard, move reviewer notes to a service_role-only side table instead.
revoke select on public.brand_reports from anon, authenticated;

grant select (
  id,
  brand_id,
  reason,
  notes,
  status,
  reviewed_at,
  created_at,
  user_id,
  reported_field
) on public.brand_reports to anon, authenticated;
