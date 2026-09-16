-- Revert DEV-1736: restore search_products_semantic to the three-column
-- RETURNS TABLE from 20260915140000_situation_search_pool_100.sql.
-- The taxonomy trigger is unchanged by this migration and is not touched here.

drop function if exists public.search_products_semantic(text, extensions.vector, text, integer, text, text[], text[]);

create function public.search_products_semantic(query_text text, query_embedding extensions.vector, mode text, match_count integer, filter_category text, filter_subcategories text[], filter_materials text[])
returns table(product_id uuid, rank_score real, search_source text)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $function$
declare
  v_limit int;
begin
  -- Validate mode
  if mode not in ('vector','lexical','hybrid') then
    raise exception 'unknown search mode: %', mode;
  end if;

  -- Clamp match_count
  v_limit := least(greatest(match_count, 1), 100);

  -- Enable relaxed HNSW scan for filtered kNN
  perform set_config('hnsw.iterative_scan', 'relaxed_order', true);

  return query
  with eligible as (
    select doc.product_id
    from public.product_embedding_documents doc
    join public.curated_products cp on cp.id = doc.product_id
    where (filter_category is null or cp.category = filter_category)
      and (filter_subcategories is null or cp.subcategory = any(filter_subcategories))
      and (filter_materials is null or cp.material && filter_materials)
  ),
  vector_arm as (
    select
      e.product_id,
      row_number() over (order by pe.embedding <=> query_embedding) as rnk
    from eligible e
    join public.product_embeddings pe on pe.product_id = e.product_id
    where mode in ('vector', 'hybrid')
    order by pe.embedding <=> query_embedding
    limit 100
  ),
  lexical_arm as (
    select
      ls.product_id,
      row_number() over (order by ls.score desc) as rnk
    from public.situation_search_lexical(query_text, 100) ls
    where mode in ('lexical', 'hybrid')
      and ls.product_id in (select product_id from eligible)
  ),
  combined as (
    select
      coalesce(v.product_id, l.product_id) as product_id,
      case
        when mode = 'hybrid' then
          (coalesce(1.0 / (60 + v.rnk), 0) + coalesce(1.0 / (60 + l.rnk), 0))::real
        when mode = 'vector' then
          (1.0 / (60 + v.rnk))::real
        when mode = 'lexical' then
          (1.0 / (60 + l.rnk))::real
      end as rank_score,
      case
        when v.product_id is not null and l.product_id is not null then 'both'
        when v.product_id is not null then 'vector'
        else 'lexical'
      end as search_source
    from vector_arm v
    full outer join lexical_arm l on l.product_id = v.product_id
  )
  select c.product_id, c.rank_score, c.search_source
  from combined c
  order by c.rank_score desc
  limit v_limit;
end;
$function$;

revoke all on function public.search_products_semantic(text, extensions.vector, text, integer, text, text[], text[])
  from public, anon, authenticated;
grant execute on function public.search_products_semantic(text, extensions.vector, text, integer, text, text[], text[])
  to postgres, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.search_products_semantic(text, extensions.vector, text, integer, text, text[], text[])', 'execute') then
    raise exception 'anon retains execute on search_products_semantic';
  end if;
end $$;
