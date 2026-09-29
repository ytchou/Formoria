-- DEV-1900: field-weighted lexical scoring. Query-time statistics are sized for
-- about 1.4k visible products; materialize document frequency past ~50k rows.

create or replace function public.situation_query_bigrams(input text)
returns text[] language plpgsql immutable parallel safe
set search_path = public, pg_temp as $function$
declare
  v_input text;
  v_terms text[] := '{}';
  v_cjk_runs text[];
  v_run text;
  v_latin_tokens text[];
  v_token text;
  v_stem text;
  v_i int;
begin
  v_input := lower(btrim(coalesce(input, '')));
  if v_input = '' then return '{}'; end if;
  v_cjk_runs := array(select m[1] from regexp_matches(v_input, '([㐀-䶿一-鿿豈-﫿]+)', 'g') as m);
  foreach v_run in array v_cjk_runs loop
    for v_i in 1 .. greatest(char_length(v_run) - 1, 0) loop
      v_terms := v_terms || substr(v_run, v_i, 2);
    end loop;
    if char_length(v_run) = 1 then v_terms := v_terms || v_run; end if;
  end loop;
  v_latin_tokens := array(select m[1] from regexp_matches(v_input, '([a-z0-9]+)', 'g') as m);
  foreach v_token in array v_latin_tokens loop
    for v_stem in select u.lexeme from unnest(to_tsvector('english', v_token)) u loop
      v_terms := v_terms || v_stem;
    end loop;
  end loop;
  v_terms := array(select distinct unnest(v_terms) limit 40);
  return v_terms;
end;
$function$;

-- The old two-argument function is an internal RPC; the semantic RPC is
-- recreated below to call the new signature.
drop function public.search_products_semantic(text, extensions.vector, text, integer, text, text[], text[]);
drop function public.situation_search_lexical(text, integer);

create function public.situation_search_lexical(query text, result_limit int, params jsonb default null)
returns table(product_id uuid, score real)
language plpgsql stable security definer
set search_path = public, extensions, pg_temp as $function$
declare
  v_terms text[];
  v_n bigint;
  v_scorer text := coalesce(params ->> 'scorer', 'bm25f');
  v_wa float8 := coalesce((params ->> 'wA')::float8, 1);
  v_wb float8 := coalesce((params ->> 'wB')::float8, 0.6);
  v_wc float8 := coalesce((params ->> 'wC')::float8, 0.4);
  v_wd float8 := coalesce((params ->> 'wD')::float8, 0.2);
  v_k1 float8 := coalesce((params ->> 'k1')::float8, 1.2);
  v_b float8 := coalesce((params ->> 'b')::float8, 0.75);
begin
  if v_scorer not in ('bm25f', 'tsrank', 'idf') then
    raise exception 'unknown lexical scorer: %', v_scorer;
  end if;
  v_terms := public.situation_query_bigrams(query);
  if array_length(v_terms, 1) is null then return; end if;
  select count(*) into v_n from public.curated_products where visible;

  if v_scorer = 'idf' then
    return query
    with term_df as (
      select word, ndoc from ts_stat($$select search_vector from curated_products where visible$$)
    ), query_terms as (
      select unnest(v_terms) as term
    ), scored as (
      select cp.id as product_id,
        sum(ln((v_n + 1.0) / (coalesce(df.ndoc, 0) + 1.0)))::real as score
      from public.curated_products cp cross join query_terms qt
      left join term_df df on df.word = qt.term
      where cp.visible and cp.search_vector @@ plainto_tsquery('simple', qt.term)
      group by cp.id
    )
    select s.product_id, s.score from scored s order by s.score desc limit result_limit;
    return;
  end if;

  if v_scorer = 'tsrank' then
    return query
    with term_df as (
      select word, ndoc from ts_stat($$select search_vector from curated_products where visible$$)
    ), query_terms as (
      select unnest(v_terms) as term
    ), scored as (
      select cp.id as product_id,
        sum(
          ln((v_n + 1.0) / (coalesce(df.ndoc, 0) + 1.0)) *
          ts_rank(array[v_wd, v_wc, v_wb, v_wa]::real[], cp.search_vector,
            to_tsquery('simple', qt.term))
        )::real as score
      from public.curated_products cp cross join query_terms qt
      left join term_df df on df.word = qt.term
      where cp.visible and cp.search_vector @@ to_tsquery('simple', qt.term)
      group by cp.id
    )
    select s.product_id, s.score from scored s order by s.score desc limit result_limit;
    return;
  end if;

  return query
  with visible_docs as materialized (
    select cp.id, cp.search_vector from public.curated_products cp where cp.visible
  ), doc_lengths as materialized (
    select cp.id,
      coalesce((select sum(cardinality(u.positions)) from unnest(cp.search_vector) u), 0)::float8 as dl
    from visible_docs cp
  ), corpus as (
    select count(*)::float8 as n, greatest(coalesce(avg(dl), 0), 1)::float8 as avgdl
    from doc_lengths
  ), term_df as (
    select word, ndoc from ts_stat($$select search_vector from curated_products where visible$$)
  ), query_terms as (
    select unnest(v_terms) as term
  ), term_tf as (
    select cp.id, qt.term, lengths.dl,
      sum(case weight.value
        when 'A' then v_wa when 'B' then v_wb
        when 'C' then v_wc when 'D' then v_wd else 0 end)::float8 as tf_w
    from visible_docs cp
    join doc_lengths lengths on lengths.id = cp.id
    cross join query_terms qt
    cross join lateral unnest(cp.search_vector) u
    cross join lateral unnest(u.weights) weight(value)
    where cp.search_vector @@ to_tsquery('simple', qt.term)
      and u.lexeme = qt.term
    group by cp.id, qt.term, lengths.dl
  ), scored as (
    select tf.id as product_id,
      sum(
        ln(1 + (corpus.n - coalesce(df.ndoc, 0) + 0.5) /
          (coalesce(df.ndoc, 0) + 0.5)) *
        tf.tf_w * (v_k1 + 1) /
          (tf.tf_w + v_k1 * (1 - v_b + v_b * tf.dl / corpus.avgdl))
      )::real as score
    from term_tf tf
    cross join corpus
    left join term_df df on df.word = tf.term
    group by tf.id
  )
  select s.product_id, s.score from scored s order by s.score desc limit result_limit;
end;
$function$;

create or replace function public.search_products_semantic(query_text text, query_embedding extensions.vector, mode text, match_count integer, filter_category text, filter_subcategories text[], filter_materials text[], lexical_params jsonb default null)
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
    from public.situation_search_lexical(query_text, 100, lexical_params) ls
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
revoke all on function public.situation_search_lexical(text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.search_products_semantic(text, extensions.vector, text, integer, text, text[], text[], jsonb) from public, anon, authenticated;
grant execute on function public.situation_query_bigrams(text) to postgres, service_role;
grant execute on function public.situation_search_lexical(text, integer, jsonb) to postgres, service_role;
grant execute on function public.search_products_semantic(text, extensions.vector, text, integer, text, text[], text[], jsonb) to postgres, service_role;

do $assert$
begin
  if has_function_privilege('anon', 'public.situation_query_bigrams(text)', 'execute')
    or has_function_privilege('anon', 'public.situation_search_lexical(text, integer, jsonb)', 'execute')
    or has_function_privilege('anon', 'public.search_products_semantic(text, extensions.vector, text, integer, text, text[], text[], jsonb)', 'execute') then
    raise exception 'anon retains execute on lexical search functions';
  end if;
end;
$assert$;
