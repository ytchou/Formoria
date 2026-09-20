-- Fix product_id ambiguity in the lexical_arm CTE subquery introduced by
-- 20260916120000. The unqualified `product_id` in `select product_id from eligible`
-- conflicts with the RETURNS TABLE output variable of the same name (PG 42702).

create or replace function public.search_products_semantic(query_text text, query_embedding extensions.vector, mode text, match_count integer, filter_category text, filter_subcategories text[], filter_materials text[])
returns table(product_id uuid, rank_score real, search_source text, vector_rank integer, lexical_rank integer, cosine_sim real, lexical_score real)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $function$
declare
  v_limit int;
begin
  if mode not in ('vector','lexical','hybrid') then
    raise exception 'unknown search mode: %', mode;
  end if;

  v_limit := least(greatest(match_count, 1), 100);

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
      row_number() over (order by pe.embedding <=> query_embedding) as rnk,
      (1 - (pe.embedding <=> query_embedding))::real as cosine_sim
    from eligible e
    join public.product_embeddings pe on pe.product_id = e.product_id
    where mode in ('vector', 'hybrid')
    order by pe.embedding <=> query_embedding
    limit 100
  ),
  lexical_arm as (
    select
      ls.product_id,
      row_number() over (order by ls.score desc) as rnk,
      ls.score::real as lexical_score
    from public.situation_search_lexical(query_text, 100) ls
    where mode in ('lexical', 'hybrid')
      and ls.product_id in (select eligible.product_id from eligible)
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
      end as search_source,
      v.rnk::integer as vector_rank,
      l.rnk::integer as lexical_rank,
      v.cosine_sim,
      l.lexical_score
    from vector_arm v
    full outer join lexical_arm l on l.product_id = v.product_id
  )
  select c.product_id, c.rank_score, c.search_source, c.vector_rank, c.lexical_rank, c.cosine_sim, c.lexical_score
  from combined c
  order by c.rank_score desc
  limit v_limit;
end;
$function$;
