-- Revert DEV-1900 product index while preserving existing product timestamps.

drop trigger if exists brands_retouch_product_search_vector_trigger on public.brands;
drop function if exists public.brands_retouch_product_search_vector();

create function public.curated_products_search_document(
  p_name_zh text, p_name_en text, p_description_zh text,
  p_category text, p_subcategory text
)
returns tsvector language sql stable parallel safe
set search_path = public, pg_temp as $function$
  select
    setweight(to_tsvector('simple', public.cjk_bigrams_bridged(coalesce(p_name_zh, ''))), 'A') ||
    setweight(to_tsvector('english', coalesce(p_name_en, '')), 'A') ||
    setweight(to_tsvector('simple', public.cjk_bigrams(coalesce(
      (select t.name_zh from public.taxonomy_terms t where t.axis = 'l2' and t.slug = p_subcategory),
      ''
    ))), 'C') ||
    setweight(to_tsvector('simple', public.cjk_bigrams(coalesce(
      (select t.name_zh from public.taxonomy_terms t where t.axis = 'l1' and t.slug = p_category),
      ''
    ))), 'C') ||
    setweight(to_tsvector('simple', public.cjk_bigrams(left(coalesce(p_description_zh, ''), 2000))), 'D');
$function$;

create or replace function public.curated_products_search_vector_update()
returns trigger language plpgsql set search_path = public, pg_temp as $function$
begin
  new.search_vector := public.curated_products_search_document(
    new.name_zh, new.name_en, new.product_description_zh,
    new.category, new.subcategory
  );
  return new;
end;
$function$;

drop trigger if exists curated_products_search_vector_trigger on public.curated_products;
create trigger curated_products_search_vector_trigger
  before insert or update of name_zh, name_en, product_description_zh, category, subcategory
  on public.curated_products for each row
  execute function public.curated_products_search_vector_update();

create or replace function public.taxonomy_terms_retouch_product_search_vector()
returns trigger language plpgsql set search_path = public, pg_temp as $function$
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

alter table public.curated_products disable trigger curated_products_updated_at;
update public.curated_products p
set search_vector = public.curated_products_search_document(
  p.name_zh, p.name_en, p.product_description_zh, p.category, p.subcategory
);
alter table public.curated_products enable trigger curated_products_updated_at;

drop function public.curated_products_search_document(text, text, text, text, text, text, text);

drop trigger if exists curated_products_updated_at on public.curated_products;
create trigger curated_products_updated_at before update on public.curated_products
  for each row execute function public.set_updated_at();
drop function public.curated_products_set_updated_at();

revoke all on function public.curated_products_search_document(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.curated_products_search_document(text, text, text, text, text) to postgres, service_role;

do $assert$
begin
  if has_function_privilege('anon', 'public.curated_products_search_document(text, text, text, text, text)', 'execute') then
    raise exception 'anon retains execute on restored product search document';
  end if;
end;
$assert$;
