-- DEV-1680 -- tsvector column + trigger on curated_products for lexical search.
--
-- THE DEFECT THIS PREVENTS
-- ---------------------------------------------------------------------------
-- Without a persisted tsvector, lexical search requires a full-table scan with
-- on-the-fly bigram generation per query. The GIN index on search_vector lets
-- the lexical scorer use ts_rank and @@ without recomputing bigrams.
--
-- Pattern mirrors brands_search_document from 20260820110000_search_expands_slugs.sql:
-- a pure function builds the tsvector, a trigger function calls it on relevant
-- column changes, and a backfill populates existing rows with the updated_at
-- trigger disabled.

-- ---------------------------------------------------------------------------
-- Document builder
-- ---------------------------------------------------------------------------

create or replace function public.curated_products_search_document(
  p_name_zh text,
  p_name_en text,
  p_description_zh text,
  p_category text,
  p_subcategory text
)
returns tsvector
language sql
stable
parallel safe
set search_path = public, pg_temp
as $function$
  select
    -- A: product name (CJK bridged bigrams + English)
    setweight(to_tsvector('simple', public.cjk_bigrams_bridged(coalesce(p_name_zh, ''))), 'A') ||
    setweight(to_tsvector('english', coalesce(p_name_en, '')), 'A') ||
    -- C: taxonomy labels resolved from slugs
    setweight(
      to_tsvector('simple', public.cjk_bigrams(coalesce(
        (select t.name_zh from public.taxonomy_terms t where t.axis = 'l2' and t.slug = p_subcategory),
        ''
      ))),
      'C'
    ) ||
    setweight(
      to_tsvector('simple', public.cjk_bigrams(coalesce(
        (select t.name_zh from public.taxonomy_terms t where t.axis = 'l1' and t.slug = p_category),
        ''
      ))),
      'C'
    ) ||
    -- D: description (truncated to 2000 chars for index size)
    setweight(to_tsvector('simple', public.cjk_bigrams(left(coalesce(p_description_zh, ''), 2000))), 'D');
$function$;

-- ---------------------------------------------------------------------------
-- Trigger function
-- ---------------------------------------------------------------------------

create or replace function public.curated_products_search_vector_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  new.search_vector := public.curated_products_search_document(
    new.name_zh, new.name_en, new.product_description_zh,
    new.category, new.subcategory
  );
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Column + index
-- ---------------------------------------------------------------------------

alter table public.curated_products
  add column if not exists search_vector tsvector;

create index idx_curated_products_search_vector
  on public.curated_products using gin (search_vector);

-- ---------------------------------------------------------------------------
-- Trigger — fires on the columns that feed the document
-- ---------------------------------------------------------------------------

create trigger curated_products_search_vector_trigger
  before insert or update of name_zh, name_en, product_description_zh, category, subcategory
  on public.curated_products
  for each row execute function curated_products_search_vector_update();

-- ---------------------------------------------------------------------------
-- Backfill existing rows (disable updated_at trigger to avoid timestamp churn)
-- ---------------------------------------------------------------------------

alter table public.curated_products disable trigger curated_products_updated_at;

update public.curated_products
set search_vector = public.curated_products_search_document(
  name_zh, name_en, product_description_zh, category, subcategory
);

alter table public.curated_products enable trigger curated_products_updated_at;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.curated_products_search_document(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.curated_products_search_document(text, text, text, text, text)
  to postgres, service_role;

revoke all on function public.curated_products_search_vector_update()
  from public, anon, authenticated;
grant execute on function public.curated_products_search_vector_update()
  to postgres, service_role;
