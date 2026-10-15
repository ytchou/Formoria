-- DEV-2036 (CODE-07): drop Postgres functions with no remaining caller.
-- Verified read-only on production and staging 2026-10-15: no pg_depend dependents,
-- no trigger, no cron.job, no view, no policy, and no other function body references
-- them; no application code calls them via .rpc().
--   health-fix lifecycle + snapshot: runtime deleted in the 2026-10-08 WP1 sweep
--   record_link_health_result: its route was deleted
--   apply_founding_fact_audit_patch, update_brand_channel_districts: one-shot backfills
-- Kept on purpose (still live): recount_brand_model_faq (called by trigger function
-- sync_brand_model_faq_count) and dev1648_l2_order / dev1648_l2_ordinal /
-- dev1648_aligned_subcategory_labels / dev1648_release_brand_product_subcategory
-- (called by trigger functions on brands and curated_products).
-- Reverse: supabase/migrations/reverse/20261015120000_revert_drop_orphan_functions.sql

drop function if exists public.apply_founding_fact_audit_patch(uuid,jsonb,jsonb,jsonb,text,uuid,boolean);
drop function if exists public.rearm_health_fix_canary(text);
drop function if exists public.record_health_snapshot(date,jsonb);
drop function if exists public.record_link_health_result(uuid,text,text,integer,timestamp with time zone);
drop function if exists public.transition_health_fix(uuid,text,text,text,text,timestamp with time zone,bigint,text,text,timestamp with time zone,jsonb);
drop function if exists public.update_brand_channel_districts(jsonb);
drop function if exists public.verify_health_fix_absence(uuid,text);
