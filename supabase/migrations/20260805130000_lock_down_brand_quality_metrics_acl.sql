-- Close an ACL hole opened by 20260805120000_add_purchase_myship.sql.
--
-- That migration had to `drop function public.get_brand_quality_metrics()` before
-- recreating it, because its return type changed (a new purchase_myship_count
-- column). `drop function` discards the object's ACL, and the recreate then picked
-- up Supabase's DEFAULT PRIVILEGES for schema public, which grant EXECUTE to
-- `anon` and `authenticated` on every newly created function.
--
-- 20260805120000 tried to restore the lockdown by copying the original statements
-- from 20260721200000_brand_quality_metrics_rpc.sql:
--     revoke all on function ... from public;
--     grant execute on function ... to service_role;
-- That is NOT sufficient. `from public` only drops the implicit PUBLIC grant; the
-- default-privilege grants to `anon` and `authenticated` are explicit per-role
-- grants and survive it. Verified on the live project after the push:
--     get_brand_quality_metrics -> anon=X | authenticated=X | service_role=X
--     has_function_privilege('anon', ..., 'EXECUTE') = true
-- while every function that was CREATE OR REPLACE'd (approve_submission,
-- apply_brand_refresh_with_protected_location_gate) correctly kept
--     postgres=X | service_role=X
--
-- Consequence while open: any browser holding the anon publishable key could
-- POST /rest/v1/rpc/get_brand_quality_metrics and read site-wide directory
-- aggregates (total brands, per-channel link counts, completeness buckets).
--
-- RULE FOR NEXT TIME: whenever a function in schema `public` is DROPped rather
-- than replaced, revoke from `anon` and `authenticated` explicitly — revoking
-- from `public` is not enough. 20260805120500_purchase_channel_sql_surface.sql
-- gets this right and is the pattern to copy.

revoke all on function public.get_brand_quality_metrics() from anon;
revoke all on function public.get_brand_quality_metrics() from authenticated;
revoke all on function public.get_brand_quality_metrics() from public;
grant execute on function public.get_brand_quality_metrics() to service_role;
