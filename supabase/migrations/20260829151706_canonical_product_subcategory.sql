-- DEV-1648: one canonical L2 per curated product; brands retain an ordered
-- editorial superset of every L2 required by their visible products.

begin;

create or replace function public.dev1648_l2_order()
returns text[]
language sql
immutable
set search_path = pg_catalog, public
as $function$
  select array[
    'tops-and-tshirts', 'dresses', 'skirts', 'pants', 'outerwear', 'underwear-and-intimates', 'loungewear', 'swimwear',
    'performance-apparel', 'activewear', 'socks', 'casual-shoes', 'leather-shoes', 'heels', 'sandals-and-slippers', 'boots',
    'backpacks', 'tote-bags', 'crossbody-bags', 'handbags', 'clutches', 'clasp-frame-bags', 'bucket-bags', 'belt-and-sling-bags',
    'eco-and-shopping-bags', 'wallets', 'coin-purses', 'card-holders', 'storage-pouches', 'cosmetic-bags', 'laptop-bags', 'camera-bags',
    'luggage-and-travel', 'hats', 'scarves-and-shawls', 'eyewear', 'watches', 'keychains', 'charms', 'phone-bags',
    'phone-straps', 'umbrellas', 'gloves', 'earrings', 'necklaces', 'rings', 'bracelets-and-bangles', 'wedding-and-couple-rings',
    'brooches', 'hair-accessories', 'cufflinks-and-tie-clips', 'handmade-soap', 'skincare', 'face-masks', 'body-care', 'bath-and-shower',
    'hair-care', 'makeup', 'sun-care', 'fragrance', 'essential-oils-and-hydrosols', 'oral-care', 'protective-sprays', 'feminine-care',
    'beauty-tools', 'bedding', 'mattresses', 'furniture', 'kids-furniture', 'lighting', 'clocks', 'home-decor',
    'wall-art', 'towels', 'home-textiles', 'rugs-and-mats', 'tableware', 'tea-and-coffee-ware', 'cookware', 'tumblers-and-bottles',
    'reusable-utensils-and-straws', 'storage', 'cleaning', 'home-appliances', 'home-fragrance', 'candles', 'floral-arrangements', 'plants',
    'curtains', 'bath-accessories', 'hand-tools', 'pest-control', 'figurines-and-plush', 'tea', 'tea-bags', 'tea-drinks',
    'coffee', 'chocolate-and-cacao', 'honey', 'jams-and-spreads', 'desserts-and-pastries', 'cookies-and-rice-crackers', 'snacks', 'dried-fruits',
    'rice-and-grains', 'fresh-produce', 'dairy', 'milk-powder', 'alcohol', 'beverages', 'seasonings-and-sauces', 'ready-meals',
    'supplements', 'journals-and-notebooks', 'washi-tape', 'stickers', 'stamps-and-seals', 'cards-and-postcards', 'pens-and-writing', 'calendars',
    'desk-mats', 'paper-goods', 'desk-organization', 'bookmarks', 'craft-kits-and-supplies', 'phone-cases', 'device-sleeves', 'chargers-and-cables',
    'power-banks', 'wireless-charging', 'earphones-and-headphones', 'speakers', 'stands-and-mounts', 'storage-devices', 'security-cameras', 'smart-doorbells',
    'hiking-and-camping-gear', 'picnic-supplies', 'wetsuits-and-water-sports', 'cycling-and-riding', 'helmets', 'outdoor-accessories', 'yoga-gear', 'fitness-equipment',
    'massage-and-recovery', 'protective-gear', 'care-and-mobility-aids', 'kids-clothing', 'family-matching', 'baby-clothing', 'baby-bedding', 'bibs-and-muslin',
    'kids-tableware', 'toys', 'learning-aids', 'play-mats-and-fences', 'parenting-essentials', 'pet-food', 'pet-treats', 'pet-supplements',
    'pet-apparel', 'pet-beds-and-scratchers', 'pet-grooming', 'pet-supplies'
  ]::text[];
$function$;

create or replace function public.dev1648_l2_ordinal(p_slug text)
returns integer
language sql
immutable
set search_path = pg_catalog, public
as $function$
  select array_position(public.dev1648_l2_order(), p_slug);
$function$;

revoke all on function public.dev1648_l2_order() from public, anon, authenticated;
revoke all on function public.dev1648_l2_ordinal(text) from public, anon, authenticated;
grant execute on function public.dev1648_l2_order() to postgres, service_role;
grant execute on function public.dev1648_l2_ordinal(text) to postgres, service_role;

create temporary table dev1648_l2_map on commit drop as
select
  slug,
  ordinal::integer,
  case
    when ordinal between 1 and 16 then 'fashion'
    when ordinal between 17 and 43 then 'bags-accessories'
    when ordinal between 44 and 51 then 'jewelry'
    when ordinal between 52 and 65 then 'beauty'
    when ordinal between 66 and 93 then 'home'
    when ordinal between 94 and 113 then 'food-drink'
    when ordinal between 114 and 125 then 'stationery'
    when ordinal between 126 and 136 then 'tech'
    when ordinal between 137 and 142 then 'outdoor'
    when ordinal between 143 and 147 then 'fitness'
    when ordinal between 148 and 157 then 'kids'
    when ordinal between 158 and 164 then 'pets'
  end as category
from unnest(public.dev1648_l2_order()) with ordinality as ordered(slug, ordinal);

create temporary table dev1648_product_before on commit drop as
select id, category, subcategories, visible
from public.curated_products;

create temporary table dev1648_brand_before on commit drop as
select id, coalesce(subcategories, '{}'::text[]) as subcategories
from public.brands;

create temporary table dev1648_submission_before on commit drop as
select id, enriched_data, review_overrides
from public.brand_submissions;

alter table public.curated_products add column subcategory text;

update public.curated_products as product
set
  subcategory = map.slug
from dev1648_l2_map as map
where cardinality(product.subcategories) = 1
  and map.slug = product.subcategories[1]
  and map.category = product.category;

-- The compatible update above omits invalid arrays, so fail them closed too.
update public.curated_products
set subcategory = null, visible = false
where cardinality(subcategories) <> 1
   or not exists (
     select 1
     from dev1648_l2_map as map
     where map.slug = subcategories[1]
       and map.category = curated_products.category
   );

-- Convert only nested proposal contracts. Historical raw model responses are
-- deliberately untouched so the audit record remains byte-faithful.
update public.brand_submissions as submission
set enriched_data = jsonb_set(
  submission.enriched_data,
  '{products}',
  coalesce((
    select jsonb_agg(
      (product - 'subcategories') ||
      jsonb_build_object('subcategory', compatible.slug)
      order by ordinal
    )
    from jsonb_array_elements(submission.enriched_data -> 'products')
      with ordinality as products(product, ordinal)
    left join lateral (
      select map.slug
      from dev1648_l2_map as map
      where jsonb_typeof(product -> 'subcategories') = 'array'
        and jsonb_array_length(product -> 'subcategories') = 1
        and map.slug = product -> 'subcategories' ->> 0
        and map.category = product ->> 'category'
    ) as compatible on true
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
      (product - 'subcategories') ||
      jsonb_build_object('subcategory', compatible.slug)
      order by ordinal
    )
    from jsonb_array_elements(submission.review_overrides -> 'products')
      with ordinality as products(product, ordinal)
    left join lateral (
      select map.slug
      from dev1648_l2_map as map
      where jsonb_typeof(product -> 'subcategories') = 'array'
        and jsonb_array_length(product -> 'subcategories') = 1
        and map.slug = product -> 'subcategories' ->> 0
        and map.category = product ->> 'category'
    ) as compatible on true
  ), '[]'::jsonb),
  false
)
where jsonb_typeof(submission.review_overrides -> 'products') = 'array';

-- Preserve stored/manual order and extras. Only missing visible-product L2s
-- are appended, in ontology order.
with required as (
  select
    product.brand_id,
    array_agg(product.subcategory order by map.ordinal) as missing
  from (
    select distinct brand_id, subcategory
    from public.curated_products
    where visible and subcategory is not null
  ) as product
  join public.brands as brand on brand.id = product.brand_id
  join dev1648_l2_map as map on map.slug = product.subcategory
  where not (product.subcategory = any(coalesce(brand.subcategories, '{}'::text[])))
  group by product.brand_id
)
update public.brands as brand
set subcategories = coalesce(brand.subcategories, '{}'::text[]) || required.missing
from required
where required.brand_id = brand.id;

create or replace function public.dev1648_aligned_subcategory_labels(
  p_slugs text[],
  p_existing_labels text[]
)
returns text[]
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select coalesce(
    array_agg(
      coalesce(term.name_en, p_existing_labels[item.ordinal], item.slug)
      order by item.ordinal
    ),
    '{}'::text[]
  )
  from unnest(coalesce(p_slugs, '{}'::text[]))
    with ordinality as item(slug, ordinal)
  left join public.taxonomy_terms as term
    on term.axis = 'l2' and term.slug = item.slug;
$function$;

revoke all on function public.dev1648_aligned_subcategory_labels(text[], text[])
  from public, anon, authenticated;
grant execute on function public.dev1648_aligned_subcategory_labels(text[], text[])
  to postgres, service_role;

update public.brands
set subcategories_en = public.dev1648_aligned_subcategory_labels(
  subcategories,
  subcategories_en
);

create or replace function public.dev1648_validate_product_subcategory()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if new.visible and (
    new.subcategory is null
    or not exists (
      select 1
      from public.taxonomy_terms as term
      where term.axis = 'l2' and term.slug = new.subcategory
    )
  ) then
    raise exception 'visible curated product requires a known subcategory'
      using errcode = '23514', constraint = 'curated_products_visible_subcategory_check';
  end if;
  return new;
end
$function$;

create or replace function public.dev1648_preserve_brand_product_subcategories()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_missing text[];
begin
  select array_agg(required.subcategory order by required.ordinal)
  into v_missing
  from (
    select
      product.subcategory,
      min(coalesce(public.dev1648_l2_ordinal(product.subcategory), 2147483647)) as ordinal
    from public.curated_products as product
    where product.brand_id = new.id
      and product.visible
      and product.subcategory is not null
      and not (product.subcategory = any(coalesce(new.subcategories, '{}'::text[])))
    group by product.subcategory
  ) as required;

  new.subcategories := coalesce(new.subcategories, '{}'::text[])
    || coalesce(v_missing, '{}'::text[]);
  new.subcategories_en := public.dev1648_aligned_subcategory_labels(
    new.subcategories,
    new.subcategories_en
  );
  return new;
end
$function$;

create or replace function public.dev1648_append_product_subcategory_to_brand()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if new.visible and new.subcategory is not null then
    update public.brands
    set subcategories = array_append(
      coalesce(subcategories, '{}'::text[]),
      new.subcategory
    )
    where id = new.brand_id
      and not (new.subcategory = any(coalesce(subcategories, '{}'::text[])));
  end if;
  return new;
end
$function$;

revoke all on function public.dev1648_validate_product_subcategory()
  from public, anon, authenticated;
revoke all on function public.dev1648_preserve_brand_product_subcategories()
  from public, anon, authenticated;
revoke all on function public.dev1648_append_product_subcategory_to_brand()
  from public, anon, authenticated;
grant execute on function public.dev1648_validate_product_subcategory()
  to postgres, service_role;
grant execute on function public.dev1648_preserve_brand_product_subcategories()
  to postgres, service_role;
grant execute on function public.dev1648_append_product_subcategory_to_brand()
  to postgres, service_role;

create trigger curated_products_validate_subcategory
before insert or update of visible, subcategory on public.curated_products
for each row execute function public.dev1648_validate_product_subcategory();

create trigger brands_preserve_product_subcategories
before update of subcategories, subcategories_en on public.brands
for each row execute function public.dev1648_preserve_brand_product_subcategories();

create trigger curated_products_append_brand_subcategory_insert
after insert on public.curated_products
for each row execute function public.dev1648_append_product_subcategory_to_brand();

create trigger curated_products_append_brand_subcategory_update
after update of brand_id, visible, subcategory on public.curated_products
for each row execute function public.dev1648_append_product_subcategory_to_brand();

alter table public.curated_products drop column subcategories;

-- Remove only the upper bound from both live publishability guards. The lower
-- bound remains: a brand still needs at least one L2 to be approved/refreshed.
do $migration$
declare
  v_signature regprocedure;
  v_definition text;
begin
  foreach v_signature in array array[
    'public.approve_submission(uuid,uuid,jsonb)'::regprocedure,
    'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure
  ] loop
    v_definition := pg_get_functiondef(v_signature);
    if regexp_count(v_definition, 'not between 1 and 5') <> 1 then
      raise exception 'DEV-1648 expected one five-L2 guard in %', v_signature;
    end if;
    execute replace(v_definition, 'not between 1 and 5', '< 1');
  end loop;
end
$migration$;

do $assertions$
declare
  v_product_id uuid;
  v_brand_id uuid;
  v_next_subcategory text;
begin
  if exists (
    select 1
    from dev1648_product_before as before
    join public.curated_products as product on product.id = before.id
    left join dev1648_l2_map as map
      on cardinality(before.subcategories) = 1
      and map.slug = before.subcategories[1]
      and map.category = before.category
    where product.subcategory is distinct from map.slug
       or product.visible is distinct from
          case when map.slug is null then false else before.visible end
  ) then
    raise exception 'DEV-1648 singleton/fail-closed product conversion failed';
  end if;

  if exists (
    select 1
    from dev1648_submission_before as before
    join public.brand_submissions as submission on submission.id = before.id
    cross join lateral jsonb_array_elements(before.enriched_data -> 'products')
      with ordinality as old_product(product, ordinal)
    join lateral jsonb_array_elements(submission.enriched_data -> 'products')
      with ordinality as new_product(product, ordinal)
      on new_product.ordinal = old_product.ordinal
    left join dev1648_l2_map as map
      on jsonb_typeof(old_product.product -> 'subcategories') = 'array'
      and jsonb_array_length(old_product.product -> 'subcategories') = 1
      and map.slug = old_product.product -> 'subcategories' ->> 0
      and map.category = old_product.product ->> 'category'
    where jsonb_typeof(before.enriched_data -> 'products') = 'array'
      and (
        new_product.product ? 'subcategories'
        or not (new_product.product ? 'subcategory')
        or new_product.product ->> 'subcategory' is distinct from map.slug
      )
  ) then
    raise exception 'DEV-1648 enriched proposal conversion failed';
  end if;

  if exists (
    select 1
    from dev1648_submission_before as before
    join public.brand_submissions as submission on submission.id = before.id
    cross join lateral jsonb_array_elements(before.review_overrides -> 'products')
      with ordinality as old_product(product, ordinal)
    join lateral jsonb_array_elements(submission.review_overrides -> 'products')
      with ordinality as new_product(product, ordinal)
      on new_product.ordinal = old_product.ordinal
    left join dev1648_l2_map as map
      on jsonb_typeof(old_product.product -> 'subcategories') = 'array'
      and jsonb_array_length(old_product.product -> 'subcategories') = 1
      and map.slug = old_product.product -> 'subcategories' ->> 0
      and map.category = old_product.product ->> 'category'
    where jsonb_typeof(before.review_overrides -> 'products') = 'array'
      and (
        new_product.product ? 'subcategories'
        or not (new_product.product ? 'subcategory')
        or new_product.product ->> 'subcategory' is distinct from map.slug
      )
  ) then
    raise exception 'DEV-1648 review override proposal conversion failed';
  end if;

  if exists (
    select 1
    from dev1648_brand_before as before
    join public.brands as brand on brand.id = before.id
    where brand.subcategories[1:cardinality(before.subcategories)]
      is distinct from before.subcategories
  ) then
    raise exception 'DEV-1648 brand order or editorial extras were not retained';
  end if;

  if exists (
    select 1
    from public.curated_products as product
    where product.visible and (
      product.subcategory is null
      or not exists (
        select 1 from public.taxonomy_terms as term
        where term.axis = 'l2' and term.slug = product.subcategory
      )
    )
  ) then
    raise exception 'DEV-1648 visible product invariant failed';
  end if;

  if exists (
    select 1
    from public.curated_products as product
    join public.brands as brand on brand.id = product.brand_id
    where product.visible
      and not (product.subcategory = any(brand.subcategories))
  ) then
    raise exception 'DEV-1648 brand union backfill failed';
  end if;

  if exists (
    select 1 from public.brands
    where cardinality(subcategories) <> cardinality(subcategories_en)
  ) then
    raise exception 'DEV-1648 aligned English label backfill failed';
  end if;

  if pg_get_functiondef(
       'public.approve_submission(uuid,uuid,jsonb)'::regprocedure
     ) like '%not between 1 and 5%'
     or pg_get_functiondef(
       'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure
     ) like '%not between 1 and 5%'
  then
    raise exception 'DEV-1648 live five-L2 guards remain';
  end if;

  -- Exercise the product trigger without retaining the test mutation. A PL/pgSQL
  -- exception block is a subtransaction, so the sentinel rolls back both the
  -- product move and the brand append after the assertion succeeds.
  select product.id, product.brand_id, candidate.slug
  into v_product_id, v_brand_id, v_next_subcategory
  from public.curated_products as product
  join public.brands as brand on brand.id = product.brand_id
  join dev1648_l2_map as current_map on current_map.slug = product.subcategory
  join lateral (
    select map.slug
    from dev1648_l2_map as map
    where map.category = current_map.category
      and map.slug <> product.subcategory
      and not (map.slug = any(coalesce(brand.subcategories, '{}'::text[])))
    order by map.ordinal
    limit 1
  ) as candidate on true
  where product.visible
  limit 1;

  if v_product_id is not null then
    begin
      update public.curated_products
      set subcategory = v_next_subcategory
      where id = v_product_id;
      if not exists (
        select 1
        from public.brands
        where id = v_brand_id
          and v_next_subcategory = any(subcategories)
      ) then
        raise exception 'DEV-1648 product trigger did not append brand L2';
      end if;
      raise exception using
        errcode = 'ZX001',
        message = 'rollback DEV-1648 trigger assertion';
    exception when sqlstate 'ZX001' then
      null;
    end;
  end if;
end
$assertions$;

commit;
