-- Private staging only. Public production fields were reviewed; every mutation
-- journey record below is explicitly labeled as a staging fixture.
--
-- SEEDS BRANDS ONLY. The `Staging Fixture • <brand>` brand_channels block was
-- deleted on 2026-08-17: a channel is where a reader is told they can actually
-- buy something, and forty invented rows pointing at example.com sat in the
-- same list as real, source-backed stockists. Staging now shows only channels
-- that came from a brand's own published pages.
--
-- Deleting the block only stopped future writes; the fixture is insert-only, so
-- the forty rows it had already seeded stayed in staging. The cleanup at the
-- bottom of this file removes them, and re-running it is a no-op.
--
-- The brands below are NOT invented — real names, real slugs, real
-- purchase_website URLs. Only the fabricated channels are gone.
--
-- The `category` column here is an UPSERT that wins: `on conflict … do update`
-- writes it back over whatever the row already holds. So every value must agree
-- with `20260820090000_split_kids_pets_l1.sql`, which reassigns 1woof -> pets,
-- 2angels -> kids, angle-wave -> pets, softie-bunny -> kids. Disagreeing is not
-- self-healing: that migration's update is guarded by `category = 'kids-pets'`,
-- which no longer matches any row, so re-running it cannot undo a wrong seed.

with fixture(id, name, slug, category, city, purchase_website) as (
  values
    ('51000000-0000-4000-8000-000000000001'::uuid, '74OUNCE', '74ounce', 'bags-accessories', 'chiayi_city', 'https://www.74oz.com.tw/'),
    ('51000000-0000-4000-8000-000000000002'::uuid, '87 小兔 87rabbit', '87rabbit', 'bags-accessories', null, null),
    ('51000000-0000-4000-8000-000000000003'::uuid, 'A Merry Heart', 'a-merry-heart', 'bags-accessories', null, 'https://www.amerryheart.co'),
    ('51000000-0000-4000-8000-000000000004'::uuid, 'Ahshuo Island 阿說不想說', 'ahshuo-island', 'bags-accessories', null, null),
    ('51000000-0000-4000-8000-000000000005'::uuid, 'TRIFORCE 翠芙思', '3triforce', 'beauty', 'kaohsiung', 'https://www.3triforce.com.tw'),
    ('51000000-0000-4000-8000-000000000006'::uuid, '天天', '8vd', 'beauty', 'taoyuan', 'https://www.shop8vd.com'),
    ('51000000-0000-4000-8000-000000000007'::uuid, 'ADELA', 'adela', 'beauty', 'taichung', 'https://www.adela.tw'),
    ('51000000-0000-4000-8000-000000000008'::uuid, '一公分手作 1Cmhandmake', '1cmhandmake', 'crafts', null, 'https://1cmhandmade.com'),
    ('51000000-0000-4000-8000-000000000009'::uuid, '玖一藝術工作室 91art.studio', '91art-studio', 'crafts', 'taipei', null),
    ('51000000-0000-4000-8000-000000000010'::uuid, 'Acuí A Cui studio', 'acui-a-cui-studio', 'crafts', null, 'https://www.acuiart.com'),
    ('51000000-0000-4000-8000-000000000011'::uuid, '母子鱷魚 2BM', '2bm', 'fashion', null, 'https://www.2bm.com.tw'),
    ('51000000-0000-4000-8000-000000000012'::uuid, '333 Slippers', '333-slippers', 'fashion', null, 'https://www.333-slippers.com'),
    ('51000000-0000-4000-8000-000000000013'::uuid, '7th Island', '7th-island', 'fashion', null, null),
    ('51000000-0000-4000-8000-000000000014'::uuid, '9:02 Nineoootwo', '9-02-nineoootwo', 'fitness', null, 'https://nineoootwo.com'),
    ('51000000-0000-4000-8000-000000000015'::uuid, 'BeRule', 'berule', 'fitness', null, 'https://tw.be-rule.com/'),
    ('51000000-0000-4000-8000-000000000016'::uuid, '輝葉 HueiYeh', 'hueiyeh', 'fitness', 'taipei', 'https://www.hueiyeh.com.tw/'),
    ('51000000-0000-4000-8000-000000000017'::uuid, '壹顆蜆', '1-koshijimi', 'food-drink', 'changhua', 'https://1koshijimi.com.tw'),
    ('51000000-0000-4000-8000-000000000018'::uuid, '鹿苑茶莊 1935', '1935', 'food-drink', 'yilan', null),
    ('51000000-0000-4000-8000-000000000019'::uuid, '山鄰山林 3030', '3030', 'food-drink', 'hualien', 'https://www.3030selection3030.com/'),
    ('51000000-0000-4000-8000-000000000020'::uuid, '404 Oligo', '404-oligo', 'food-drink', 'taipei', 'https://www.404oligo.com'),
    ('51000000-0000-4000-8000-000000000021'::uuid, '1973 Furniture', '1973-furniture', 'home', 'taoyuan', 'https://1973home.myshopify.com'),
    ('51000000-0000-4000-8000-000000000022'::uuid, '安喬欣業 25togo', '25togo', 'home', 'taoyuan', 'https://store.25togo.com'),
    ('51000000-0000-4000-8000-000000000023'::uuid, 'A Plant Studio 多淼設計', 'a-plant-studio', 'home', null, null),
    ('51000000-0000-4000-8000-000000000024'::uuid, '5AM Jewelry', '5am-jewelry', 'jewelry', 'taipei', 'https://5amjewelry.com'),
    ('51000000-0000-4000-8000-000000000025'::uuid, 'AiliN', 'ailin', 'jewelry', null, null),
    ('51000000-0000-4000-8000-000000000026'::uuid, '波鳥 Bo-Bird', 'bobird', 'jewelry', 'hualien', null),
    ('51000000-0000-4000-8000-000000000027'::uuid, '一屋 1woof', '1woof', 'pets', null, null),
    ('51000000-0000-4000-8000-000000000028'::uuid, '2Angels', '2angels', 'kids', null, 'https://2angelsbaby.com'),
    ('51000000-0000-4000-8000-000000000029'::uuid, '安閣家 ANGLE WAVE', 'angle-wave', 'pets', 'changhua', 'https://www.anglewave.com'),
    ('51000000-0000-4000-8000-000000000030'::uuid, 'ACEKA', 'aceka', 'outdoor', null, 'https://www.aceka.com.tw'),
    ('51000000-0000-4000-8000-000000000031'::uuid, '衣力美 EasyMain', 'easymain', 'outdoor', 'tainan', 'https://www.easymain.com.tw'),
    ('51000000-0000-4000-8000-000000000032'::uuid, '好手 Good Hand', 'good-hand', 'outdoor', 'changhua', 'https://www.good-hand.com.tw'),
    ('51000000-0000-4000-8000-000000000033'::uuid, '兩顆糖製造機 2SUGARSTUDIO', '2sugarstudio', 'stationery', null, null),
    ('51000000-0000-4000-8000-000000000034'::uuid, '小行星B-610 Asteroid B-610', 'b-610-asteroid-b-610', 'stationery', 'changhua', 'https://www.asteroidb610.com'),
    ('51000000-0000-4000-8000-000000000035'::uuid, 'Bon Bon Stickers 邦妮插畫', 'bon-bon-stickers', 'stationery', null, 'https://www.bonbonstickers.tw'),
    ('51000000-0000-4000-8000-000000000036'::uuid, 'CHiiZ BEAR 起司貝爾', 'chiiz-bear', 'stationery', null, null),
    ('51000000-0000-4000-8000-000000000037'::uuid, 'Allite', 'allite', 'tech', null, 'https://www.onemore.me/'),
    ('51000000-0000-4000-8000-000000000038'::uuid, 'ENABLE', 'enable', 'tech', null, 'https://www.go-enable.com/'),
    ('51000000-0000-4000-8000-000000000039'::uuid, 'HIPPORIZZ 河馬引力', 'hipporizz', 'tech', null, 'https://hipporizz.com.tw'),
    ('51000000-0000-4000-8000-000000000040'::uuid, 'Overdigi', 'overdigi', 'tech', null, 'https://www.overdigi.com')
)
insert into public.brands (
  id, name, slug, description, status, approved_at, source, category, city,
  purchase_website
)
select
  id,
  name,
  slug,
  'Staging fixture record for private QA. Public fields only.',
  'approved',
  '2026-08-12T00:00:00Z'::timestamptz,
  'demo_seed',
  category,
  city,
  purchase_website
from fixture
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  description = excluded.description,
  status = excluded.status,
  approved_at = excluded.approved_at,
  source = excluded.source,
  category = excluded.category,
  city = excluded.city,
  purchase_website = excluded.purchase_website;

-- Cleanup of the deleted fabricated-channel block. Matched on the fixed id
-- range this file used to write, NOT on the `Staging Fixture • ` name pattern:
-- a real channel could one day carry a similar name, and an id range can only
-- ever hit rows this fixture created. Confirmations cascade with the channel.
delete from public.brand_channels
where id between '52000000-0000-4000-8000-000000000001'::uuid
            and '52000000-0000-4000-8000-000000000040'::uuid;
