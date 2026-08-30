-- A product correction must retract only the brand L2 that product sync added.
-- Brand-level editorial L2s remain independent of curated product coverage.

begin;

create table public.brand_product_subcategory_additions (
  brand_id uuid not null references public.brands(id) on delete cascade,
  subcategory text not null,
  created_at timestamptz not null default now(),
  primary key (brand_id, subcategory)
);

comment on table public.brand_product_subcategory_additions is
  'Brand L2 values appended by curated-product sync, eligible for release when the last visible contributing product disappears.';

alter table public.brand_product_subcategory_additions enable row level security;
revoke all on table public.brand_product_subcategory_additions
  from public, anon, authenticated;
grant select on table public.brand_product_subcategory_additions
  to service_role;

create or replace function public.dev1648_release_brand_product_subcategory(
  p_brand_id uuid,
  p_subcategory text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_added_at timestamptz;
  v_latest_editorial_value jsonb;
begin
  -- Serialize two concurrent last-product removals for the same brand. Without
  -- this lock each transaction can still see the other's product as visible.
  perform 1 from public.brands where id = p_brand_id for update;
  if not found then return; end if;

  if exists (
    select 1
    from public.curated_products as product
    where product.brand_id = p_brand_id
      and product.visible
      and product.subcategory = p_subcategory
  ) then
    return;
  end if;

  delete from public.brand_product_subcategory_additions
  where brand_id = p_brand_id and subcategory = p_subcategory
  returning created_at into v_added_at;
  if not found then return; end if;

  -- A later brand-level write can deliberately adopt the same L2. In that
  -- case release product ownership without deleting the editorial value.
  select event.new_value
  into v_latest_editorial_value
  from public.brand_field_events as event
  where event.brand_id = p_brand_id
    and event.field = 'subcategories'
    and event.created_at >= v_added_at
  order by event.created_at desc, event.id desc
  limit 1;

  if jsonb_typeof(v_latest_editorial_value) = 'array'
     and v_latest_editorial_value ? p_subcategory then
    return;
  end if;

  update public.brands
  set subcategories = array_remove(
    coalesce(subcategories, '{}'::text[]),
    p_subcategory
  )
  where id = p_brand_id
    and p_subcategory = any(coalesce(subcategories, '{}'::text[]));
end
$function$;

create or replace function public.dev1648_append_product_subcategory_to_brand()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'UPDATE' then
    if old.visible
       and old.subcategory is not null
       and (
         not new.visible
         or new.brand_id is distinct from old.brand_id
         or new.subcategory is distinct from old.subcategory
       ) then
      perform public.dev1648_release_brand_product_subcategory(
        old.brand_id,
        old.subcategory
      );
    end if;
  end if;

  if new.visible and new.subcategory is not null then
    update public.brands
    set subcategories = array_append(
      coalesce(subcategories, '{}'::text[]),
      new.subcategory
    )
    where id = new.brand_id
      and not (new.subcategory = any(coalesce(subcategories, '{}'::text[])));

    if found then
      insert into public.brand_product_subcategory_additions (
        brand_id,
        subcategory
      ) values (
        new.brand_id,
        new.subcategory
      )
      on conflict (brand_id, subcategory) do nothing;
    end if;
  end if;
  return new;
end
$function$;

revoke all on function public.dev1648_release_brand_product_subcategory(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.dev1648_append_product_subcategory_to_brand()
  from public, anon, authenticated;
grant execute on function public.dev1648_release_brand_product_subcategory(uuid, text)
  to postgres;
grant execute on function public.dev1648_append_product_subcategory_to_brand()
  to postgres, service_role;

-- The product rerun already corrected Li Jaou's kitchen shears to hand-tools.
-- The prior one-way trigger left cookware behind, and the pre-union field event
-- proves it was not part of the brand-level classification.
insert into public.brand_product_subcategory_additions (brand_id, subcategory)
select brand.id, 'cookware'
from public.brands as brand
where brand.slug = 'li-jaou'
  and 'cookware' = any(coalesce(brand.subcategories, '{}'::text[]))
  and not exists (
    select 1
    from public.curated_products as product
    where product.brand_id = brand.id
      and product.visible
      and product.subcategory = 'cookware'
  )
on conflict (brand_id, subcategory) do nothing;

select public.dev1648_release_brand_product_subcategory(brand.id, 'cookware')
from public.brands as brand
where brand.slug = 'li-jaou';

do $assertions$
declare
  v_product_id uuid;
  v_brand_id uuid;
begin
  if exists (
    select 1
    from public.brands as brand
    where brand.slug = 'li-jaou'
      and 'cookware' = any(coalesce(brand.subcategories, '{}'::text[]))
      and not exists (
        select 1
        from public.curated_products as product
        where product.brand_id = brand.id
          and product.visible
          and product.subcategory = 'cookware'
      )
  ) then
    raise exception 'product-derived Li Jaou cookware L2 was not released';
  end if;

  -- Exercise correction in a subtransaction: hand-tools -> cookware appends
  -- and records product ownership; cookware -> hand-tools releases both.
  select product.id, product.brand_id
  into v_product_id, v_brand_id
  from public.curated_products as product
  join public.brands as brand on brand.id = product.brand_id
  where brand.slug = 'li-jaou'
    and product.visible
    and product.category = 'home'
    and product.subcategory = 'hand-tools'
  limit 1;

  if v_product_id is not null then
    begin
      update public.curated_products
      set subcategory = 'cookware'
      where id = v_product_id;

      if not exists (
        select 1
        from public.brands
        where id = v_brand_id and 'cookware' = any(subcategories)
      ) or not exists (
        select 1
        from public.brand_product_subcategory_additions
        where brand_id = v_brand_id and subcategory = 'cookware'
      ) then
        raise exception 'product L2 append provenance assertion failed';
      end if;

      update public.curated_products
      set subcategory = 'hand-tools'
      where id = v_product_id;

      if exists (
        select 1
        from public.brands
        where id = v_brand_id and 'cookware' = any(subcategories)
      ) or exists (
        select 1
        from public.brand_product_subcategory_additions
        where brand_id = v_brand_id and subcategory = 'cookware'
      ) then
        raise exception 'product L2 release assertion failed';
      end if;

      raise exception using
        errcode = 'ZX001',
        message = 'rollback product L2 release assertion';
    exception when sqlstate 'ZX001' then
      null;
    end;
  end if;
end
$assertions$;

commit;
