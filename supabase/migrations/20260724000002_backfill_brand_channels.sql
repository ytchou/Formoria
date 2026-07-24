-- Backfill brand channels from brands.retail_locations.

with
city_name_variants(slug, label) as (
  values
    ('taipei', '台北'),
    ('new_taipei', '新北'),
    ('taoyuan', '桃園'),
    ('taichung', '台中'),
    ('tainan', '台南'),
    ('kaohsiung', '高雄'),
    ('keelung', '基隆'),
    ('hsinchu_city', '新竹'),
    ('hsinchu_county', '新竹縣'),
    ('miaoli', '苗栗'),
    ('changhua', '彰化'),
    ('nantou', '南投'),
    ('yunlin', '雲林'),
    ('chiayi_city', '嘉義'),
    ('chiayi_county', '嘉義縣'),
    ('pingtung', '屏東'),
    ('yilan', '宜蘭'),
    ('hualien', '花蓮'),
    ('taitung', '台東'),
    ('penghu', '澎湖'),
    ('kinmen', '金門'),
    ('lienchiang', '連江')
),
expanded as (
  select
    b.id as brand_id,
    item.ordinality,
    item.value as element
  from public.brands as b
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(b.retail_locations) = 'array' then b.retail_locations
      else '[]'::jsonb
    end
  ) with ordinality as item(value, ordinality)
  where jsonb_typeof(item.value) = 'object'
),
typed as (
  select
    e.*,
    btrim(e.element ->> 'name') as original_name,
    nullif(btrim(e.element ->> 'address'), '') as address_value,
    case
      when btrim(e.element ->> 'latitude') ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
        then (e.element ->> 'latitude')::numeric
    end as latitude_value,
    case
      when btrim(e.element ->> 'longitude') ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
        then (e.element ->> 'longitude')::numeric
    end as longitude_value
  from expanded as e
),
classified as (
  select
    t.*,
    case
      when t.element ->> 'kind' in ('location', 'retail_chain')
        then t.element ->> 'kind'
      when t.address_value is not null
        or (
          t.latitude_value between -90 and 90
          and t.longitude_value between -180 and 180
        )
        then 'location'
      when lower(btrim(coalesce(t.element ->> 'type', ''))) = 'chain'
        or lower(btrim(coalesce(t.element ->> 'locationKind', ''))) = 'chain'
        then 'retail_chain'
      else 'location'
    end as canonical_kind
  from typed as t
),
normalized_base as (
  select
    c.*,
    lower(regexp_replace(c.original_name, '[[:space:]]', '', 'g')) as normalized_name_00
  from classified as c
),
normalized_01 as (
  select
    n.*,
    regexp_replace(n.normalized_name_00, '戶外休閒專業中心$', '', 'g') as normalized_name_01
  from normalized_base as n
),
normalized_02 as (
  select
    n.*,
    regexp_replace(n.normalized_name_01, '戶外用品專門店$', '', 'g') as normalized_name_02
  from normalized_01 as n
),
normalized_03 as (
  select
    n.*,
    regexp_replace(n.normalized_name_02, '戶外用品店$', '', 'g') as normalized_name_03
  from normalized_02 as n
),
normalized_04 as (
  select
    n.*,
    regexp_replace(n.normalized_name_03, '戶外休閒$', '', 'g') as normalized_name_04
  from normalized_03 as n
),
normalized_05 as (
  select
    n.*,
    regexp_replace(n.normalized_name_04, '戶外用品$', '', 'g') as normalized_name_05
  from normalized_04 as n
),
normalized_06 as (
  select
    n.*,
    regexp_replace(n.normalized_name_05, '戶外$', '', 'g') as normalized_name_06
  from normalized_05 as n
),
normalized_07 as (
  select
    n.*,
    regexp_replace(n.normalized_name_06, '專業中心$', '', 'g') as normalized_name_07
  from normalized_06 as n
),
normalized_08 as (
  select
    n.*,
    regexp_replace(n.normalized_name_07, '旗艦門市$', '', 'g') as normalized_name_08
  from normalized_07 as n
),
normalized_09 as (
  select
    n.*,
    regexp_replace(n.normalized_name_08, '旗艦店$', '', 'g') as normalized_name_09
  from normalized_08 as n
),
normalized_10 as (
  select
    n.*,
    regexp_replace(n.normalized_name_09, '專賣店$', '', 'g') as normalized_name_10
  from normalized_09 as n
),
normalized_11 as (
  select
    n.*,
    regexp_replace(n.normalized_name_10, '用品店$', '', 'g') as normalized_name_11
  from normalized_10 as n
),
normalized_12 as (
  select
    n.*,
    regexp_replace(n.normalized_name_11, '分公司$', '', 'g') as normalized_name_12
  from normalized_11 as n
),
normalized_13 as (
  select
    n.*,
    regexp_replace(n.normalized_name_12, '門市$', '', 'g') as normalized_name_13
  from normalized_12 as n
),
normalized_14 as (
  select
    n.*,
    regexp_replace(n.normalized_name_13, '分店$', '', 'g') as normalized_name_14
  from normalized_13 as n
),
normalized_15 as (
  select
    n.*,
    regexp_replace(n.normalized_name_14, '選物$', '', 'g') as normalized_name_15
  from normalized_14 as n
),
normalized_16 as (
  select
    n.*,
    regexp_replace(n.normalized_name_15, '商店$', '', 'g') as normalized_name_16
  from normalized_15 as n
),
normalized_17 as (
  select
    n.*,
    regexp_replace(n.normalized_name_16, '店$', '', 'g') as normalized_name_17
  from normalized_16 as n
),
valid_rows as (
  select
    n.*,
    left(n.normalized_name_17, 80) as normalized_name
  from normalized_17 as n
  where left(n.normalized_name_17, 80) <> ''
),
location_rows as (
  select
    v.brand_id,
    v.ordinality,
    v.original_name,
    v.normalized_name,
    v.address_value as address,
    city.slug as city_slug,
    city.label as city_label,
    case v.element ->> 'relationshipType'
      when 'brand_store' then '品牌直營'
      when 'department_counter' then '百貨專櫃'
      when 'stockist' then '選品店'
    end as category_label,
    (v.element ->> 'confirmationStatus') = 'owner_confirmed' as owner_confirmed
  from valid_rows as v
  left join city_name_variants as city
    on city.slug = lower(btrim(v.element ->> 'city'))
  where v.canonical_kind = 'location'
),
location_groups as (
  select
    l.brand_id,
    l.normalized_name,
    count(*) as location_count,
    count(*) filter (where l.city_slug is not null) as known_city_count,
    count(distinct l.city_slug) as distinct_city_count,
    max(l.city_label) as single_city_label,
    max(l.category_label) as category_label,
    coalesce(bool_or(l.owner_confirmed), false) as has_owner_confirmation
  from location_rows as l
  group by l.brand_id, l.normalized_name
),
location_shortest_names as (
  select distinct on (l.brand_id, l.normalized_name)
    l.brand_id,
    l.normalized_name,
    l.original_name,
    l.address
  from location_rows as l
  order by
    l.brand_id,
    l.normalized_name,
    char_length(l.original_name),
    l.original_name,
    l.ordinality
),
location_channels as (
  select
    g.brand_id,
    left(s.original_name, 80) as name,
    g.normalized_name,
    'offline'::text as channel_type,
    g.category_label,
    case
      when g.location_count = 1 then g.single_city_label
      when g.known_city_count = g.location_count
        and g.distinct_city_count = 1 then '多間門市'
      else '全台多間門市'
    end as region_label,
    case when g.location_count = 1 then s.address end as address,
    null::text as url,
    'backfill'::text as source,
    case when g.has_owner_confirmation then 'confirmed' else 'none' end as owner_status
  from location_groups as g
  join location_shortest_names as s
    on s.brand_id = g.brand_id
    and s.normalized_name = g.normalized_name
),
chain_channels as (
  select
    v.brand_id,
    left(v.original_name, 80) as name,
    v.normalized_name,
    'offline'::text as channel_type,
    null::text as category_label,
    left(coalesce(v.element ->> 'availabilityNote', '全台多間門市'), 40) as region_label,
    null::text as address,
    case
      when btrim(v.element ->> 'retailerUrl') ~* '^https?://'
        then btrim(v.element ->> 'retailerUrl')
      else null
    end as url,
    'backfill'::text as source,
    'none'::text as owner_status
  from valid_rows as v
  where v.canonical_kind = 'retail_chain'
),
channels as (
  select
    brand_id,
    name,
    normalized_name,
    channel_type,
    category_label,
    region_label,
    address,
    url,
    source,
    owner_status
  from chain_channels
  union all
  select
    brand_id,
    name,
    normalized_name,
    channel_type,
    category_label,
    region_label,
    address,
    url,
    source,
    owner_status
  from location_channels
)
insert into public.brand_channels (
  brand_id,
  name,
  normalized_name,
  channel_type,
  category_label,
  region_label,
  address,
  url,
  source,
  owner_status
)
select
  brand_id,
  name,
  normalized_name,
  channel_type,
  category_label,
  region_label,
  address,
  url,
  source,
  owner_status
from channels
on conflict (brand_id, normalized_name) do nothing;

-- Verification: compare brands with non-empty retail_locations to distinct brands backfilled.
-- select
--   (
--     select count(*)
--     from public.brands as b
--     where jsonb_array_length(
--       case
--         when jsonb_typeof(b.retail_locations) = 'array' then b.retail_locations
--         else '[]'::jsonb
--       end
--     ) > 0
--   ) as brands_with_non_empty_retail_locations,
--   (select count(distinct brand_id) from public.brand_channels)
--     as distinct_brands_in_brand_channels;

-- Verification: row-level spot check for hanchor, if it exists.
-- select bc.*
-- from public.brand_channels as bc
-- join public.brands as b on b.id = bc.brand_id
-- where lower(b.name) = 'hanchor'
-- order by bc.normalized_name, bc.id;
