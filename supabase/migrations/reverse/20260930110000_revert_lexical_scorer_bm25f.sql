-- Revert DEV-1900 scorer, restoring the IDF scorer and original RPC signatures.
drop function if exists public.search_products_semantic(text, extensions.vector, text, integer, text, text[], text[], jsonb);
drop function if exists public.situation_search_lexical(text, integer, jsonb);

create or replace function public.situation_query_bigrams(input text)
returns text[]
language plpgsql
immutable
parallel safe
set search_path = public, pg_temp
as $function$
declare
  v_input text;
  v_terms text[] := '{}';
  v_cjk_runs text[];
  v_run text;
  v_latin_tokens text[];
  v_token text;
  v_i int;
begin
  v_input := lower(btrim(coalesce(input, '')));
  if v_input = '' then return '{}'; end if;

  -- Extract CJK runs (CJK Unified Ideographs + Extension A)
  v_cjk_runs := array(
    select m[1] from regexp_matches(v_input, '([㐀-䶿一-鿿豈-﫿]+)', 'g') as m
  );

  -- Adjacent 2-char windows from each CJK run
  foreach v_run in array v_cjk_runs loop
    for v_i in 1 .. greatest(char_length(v_run) - 1, 0) loop
      v_terms := v_terms || substr(v_run, v_i, 2);
    end loop;
    -- Single-char CJK terms pass through
    if char_length(v_run) = 1 then
      v_terms := v_terms || v_run;
    end if;
  end loop;

  -- Lowercase Latin/digit tokens
  v_latin_tokens := array(
    select m[1] from regexp_matches(v_input, '([a-z0-9]+)', 'g') as m
  );
  foreach v_token in array v_latin_tokens loop
    v_terms := v_terms || v_token;
  end loop;

  -- Dedupe and cap at 40 terms
  v_terms := array(
    select distinct unnest(v_terms) limit 40
  );

  return v_terms;
end;
$function$;

create or replace function public.situation_search_lexical(
  query text,
  result_limit int
)
returns table(product_id uuid, score real)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $function$
declare
  v_terms text[];
  v_n bigint;
begin
  v_terms := public.situation_query_bigrams(query);
  if array_length(v_terms, 1) is null then
    return;
  end if;

  -- Total document count for IDF
  select count(*) into v_n
  from public.curated_products
  where visible;

  return query
  with term_df as (
    select word, ndoc
    from ts_stat($$select search_vector from curated_products where visible$$)
  ),
  query_terms as (
    select unnest(v_terms) as term
  ),
  scored as (
    select
      cp.id as product_id,
      sum(ln((v_n + 1.0) / (coalesce(df.ndoc, 0) + 1.0)))::real as score
    from public.curated_products cp
    cross join query_terms qt
    left join term_df df on df.word = qt.term
    where cp.visible
      and cp.search_vector @@ plainto_tsquery('simple', qt.term)
    group by cp.id
  )
  select s.product_id, s.score
  from scored s
  order by s.score desc
  limit result_limit;
end;
$function$;

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

revoke all on function public.situation_query_bigrams(text) from public, anon, authenticated;
revoke all on function public.situation_search_lexical(text, integer) from public, anon, authenticated;
revoke all on function public.search_products_semantic(text, extensions.vector, text, integer, text, text[], text[]) from public, anon, authenticated;
grant execute on function public.situation_query_bigrams(text) to postgres, service_role;
grant execute on function public.situation_search_lexical(text, integer) to postgres, service_role;
grant execute on function public.search_products_semantic(text, extensions.vector, text, integer, text, text[], text[]) to postgres, service_role;

do $assert$
begin
  if has_function_privilege('anon', 'public.situation_query_bigrams(text)', 'execute')
    or has_function_privilege('anon', 'public.situation_search_lexical(text, integer)', 'execute')
    or has_function_privilege('anon', 'public.search_products_semantic(text, extensions.vector, text, integer, text, text[], text[])', 'execute') then
    raise exception 'anon retains execute on restored lexical search functions';
  end if;
end;
$assert$;
