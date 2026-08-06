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

-- On the owner-readable surface: nothing to do here, deliberately.
--
-- brand_reports carries `owner_select_brand_reports`, which lets a brand owner
-- SELECT their own brand's reports with NO column restriction. On its own that
-- would make reviewer_notes — an admin's internal note about a report — readable
-- by the very brand the note is about.
--
-- It is closed by 20260806020000_contract_public_application_acl.sql, which runs
-- BEFORE this file and revokes ALL privileges on every public table from anon and
-- authenticated, plus ALTER DEFAULT PRIVILEGES so new objects cannot reopen the
-- Data API surface. With no grant, that SELECT policy is inert and these columns
-- are unreachable by an application JWT role.
--
-- An earlier revision of this migration re-granted SELECT on an explicit column
-- allowlist here. That was wrong: this file sorts AFTER the ACL contract, so the
-- grant would have run last and partially reopened the surface that contract
-- exists to close. Adding no grant is both safer and less code.
--
-- If brand owners ever need to read their reports again, serve it through a
-- service-role endpoint like every other brand_reports read in
-- src/lib/services/ — do not re-grant the table to anon/authenticated.
