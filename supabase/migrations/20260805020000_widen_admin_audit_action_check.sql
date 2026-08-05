-- Widen admin_audit_log_action_check to cover the full AdminAction union.
--
-- This is a BUG FIX, not a schema tidy. The live constraint (verified against
-- the linked project on 2026-08-04, not inferred from migration files) allows
-- 10 values, while the TypeScript AdminAction union has 11. The missing member
-- is 'channel_removed', so every logAdminAction({ action: 'channel_removed' })
-- has been failing its CHECK and dropping the audit record on the floor.
--
-- The stale-looking 6-value list in 20260630100000_create_admin_audit_log.sql is
-- not the live shape; 20260720140736_scheduled_brand_refresh.sql already widened
-- it to 10. This migration follows that same drop-and-re-add pattern.

begin;

alter table public.admin_audit_log
  drop constraint if exists admin_audit_log_action_check;

alter table public.admin_audit_log
  add constraint admin_audit_log_action_check check (action in (
    'impersonate_start', 'impersonate_end', 'brand_edit', 'draft_save',
    'draft_publish', 'draft_discard', 'curation_job_cancelled',
    'newsletter_confirmation_resent', 'newsletter_unsubscribed',
    'refresh_requested', 'channel_removed'
  ));

comment on constraint admin_audit_log_action_check on public.admin_audit_log is
  'Must stay in sync with the AdminAction union in src/lib/services/admin-audit.ts. The admin-audit test asserts every union member inserts successfully.';

commit;
