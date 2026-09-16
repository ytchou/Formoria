-- Reverts 20260916100000_brand_embeddings.sql
-- Drops the search_brands_by_centroid RPC and the brand_embeddings table.

begin;

drop function if exists public.search_brands_by_centroid(extensions.vector, text, uuid, int);
drop table if exists public.brand_embeddings cascade;

commit;
