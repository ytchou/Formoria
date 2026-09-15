-- DEV-1732 -- widen the situation-search candidate pool from 48 to 100.
--
-- Rationale: candidate recall for the downstream ranker. Research shows
-- recall@5 = 0.83 at pool 50 vs 0.89 at pool 100; the extra rows are cheap
-- (already fetched by the kNN scan) and the ranker re-scores them anyway.
--
-- Also adds a trigger that retouches curated_products.search_vector when a
-- taxonomy term's name_zh is renamed, so lexical search stays current.
--
-- APPLYING THIS ON PRODUCTION: by hand after promotion; depends on
-- 20260903100200.

-- ===========================================================================
-- (1) search_products_semantic — widen pool from 48 → 100
-- ===========================================================================

create or replace function public.search_products_semantic(query_text text, query_embedding extensions.vector, mode text, match_count integer, filter_category text, filter_subcategories text[], filter_materials text[])
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

comment on function public.search_products_semantic is
  'Hybrid vector + lexical product search for situation-based discovery. '
  'Modes: vector (kNN only), lexical (IDF bigram only), hybrid (RRF fusion). '
  'All modes filter through product_embedding_documents eligibility view.';

-- ===========================================================================
-- (2) taxonomy_terms_retouch_product_search_vector — trigger function
-- ===========================================================================

create or replace function public.taxonomy_terms_retouch_product_search_vector()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  update public.curated_products p
  set search_vector = public.curated_products_search_document(
    p.name_zh, p.name_en, p.product_description_zh, p.category, p.subcategory
  )
  where (new.axis = 'l1' and p.category = new.slug)
     or (new.axis = 'l2' and p.subcategory = new.slug);

  return null;
end;
$function$;

create trigger taxonomy_terms_retouch_product_search_vector_trigger
  after update of name_zh on public.taxonomy_terms
  for each row
  when (old.name_zh is distinct from new.name_zh)
  execute function public.taxonomy_terms_retouch_product_search_vector();

revoke all on function public.taxonomy_terms_retouch_product_search_vector()
  from public, anon, authenticated;
grant execute on function public.taxonomy_terms_retouch_product_search_vector()
  to postgres, service_role;
