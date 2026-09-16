-- Reverts 20260916110000_explore_brand_pool_rpc.sql
-- Drops the get_explore_brand_pool RPC.

begin;

drop function if exists public.get_explore_brand_pool(text[], int, text);

commit;
