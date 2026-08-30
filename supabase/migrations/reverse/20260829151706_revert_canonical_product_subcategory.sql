-- Reverse DEV-1648 during the approved write freeze. Ambiguous legacy arrays
-- were intentionally collapsed to NULL by the forward migration and cannot be
-- reconstructed; capture the targeted product snapshot before rollout.

begin;

drop trigger if exists curated_products_append_brand_subcategory_update
  on public.curated_products;
drop trigger if exists curated_products_append_brand_subcategory_insert
  on public.curated_products;
drop trigger if exists curated_products_validate_subcategory
  on public.curated_products;
drop trigger if exists brands_preserve_product_subcategories on public.brands;

alter table public.curated_products
  add column subcategories text[] not null default '{}'::text[];

update public.curated_products
set subcategories = case
  when subcategory is null then '{}'::text[]
  else array[subcategory]
end;

update public.brand_submissions as submission
set enriched_data = jsonb_set(
  submission.enriched_data,
  '{products}',
  coalesce((
    select jsonb_agg(
      (product - 'subcategory') || jsonb_build_object(
        'subcategories',
        case
          when jsonb_typeof(product -> 'subcategory') = 'string'
            then jsonb_build_array(product ->> 'subcategory')
          else '[]'::jsonb
        end
      )
      order by ordinal
    )
    from jsonb_array_elements(submission.enriched_data -> 'products')
      with ordinality as products(product, ordinal)
  ), '[]'::jsonb),
  false
)
where jsonb_typeof(submission.enriched_data -> 'products') = 'array';

update public.brand_submissions as submission
set review_overrides = jsonb_set(
  submission.review_overrides,
  '{products}',
  coalesce((
    select jsonb_agg(
      (product - 'subcategory') || jsonb_build_object(
        'subcategories',
        case
          when jsonb_typeof(product -> 'subcategory') = 'string'
            then jsonb_build_array(product ->> 'subcategory')
          else '[]'::jsonb
        end
      )
      order by ordinal
    )
    from jsonb_array_elements(submission.review_overrides -> 'products')
      with ordinality as products(product, ordinal)
  ), '[]'::jsonb),
  false
)
where jsonb_typeof(submission.review_overrides -> 'products') = 'array';

do $rollback$
declare
  v_signature regprocedure;
  v_definition text;
  v_before text;
begin
  v_signature := 'public.approve_submission(uuid,uuid,jsonb)'::regprocedure;
  v_definition := pg_get_functiondef(v_signature);
  if position('coalesce(cardinality(v_product_tags), 0) < 1' in v_definition) > 0 then
    v_before := 'coalesce(cardinality(v_product_tags), 0) < 1';
  elsif position('coalesce(cardinality(v_subcategories), 0) < 1' in v_definition) > 0 then
    v_before := 'coalesce(cardinality(v_subcategories), 0) < 1';
  else
    raise exception 'DEV-1648 reverse could not find approve_submission lower-bound guard';
  end if;
  execute replace(v_definition, v_before, replace(v_before, '< 1', 'not between 1 and 5'));

  v_signature := 'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure;
  v_definition := pg_get_functiondef(v_signature);
  v_before := 'jsonb_array_length(v_effective -> ''subcategories'') < 1';
  if position(v_before in v_definition) = 0 then
    raise exception 'DEV-1648 reverse could not find refresh lower-bound guard';
  end if;
  execute replace(v_definition, v_before, replace(v_before, '< 1', 'not between 1 and 5'));
end
$rollback$;

alter table public.curated_products drop column subcategory;

drop function public.dev1648_append_product_subcategory_to_brand();
drop function if exists public.dev1648_release_brand_product_subcategory(uuid, text);
drop table if exists public.brand_product_subcategory_additions;
drop function public.dev1648_preserve_brand_product_subcategories();
drop function public.dev1648_validate_product_subcategory();
drop function public.dev1648_aligned_subcategory_labels(text[], text[]);
drop function public.dev1648_l2_ordinal(text);
drop function public.dev1648_l2_order();

commit;
