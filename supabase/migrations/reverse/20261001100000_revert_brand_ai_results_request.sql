-- Reverts 20261001100000_brand_ai_results_request.sql
-- Drops the brand_ai_results.request column (DEV-1902). Stored requests are lost.
alter table public.brand_ai_results drop column if exists request;
