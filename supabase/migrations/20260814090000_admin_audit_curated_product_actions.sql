-- Widen admin_audit_log_action_check for the curated-product editorial
-- decisions (DEV-1465).
--
-- Required, not cosmetic: logAdminAction is fire-and-forget and swallows its
-- insert error, so a value the CHECK rejects drops the audit record silently —
-- exactly the failure 20260805020000 was written to fix for 'channel_removed'.
-- The constraint comment there states the list must stay in sync with the
-- AdminAction union in src/lib/services/admin-audit.ts; this keeps that true.
--
-- Same drop-and-re-add pattern; the list below is the previous 11 values plus
-- the two new ones.

begin;

alter table public.admin_audit_log
  drop constraint if exists admin_audit_log_action_check;

alter table public.admin_audit_log
  add constraint admin_audit_log_action_check check (action in (
    'impersonate_start', 'impersonate_end', 'brand_edit', 'draft_save',
    'draft_publish', 'draft_discard', 'curation_job_cancelled',
    'newsletter_confirmation_resent', 'newsletter_unsubscribed',
    'refresh_requested', 'channel_removed',
    'curated_product_promoted', 'curated_product_retired'
  ));

comment on constraint admin_audit_log_action_check on public.admin_audit_log is
  'Must stay in sync with the AdminAction union in src/lib/services/admin-audit.ts. The admin-audit test asserts every union member inserts successfully.';

commit;
