-- Restore the pre-freeze scorer and query shape.
create or replace function public.situation_search_lexical(query text, result_limit int, params jsonb default null)
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

revoke all on function public.situation_search_lexical(text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.situation_search_lexical(text, integer, jsonb) to postgres, service_role;

do $assert$
begin
  if has_function_privilege('anon', 'public.situation_search_lexical(text, integer, jsonb)', 'execute') then
    raise exception 'anon retains execute on lexical scorer';
  end if;
end;
$assert$;
