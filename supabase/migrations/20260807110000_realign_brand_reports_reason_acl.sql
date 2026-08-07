-- DEV-1369: realign live `brand_reports` with the repo.
--
-- `20260716140002_consolidate_brand_removal_reports.sql` is recorded as applied
-- in `supabase_migrations.schema_migrations`, but NEITHER of its two statements
-- is present in the live database (verified 2026-08-07 on xkcayngbttpxyibgzern):
--
--   * `brand_reports_reason_check` still omits 'removal_request', so a removal
--     request cannot be inserted at all — `ReportReason` in
--     `src/lib/services/reports.ts` offers a value the database rejects.
--   * `owner_select_brand_reports` is still the pre-consolidation version:
--     created with no `TO` clause (live roles `{public}`, repo says
--     `TO authenticated`) and gating on `reason <> 'ownership_dispute'` only,
--     so `removal_request` reports are owner-readable when the repo says they
--     must not be.
--
-- Live is therefore stuck at `20260716120000_ownership_dispute_revoke.sql`. The
-- repo definition is authoritative; this migration re-applies it. The policy is
-- currently inert because `20260806020000_contract_public_application_acl.sql`
-- revoked every `anon`/`authenticated` table grant, so this closes a latent
-- widening rather than live exposure — but the constraint half is a real,
-- active bug on the removal-request path.
--
-- `public.brand_reports` holds zero rows at time of writing, so the constraint
-- swap needs no backfill or data repair.

BEGIN;

ALTER TABLE public.brand_reports
  DROP CONSTRAINT IF EXISTS brand_reports_reason_check;

ALTER TABLE public.brand_reports
  ADD CONSTRAINT brand_reports_reason_check CHECK (
    reason IN (
      'not_mit',
      'incorrect_info',
      'broken_link',
      'inappropriate',
      'ownership_dispute',
      'removal_request'
    )
  );

DROP POLICY IF EXISTS owner_select_brand_reports ON public.brand_reports;

CREATE POLICY owner_select_brand_reports
  ON public.brand_reports
  FOR SELECT
  TO authenticated
  USING (
    reason NOT IN ('ownership_dispute', 'removal_request')
    AND EXISTS (
      SELECT 1
      FROM public.brand_owners AS bo
      WHERE bo.brand_id = brand_reports.brand_id
        AND bo.user_id = (SELECT auth.uid())
    )
  );

COMMIT;
