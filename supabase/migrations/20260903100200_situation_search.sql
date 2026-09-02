-- DEV-1680 -- document view, lexical scorer, and semantic search RPC.
--
-- THE DEFECT THIS PREVENTS
-- ---------------------------------------------------------------------------
-- Without a gated view, embedding and search pipelines must each duplicate the
-- eligibility filters (approved brand, not demo, visible product, has source,
-- has official URL). A single view is the canonical eligibility contract: the
-- embedding job reads it to decide what to embed, and the RPC reads it to
-- restrict candidates.
--
-- APPLYING THIS ON PRODUCTION: Railway runs no migrations against production,
-- so this file is applied BY HAND after the staging -> main promotion. It
-- depends on 20260903100000 (pgvector) and 20260903100100 (search_vector).

-- ===========================================================================
-- (1) View: product_embedding_documents
-- ===========================================================================

create or replace view public.product_embedding_documents as
select
  p.id as product_id,
  p.brand_id,
  concat_ws(
    chr(10),
    b.name,
    b.blurb,
    l1.name_zh,
    l2.name_zh,
    p.name_zh,
    p.product_description_zh
  ) as document,
  encode(extensions.digest(
    concat_ws(
      chr(10),
      b.name,
      b.blurb,
      l1.name_zh,
      l2.name_zh,
      p.name_zh,
      p.product_description_zh
    ),
    'sha256'
  ), 'hex') as source_hash
from public.curated_products p
join public.brands b on b.id = p.brand_id
left join public.taxonomy_terms l1
  on l1.axis = 'l1' and l1.slug = p.category
left join public.taxonomy_terms l2
  on l2.axis = 'l2' and l2.slug = p.subcategory
where b.status = 'approved'
  and not b.is_demo
  and p.visible
  and p.official_url is not null
  and p.source_checked_at is not null
  and exists (select 1 from curated_product_sources s where s.product_id = p.id);

revoke all on public.product_embedding_documents from PUBLIC, anon, authenticated;
grant select on public.product_embedding_documents to service_role;

comment on view public.product_embedding_documents is
  'Canonical eligibility view for product embeddings. Gates: approved brand, '
  'not demo, visible product, has official URL, has source check, has at least '
  'one provenance row. The document is the concatenation fed to the embedding '
  'model; source_hash drives selective re-embedding.';

-- ===========================================================================
-- (2) situation_query_bigrams — tokenizer for the lexical scorer
-- ===========================================================================

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

revoke all on function public.situation_query_bigrams(text)
  from public, anon, authenticated;
grant execute on function public.situation_query_bigrams(text)
  to postgres, service_role;

-- ===========================================================================
-- (3) situation_search_lexical — IDF-weighted bigram scorer
-- ===========================================================================
--
-- Ceiling: ts_stat materializes the full search_vector column. Past ~50k rows,
-- switch to a pre-computed document-frequency table refreshed by cron.

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

revoke all on function public.situation_search_lexical(text, int)
  from public, anon, authenticated;
grant execute on function public.situation_search_lexical(text, int)
  to postgres, service_role;

-- ===========================================================================
-- (4) search_products_semantic — hybrid vector + lexical RPC
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
  v_limit := least(greatest(match_count, 1), 48);

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
    limit 50
  ),
  lexical_arm as (
    select
      ls.product_id,
      row_number() over (order by ls.score desc) as rnk
    from public.situation_search_lexical(query_text, 50) ls
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
