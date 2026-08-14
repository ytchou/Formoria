-- Private staging only. Public production fields were reviewed; every mutation
-- journey record below is explicitly labeled as a staging fixture.

with fixture(id, name, slug, product_type, city) as (
  values
    ('51000000-0000-4000-8000-000000000001'::uuid, '74OUNCE', '74ounce', 'bags-accessories', 'chiayi_city'),
    ('51000000-0000-4000-8000-000000000002'::uuid, '87 小兔 87rabbit', '87rabbit', 'bags-accessories', null),
    ('51000000-0000-4000-8000-000000000003'::uuid, 'A Merry Heart', 'a-merry-heart', 'bags-accessories', null),
    ('51000000-0000-4000-8000-000000000004'::uuid, 'Ahshuo Island 阿說不想說', 'ahshuo-island', 'bags-accessories', null),
    ('51000000-0000-4000-8000-000000000005'::uuid, 'TRIFORCE 翠芙思', '3triforce', 'beauty', 'kaohsiung'),
    ('51000000-0000-4000-8000-000000000006'::uuid, '天天', '8vd', 'beauty', 'taoyuan'),
    ('51000000-0000-4000-8000-000000000007'::uuid, 'ADELA', 'adela', 'beauty', 'taichung'),
    ('51000000-0000-4000-8000-000000000008'::uuid, '一公分手作 1Cmhandmake', '1cmhandmake', 'crafts', null),
    ('51000000-0000-4000-8000-000000000009'::uuid, '玖一藝術工作室 91art.studio', '91art-studio', 'crafts', 'taipei'),
    ('51000000-0000-4000-8000-000000000010'::uuid, 'Acuí A Cui studio', 'acui-a-cui-studio', 'crafts', null),
    ('51000000-0000-4000-8000-000000000011'::uuid, '母子鱷魚 2BM', '2bm', 'fashion', null),
    ('51000000-0000-4000-8000-000000000012'::uuid, '333 Slippers', '333-slippers', 'fashion', null),
    ('51000000-0000-4000-8000-000000000013'::uuid, '7th Island', '7th-island', 'fashion', null),
    ('51000000-0000-4000-8000-000000000014'::uuid, '9:02 Nineoootwo', '9-02-nineoootwo', 'fitness', null),
    ('51000000-0000-4000-8000-000000000015'::uuid, 'BeRule', 'berule', 'fitness', null),
    ('51000000-0000-4000-8000-000000000016'::uuid, '輝葉 HueiYeh', 'hueiyeh', 'fitness', 'taipei'),
    ('51000000-0000-4000-8000-000000000017'::uuid, '壹顆蜆', '1-koshijimi', 'food-drink', 'changhua'),
    ('51000000-0000-4000-8000-000000000018'::uuid, '鹿苑茶莊 1935', '1935', 'food-drink', 'yilan'),
    ('51000000-0000-4000-8000-000000000019'::uuid, '山鄰山林 3030', '3030', 'food-drink', 'hualien'),
    ('51000000-0000-4000-8000-000000000020'::uuid, '404 Oligo', '404-oligo', 'food-drink', 'taipei'),
    ('51000000-0000-4000-8000-000000000021'::uuid, '1973 Furniture', '1973-furniture', 'home', 'taoyuan'),
    ('51000000-0000-4000-8000-000000000022'::uuid, '安喬欣業 25togo', '25togo', 'home', 'taoyuan'),
    ('51000000-0000-4000-8000-000000000023'::uuid, 'A Plant Studio 多淼設計', 'a-plant-studio', 'home', null),
    ('51000000-0000-4000-8000-000000000024'::uuid, '5AM Jewelry', '5am-jewelry', 'jewelry', 'taipei'),
    ('51000000-0000-4000-8000-000000000025'::uuid, 'AiliN', 'ailin', 'jewelry', null),
    ('51000000-0000-4000-8000-000000000026'::uuid, '波鳥 Bo-Bird', 'bobird', 'jewelry', 'hualien'),
    ('51000000-0000-4000-8000-000000000027'::uuid, '一屋 1woof', '1woof', 'kids-pets', null),
    ('51000000-0000-4000-8000-000000000028'::uuid, '2Angels', '2angels', 'kids-pets', null),
    ('51000000-0000-4000-8000-000000000029'::uuid, '安閣家 ANGLE WAVE', 'angle-wave', 'kids-pets', 'changhua'),
    ('51000000-0000-4000-8000-000000000030'::uuid, 'ACEKA', 'aceka', 'outdoor', null),
    ('51000000-0000-4000-8000-000000000031'::uuid, '衣力美 EasyMain', 'easymain', 'outdoor', 'tainan'),
    ('51000000-0000-4000-8000-000000000032'::uuid, '好手 Good Hand', 'good-hand', 'outdoor', 'changhua'),
    ('51000000-0000-4000-8000-000000000033'::uuid, '兩顆糖製造機 2SUGARSTUDIO', '2sugarstudio', 'stationery', null),
    ('51000000-0000-4000-8000-000000000034'::uuid, '小行星B-610 Asteroid B-610', 'b-610-asteroid-b-610', 'stationery', 'changhua'),
    ('51000000-0000-4000-8000-000000000035'::uuid, 'Bon Bon Stickers 邦妮插畫', 'bon-bon-stickers', 'stationery', null),
    ('51000000-0000-4000-8000-000000000036'::uuid, 'CHiiZ BEAR 起司貝爾', 'chiiz-bear', 'stationery', null),
    ('51000000-0000-4000-8000-000000000037'::uuid, 'Allite', 'allite', 'tech', null),
    ('51000000-0000-4000-8000-000000000038'::uuid, 'ENABLE', 'enable', 'tech', null),
    ('51000000-0000-4000-8000-000000000039'::uuid, 'HIPPORIZZ 河馬引力', 'hipporizz', 'tech', null),
    ('51000000-0000-4000-8000-000000000040'::uuid, 'Overdigi', 'overdigi', 'tech', null)
)
insert into public.brands (
  id, name, slug, description, status, approved_at, source, product_type, city
)
select
  id,
  name,
  slug,
  'Staging fixture record for private QA. Public fields only.',
  'approved',
  '2026-08-12T00:00:00Z'::timestamptz,
  'demo_seed',
  product_type,
  city
from fixture
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  description = excluded.description,
  status = excluded.status,
  approved_at = excluded.approved_at,
  source = excluded.source,
  product_type = excluded.product_type,
  city = excluded.city;

with fixture as (
  select
    row_number() over (order by id) as fixture_number,
    id as brand_id,
    name
  from public.brands
  where id >= '51000000-0000-4000-8000-000000000001'::uuid
    and id <= '51000000-0000-4000-8000-000000000040'::uuid
)
insert into public.brand_channels (
  id, brand_id, name, normalized_name, channel_type, category_label,
  region_label, address, url, source, owner_status, country
)
select
  ('52000000-0000-4000-8000-' || lpad(fixture_number::text, 12, '0'))::uuid,
  brand_id,
  'Staging Fixture • ' || name,
  'staging-fixture-' || fixture_number,
  case when fixture_number % 5 = 0 then 'online' else 'offline' end,
  case when fixture_number % 5 = 0 then '品牌官網' else '實體門市' end,
  case fixture_number % 4
    when 0 then '高雄市'
    when 1 then '臺北市'
    when 2 then '新北市'
    else '臺中市'
  end,
  case
    when fixture_number = 39 then null
    when fixture_number = 40 then 'Unmatched staging-only address'
    when fixture_number % 4 = 0 then '高雄市苓雅區四維三路2號'
    when fixture_number % 4 = 1 then '臺北市信義區市府路45號'
    when fixture_number % 4 = 2 then '新北市板橋區中山路一段161號'
    else '臺中市西屯區臺灣大道三段99號'
  end,
  'https://example.com/staging-fixture/' || fixture_number,
  'admin',
  'none',
  'TW'
from fixture
on conflict (id) do update set
  name = excluded.name,
  normalized_name = excluded.normalized_name,
  channel_type = excluded.channel_type,
  category_label = excluded.category_label,
  region_label = excluded.region_label,
  address = excluded.address,
  url = excluded.url,
  source = excluded.source,
  owner_status = excluded.owner_status,
  country = excluded.country,
  updated_at = now();
