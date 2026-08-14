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
    'curated_product_selection_placed', 'curated_product_selection_retired'
  ));

comment on constraint admin_audit_log_action_check on public.admin_audit_log is
  'Must stay in sync with the AdminAction union in src/lib/services/admin-audit.ts. The admin-audit test asserts every union member inserts successfully.';

commit;
