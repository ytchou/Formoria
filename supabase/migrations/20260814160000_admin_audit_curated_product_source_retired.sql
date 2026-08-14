-- Widen admin_audit_log_action_check for 'curated_product_source_retired'
-- (DEV-1465 review fix A12).
--
-- A NEW file rather than an edit to 20260814090000: that one is already applied
-- to staging, and an edited-in-place migration is a no-op there while looking
-- applied locally.
--
-- Required, not cosmetic: logAdminAction is fire-and-forget and swallows its
-- insert error, so a value the CHECK rejects drops the audit record silently.
-- Same drop-and-re-add pattern; the list below is the previous 13 values plus
-- the new one.

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
    'curated_product_source_retired'
  ));

comment on constraint admin_audit_log_action_check on public.admin_audit_log is
  'Must stay in sync with the AdminAction union in src/lib/services/admin-audit.ts. The admin-audit test asserts every union member inserts successfully.';

commit;
