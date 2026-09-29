-- DEV-1900: index brand names and stem Latin text in product search documents.

create or replace function public.curated_products_set_updated_at()
returns trigger language plpgsql set search_path = public, pg_temp as $function$
begin
  if (to_jsonb(new) - 'search_vector' - 'updated_at')
     is not distinct from (to_jsonb(old) - 'search_vector' - 'updated_at') then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$function$;

drop trigger if exists curated_products_updated_at on public.curated_products;
create trigger curated_products_updated_at before update on public.curated_products
  for each row execute function public.curated_products_set_updated_at();

create function public.curated_products_search_document(
  p_name_zh text, p_name_en text, p_description_zh text,
  p_category text, p_subcategory text, p_brand_name text, p_brand_romanized text
)
returns tsvector language sql stable parallel safe
set search_path = public, pg_temp as $function$
  select
    setweight(to_tsvector('simple', public.cjk_bigrams_bridged(coalesce(p_name_zh, ''))), 'A') ||
    setweight(to_tsvector('english', coalesce(p_name_en, '')), 'A') ||
    setweight(to_tsvector('simple', public.cjk_bigrams_bridged(coalesce(p_brand_name, ''))), 'B') ||
    setweight(to_tsvector('english',
      regexp_replace(coalesce(p_brand_name, ''), '[^A-Za-z0-9]+', ' ', 'g') || ' ' ||
      coalesce(p_brand_romanized, '')), 'B') ||
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
declare
  v_brand_name text;
  v_brand_romanized text;
begin
  select b.name, b.romanized_name into v_brand_name, v_brand_romanized
  from public.brands b where b.id = new.brand_id;
  new.search_vector := public.curated_products_search_document(
    new.name_zh, new.name_en, new.product_description_zh,
    new.category, new.subcategory, v_brand_name, v_brand_romanized
  );
  return new;
end;
$function$;

drop trigger if exists curated_products_search_vector_trigger on public.curated_products;
create trigger curated_products_search_vector_trigger
  before insert or update of name_zh, name_en, product_description_zh, category, subcategory, brand_id
  on public.curated_products for each row
  execute function public.curated_products_search_vector_update();

create or replace function public.taxonomy_terms_retouch_product_search_vector()
returns trigger language plpgsql set search_path = public, pg_temp as $function$
begin
  update public.curated_products p
  set search_vector = public.curated_products_search_document(
    p.name_zh, p.name_en, p.product_description_zh, p.category, p.subcategory,
    b.name, b.romanized_name
  )
  from public.brands b
  where b.id = p.brand_id
    and ((new.axis = 'l1' and p.category = new.slug)
      or (new.axis = 'l2' and p.subcategory = new.slug));
  return null;
end;
$function$;

create function public.brands_retouch_product_search_vector()
returns trigger language plpgsql set search_path = public, pg_temp as $function$
begin
  update public.curated_products p
  set search_vector = public.curated_products_search_document(
    p.name_zh, p.name_en, p.product_description_zh, p.category, p.subcategory,
    new.name, new.romanized_name
  )
  where p.brand_id = new.id;
  return null;
end;
$function$;

create trigger brands_retouch_product_search_vector_trigger
  after update of name, romanized_name on public.brands
  for each row when (
    old.name is distinct from new.name or old.romanized_name is distinct from new.romanized_name
  ) execute function public.brands_retouch_product_search_vector();

update public.curated_products p
set search_vector = public.curated_products_search_document(
  p.name_zh, p.name_en, p.product_description_zh, p.category, p.subcategory,
  b.name, b.romanized_name
)
from public.brands b where b.id = p.brand_id;

drop function public.curated_products_search_document(text, text, text, text, text);

revoke all on function public.curated_products_set_updated_at() from public, anon, authenticated;
revoke all on function public.curated_products_search_document(text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.curated_products_search_vector_update() from public, anon, authenticated;
revoke all on function public.taxonomy_terms_retouch_product_search_vector() from public, anon, authenticated;
revoke all on function public.brands_retouch_product_search_vector() from public, anon, authenticated;
grant execute on function public.curated_products_set_updated_at() to postgres, service_role;
grant execute on function public.curated_products_search_document(text, text, text, text, text, text, text) to postgres, service_role;
grant execute on function public.curated_products_search_vector_update() to postgres, service_role;
grant execute on function public.taxonomy_terms_retouch_product_search_vector() to postgres, service_role;
grant execute on function public.brands_retouch_product_search_vector() to postgres, service_role;

do $assert$
begin
  if has_function_privilege('anon', 'public.curated_products_set_updated_at()', 'execute')
    or has_function_privilege('anon', 'public.curated_products_search_document(text, text, text, text, text, text, text)', 'execute')
    or has_function_privilege('anon', 'public.curated_products_search_vector_update()', 'execute')
    or has_function_privilege('anon', 'public.taxonomy_terms_retouch_product_search_vector()', 'execute')
    or has_function_privilege('anon', 'public.brands_retouch_product_search_vector()', 'execute') then
    raise exception 'anon retains execute on product search functions';
  end if;
end;
$assert$;
