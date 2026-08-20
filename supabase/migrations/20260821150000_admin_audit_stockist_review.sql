-- DEPLOY ORDER: apply this migration to staging BEFORE merging the code.
--
-- `reviewStockistAction` (src/app/admin/actions.ts) starts writing two action
-- values this CHECK constraint does not accept yet: `stockist_approved` and
-- `stockist_rejected`. Applying it early is free — no existing writer emits
-- either value, so nothing changes until the deploy lands.
--
-- Applying it LATE is not free, and the failure is silent: `logAdminAction`
-- swallows its own errors by design (fire-and-forget, so logging can never fail
-- an admin action), so a rejected insert raises 23514 into a `catch {}` and the
-- review simply goes unrecorded. Nothing catches it at build time either — the
-- Supabase service client is created without the <Database> generic, so tsc and
-- ESLint accept an insert of a value the database refuses.
--
-- `channel_removed` stays in the list. Its writer (`adminRemoveChannel`) was
-- deleted by DEV-1513, but historical rows carry the value and dropping it from
-- the constraint would make the existing table fail its own check.

begin;

alter table public.admin_audit_log
  drop constraint if exists admin_audit_log_action_check;

alter table public.admin_audit_log
  add constraint admin_audit_log_action_check check (action in (
    'impersonate_start', 'impersonate_end', 'brand_edit', 'draft_save',
    'draft_publish', 'draft_discard', 'curation_job_cancelled',
    'newsletter_confirmation_resent', 'newsletter_unsubscribed',
    'refresh_requested', 'channel_removed',
    'curated_product_promoted', 'curated_product_retired',
    'curated_product_source_retired',
    'curated_product_selection_placed', 'curated_product_selection_retired',
    'stockist_approved', 'stockist_rejected'
  ));

comment on constraint admin_audit_log_action_check on public.admin_audit_log is
  'Must stay in sync with the AdminAction union in src/lib/services/admin-audit.ts. The admin-audit test asserts every union member inserts successfully.';

commit;
