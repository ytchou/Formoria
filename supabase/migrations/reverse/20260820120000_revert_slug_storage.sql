-- Reverse of DEV-1510 task 9: brands and the subcategory jsonb surfaces go back
-- from English L2 slugs to the zh-TW labels they stored before the backfill.
--
-- Written and rehearsed BEFORE the forward migration exists, so the forward
-- never runs without a proven exit. Rehearsal:
--
--   set -a && . ./.env.staging && set +a && pnpm exec tsx scripts/rehearse-slug-reverse.ts
--
-- Applying it for real, against a target confirmed by hand, in a fresh session:
--
--   psql "$SUPABASE_DB_URL" --single-transaction \
--     -f supabase/migrations/reverse/20260820120000_revert_slug_storage.sql
--
-- `supabase/migrations/reverse/` is a rollback holding area, NOT part of the
-- forward ledger. `scripts/db-deploy.ts:430` enumerates `supabase/migrations`
-- non-recursively and keeps only `*.sql`, and `supabase db push` reads the same
-- flat directory, so nothing in here is ever applied by `pnpm db:migrate` or
-- counted by `db:verify`.
--
-- WHAT THIS FILE RESTORES
--
-- Every stored slug becomes a zh-TW label again. For 744 of the 795 brands in
-- the pre-migration corpus the node's canonical `nameZh` IS the stored string,
-- so the slug alone is enough. The other 51 stored something the slug cannot
-- reproduce — an alias spelling (`帆布包` for `tote-bags`), or two labels that
-- collapsed onto one slug (`雨傘` and `陽傘` both on `umbrellas`). Those brands
-- get an exact per-brand restoration, generated from the corpus.
--
-- The restoration applies only while a brand still carries exactly the slug set
-- the forward backfill produced. A brand re-tagged after the forward migration
-- falls back to the canonical map rather than having that edit reverted.
--
-- WHAT THIS FILE DOES NOT RESTORE — AND WHY THAT IS ACCEPTED
--
-- The forward backfill DELETES the 28 `EVICTED_LABELS` and the 14
-- `OUT_OF_FRAME_LABELS` (`src/lib/taxonomy/ontology.ts:381,427`) instead of
-- converting them. They leave no slug behind, so no reverse can reconstruct
-- them from storage — 35 of the 42 appear in the corpus, across 205 tag-uses.
--
-- That loss is accepted because it is recoverable out of band and because it is
-- not part of the storage swap: eviction is an editorial closure of the
-- vocabulary (ADR 2026-08-19, decisions 5 and 8), and a rollback of a
-- representation change must not quietly resurrect vocabulary that a separate
-- decision removed. Every dropped string, with its brand, is in
-- `docs/reports/2026-08-19-taxonomy-pre-migration-corpus.csv` and — because
-- `docs/` is gitignored and that CSV exists only on the machine that exported
-- it — in the committed copy at `scripts/slug-reverse-corpus.json`. Restoring a
-- specific brand's evicted tags is a hand-written UPDATE against that file, not
-- an automated step.
--
-- ALSO OUT OF SCOPE
--
--  * `brands.subcategories_en` is English before and after the swap; untouched.
--  * The `kids-pets` L1 split (`20260820090000_split_kids_pets_l1.sql`) is a
--    different axis with its own rollback. This file does not touch
--    `brands.category` or `draft_data->>'categorySlug'`.
--  * If `20260820110000_search_expands_slugs.sql` was also deployed, revert it
--    separately and in the same window. Left in place it expands stored values
--    through `taxonomy_terms` as if they were slugs, so restored zh-TW labels
--    index through the no-match path and CJK recall degrades silently.
--
-- The `brands` UPDATE fires `brands_search_vector_trigger` and
-- `brands_content_provenance`, which is intended: the search document has to be
-- recomputed from the restored labels.
--
-- Data blocks between the `-- >>>` / `-- <<<` markers are generated from
-- `src/lib/taxonomy/ontology.ts` and `scripts/slug-reverse-corpus.json`.
-- `scripts/__tests__/rehearse-slug-reverse.test.ts` parses them back out and
-- fails on drift.

create temp table pg_temp.reverse_label_map (
  slug text primary key,
  name_zh text not null
);

-- >>> label map
insert into pg_temp.reverse_label_map (slug, name_zh) values
  ('activewear', '運動服飾'),
  ('alcohol', '酒類'),
  ('baby-bedding', '嬰幼兒寢具'),
  ('baby-clothing', '嬰幼兒服飾'),
  ('backpacks', '後背包'),
  ('bamboo-craft', '竹編・竹藝'),
  ('bath-accessories', '衛浴用品'),
  ('bath-and-shower', '洗沐清潔'),
  ('beauty-tools', '美妝工具・儀器'),
  ('bedding', '寢具'),
  ('belt-and-sling-bags', '腰包・胸包'),
  ('beverages', '飲品'),
  ('bibs-and-muslin', '圍兜・紗布巾'),
  ('body-care', '身體保養'),
  ('bookmarks', '書籤'),
  ('boots', '靴子'),
  ('bracelets-and-bangles', '手鍊・手環'),
  ('brooches', '胸針'),
  ('bucket-bags', '水桶包'),
  ('calendars', '月曆・日曆'),
  ('camera-bags', '相機包'),
  ('candles', '蠟燭'),
  ('card-holders', '卡夾・證件套'),
  ('cards-and-postcards', '卡片・明信片'),
  ('care-and-mobility-aids', '照護輔具'),
  ('casual-shoes', '休閒鞋'),
  ('ceramics', '陶瓷・陶藝'),
  ('chargers-and-cables', '充電器・充電線'),
  ('charms', '吊飾'),
  ('chocolate-and-cacao', '巧克力・可可'),
  ('clasp-frame-bags', '口金包'),
  ('cleaning', '清潔用品'),
  ('clocks', '時鐘'),
  ('clutches', '手拿包'),
  ('coffee', '咖啡'),
  ('coin-purses', '零錢包'),
  ('cookies-and-rice-crackers', '餅乾・米餅'),
  ('cookware', '鍋具'),
  ('cosmetic-bags', '化妝包'),
  ('craft-kits-and-supplies', '手作材料・工具'),
  ('crossbody-bags', '斜背包'),
  ('cufflinks-and-tie-clips', '袖扣・領帶夾'),
  ('curtains', '窗簾'),
  ('cycling-and-riding', '自行車・騎士用品'),
  ('dairy', '乳製品'),
  ('desk-mats', '桌墊'),
  ('desk-organization', '文具收納'),
  ('desserts-and-pastries', '甜點・糕點'),
  ('device-sleeves', '保護套・皮套'),
  ('dresses', '洋裝'),
  ('dried-flowers-and-floral-design', '乾燥花・花藝設計'),
  ('dried-fruits', '果乾'),
  ('earphones-and-headphones', '耳機'),
  ('earrings', '耳環'),
  ('eco-and-shopping-bags', '環保袋・購物袋'),
  ('embroidery', '刺繡'),
  ('essential-oils-and-hydrosols', '精油・純露'),
  ('eyewear', '眼鏡・太陽眼鏡'),
  ('face-masks', '面膜'),
  ('family-matching', '親子裝'),
  ('feminine-care', '生理用品'),
  ('figurines-and-plush', '公仔・玩偶'),
  ('fitness-equipment', '健身器材'),
  ('floral-arrangements', '花藝'),
  ('fragrance', '香水'),
  ('fresh-produce', '生鮮蔬果'),
  ('furniture', '家具'),
  ('glass-art', '玻璃・琉璃'),
  ('gloves', '手套'),
  ('hair-accessories', '髮飾'),
  ('hair-care', '髮品・頭皮護理'),
  ('hand-tools', '手工具'),
  ('handbags', '手提包'),
  ('handmade-soap', '手工皂'),
  ('hats', '帽子'),
  ('heels', '高跟鞋'),
  ('helmets', '安全帽'),
  ('hiking-and-camping-gear', '登山・露營用品'),
  ('home-appliances', '生活家電'),
  ('home-decor', '居家擺飾'),
  ('home-fragrance', '居家香氛'),
  ('home-textiles', '居家織品'),
  ('honey', '蜂蜜'),
  ('illustration-and-art', '插畫・畫作'),
  ('jams-and-spreads', '果醬・抹醬'),
  ('journals-and-notebooks', '手帳・筆記本'),
  ('keychains', '鑰匙圈'),
  ('kids-clothing', '童裝'),
  ('kids-furniture', '兒童家具'),
  ('kids-tableware', '兒童餐具'),
  ('laptop-bags', '筆電包'),
  ('learning-aids', '教具'),
  ('leather-craft', '皮革工藝'),
  ('leather-shoes', '皮鞋'),
  ('lighting', '燈飾'),
  ('loungewear', '睡衣・居家服'),
  ('luggage-and-travel', '行李箱・旅行袋'),
  ('makeup', '彩妝'),
  ('massage-and-recovery', '按摩・放鬆'),
  ('mattresses', '床墊'),
  ('metalwork', '金工'),
  ('milk-powder', '奶粉'),
  ('natural-dyeing', '藍染・植物染'),
  ('necklaces', '項鍊'),
  ('needle-felting', '羊毛氈'),
  ('oral-care', '口腔護理'),
  ('outdoor-accessories', '戶外配件'),
  ('outerwear', '外套'),
  ('pants', '褲裝'),
  ('paper-goods', '紙品'),
  ('parenting-essentials', '育兒用品'),
  ('pens-and-writing', '筆具'),
  ('performance-apparel', '機能服飾'),
  ('pest-control', '防蟲用品'),
  ('pet-apparel', '寵物服飾・配件'),
  ('pet-beds-and-scratchers', '貓抓板・寵物床窩'),
  ('pet-food', '寵物食品'),
  ('pet-grooming', '寵物清潔・美容'),
  ('pet-supplements', '寵物保健'),
  ('pet-supplies', '寵物生活用品'),
  ('pet-treats', '寵物零食'),
  ('phone-bags', '手機袋'),
  ('phone-cases', '手機殼'),
  ('phone-straps', '手機背帶'),
  ('picnic-supplies', '野餐用品'),
  ('plants', '植栽'),
  ('play-mats-and-fences', '遊戲地墊・圍欄'),
  ('power-banks', '行動電源'),
  ('protective-gear', '護具'),
  ('protective-sprays', '防蚊・止汗噴霧'),
  ('ready-meals', '料理包・加工食品'),
  ('reusable-utensils-and-straws', '環保餐具・吸管'),
  ('rice-and-grains', '米・雜糧'),
  ('rings', '戒指'),
  ('rugs-and-mats', '地墊・地毯'),
  ('sandals-and-slippers', '涼鞋・拖鞋'),
  ('scarves-and-shawls', '圍巾・披肩'),
  ('seasonings-and-sauces', '調味料・醬料'),
  ('security-cameras', '攝影機'),
  ('skincare', '臉部保養'),
  ('skirts', '裙裝'),
  ('smart-doorbells', '智慧門鈴'),
  ('snacks', '零食'),
  ('socks', '襪子'),
  ('speakers', '藍牙喇叭'),
  ('stamps-and-seals', '印章'),
  ('stands-and-mounts', '支架'),
  ('stickers', '貼紙'),
  ('storage', '收納用品'),
  ('storage-devices', '儲存裝置'),
  ('storage-pouches', '收納包'),
  ('sun-care', '防曬'),
  ('supplements', '保健食品'),
  ('swimwear', '泳裝'),
  ('tableware', '餐具'),
  ('tea', '茶葉'),
  ('tea-and-coffee-ware', '茶具・咖啡器具'),
  ('tea-bags', '茶包'),
  ('tea-drinks', '茶飲'),
  ('tops-and-tshirts', '上衣・T恤'),
  ('tote-bags', '托特包'),
  ('towels', '毛巾'),
  ('toys', '玩具'),
  ('tumblers-and-bottles', '隨行杯・保溫瓶'),
  ('umbrellas', '雨傘・陽傘'),
  ('underwear-and-intimates', '貼身衣物'),
  ('wallets', '皮夾・錢包'),
  ('washi-tape', '紙膠帶'),
  ('watches', '手錶'),
  ('weaving-and-crochet', '編織・鉤織'),
  ('wedding-and-couple-rings', '婚戒・對戒'),
  ('wetsuits-and-water-sports', '防寒衣・水上運動'),
  ('wireless-charging', '無線充電'),
  ('woodcraft', '木藝・木作'),
  ('yoga-gear', '瑜珈用品');
-- <<< label map

create temp table pg_temp.reverse_restoration (
  brand_slug text primary key,
  expected_slugs text[] not null,
  restored_labels text[] not null
);

-- >>> restoration overlay
insert into pg_temp.reverse_restoration (brand_slug, expected_slugs, restored_labels) values
  ('25togo', array['home-decor', 'furniture', 'backpacks', 'luggage-and-travel']::text[], array['居家擺飾', '家具', '後背包', '旅行頸枕']::text[]),
  ('74ounce', array['handbags', 'backpacks', 'wallets', 'kids-tableware', 'belt-and-sling-bags']::text[], array['手提包', '後背包', '皮夾・錢包', '兒童餐具', '皮帶']::text[]),
  ('bobird', array['scarves-and-shawls', 'hats', 'hair-accessories']::text[], array['圍巾・披肩', '帽子', '手帕', '髮飾']::text[]),
  ('celebrate-today', array['illustration-and-art', 'craft-kits-and-supplies']::text[], array['插畫・畫作', '創作工具']::text[]),
  ('chia-pei-ya-shua', array['parenting-essentials', 'oral-care']::text[], array['育兒用品', '牙間刷']::text[]),
  ('chiiz-bear', array['card-holders', 'figurines-and-plush']::text[], array['卡套', '抱枕娃娃']::text[]),
  ('cucare', array['socks', 'hats', 'gloves']::text[], array['襪子', '帽子', '護理手套']::text[]),
  ('dear-nuts', array['snacks', 'dried-fruits']::text[], array['堅果', '果乾']::text[]),
  ('decus', array['umbrellas']::text[], array['雨傘', '折疊傘', '陽傘', '防風傘']::text[]),
  ('dong-tang', array['calendars', 'ceramics']::text[], array['萬年曆', '陶瓷・陶藝']::text[]),
  ('eco-hukurou', array['pest-control', 'cleaning']::text[], array['除蟲用品', '環境用藥', '居家清潔']::text[]),
  ('fluffystar', array['phone-cases', 'stands-and-mounts', 'card-holders', 'eco-and-shopping-bags', 'brooches', 'illustration-and-art']::text[], array['手機殼', '支架', '卡套', '環保袋・購物袋', '徽章', '插畫・畫作']::text[]),
  ('good-good-goods', array['tote-bags', 'storage-pouches']::text[], array['托特包', '收納包', '帆布包']::text[]),
  ('hank-max', array['wallets', 'casual-shoes', 'backpacks', 'umbrellas']::text[], array['皮夾・錢包', '休閒鞋', '後背包', '雨傘']::text[]),
  ('heyyou-moment', array['storage', 'cards-and-postcards', 'stickers', 'home-fragrance', 'desk-organization']::text[], array['收納用品', '卡片・明信片', '貼紙', '居家香氛', '桌面配件']::text[]),
  ('hmm', array['tea-and-coffee-ware', 'pens-and-writing', 'hand-tools', 'tableware']::text[], array['茶具・咖啡器具', '筆具', '剪刀', '玻璃杯盤']::text[]),
  ('huei-hei-ji-bai', array['journals-and-notebooks', 'stickers', 'stamps-and-seals', 'phone-cases', 'figurines-and-plush']::text[], array['手帳・筆記本', '貼紙', '印章', '手機殼', '絨毛玩偶']::text[]),
  ('hueiyeh', array['home-appliances', 'massage-and-recovery', 'kids-furniture']::text[], array['生活家電', '按摩・放鬆', '嬰兒床']::text[]),
  ('inblooom', array['laptop-bags', 'tote-bags', 'eco-and-shopping-bags', 'craft-kits-and-supplies']::text[], array['筆電包', '托特包', '環保袋・購物袋', '布料']::text[]),
  ('innx', array['card-holders', 'umbrellas']::text[], array['卡夾・證件套', '雨傘']::text[]),
  ('j-s', array['desserts-and-pastries', 'chocolate-and-cacao']::text[], array['可麗露', '甜點・糕點', '巧克力・可可']::text[]),
  ('kuo-jewellery', array['rings', 'earrings', 'necklaces', 'cufflinks-and-tie-clips']::text[], array['戒指', '耳環', '項鍊', '袖扣']::text[]),
  ('la-one-bakery', array['desserts-and-pastries', 'jams-and-spreads', 'ready-meals']::text[], array['麵包', '甜點・糕點', '果醬・抹醬', '料理包・加工食品']::text[]),
  ('loginheart', array['card-holders', 'keychains', 'eco-and-shopping-bags']::text[], array['卡夾・證件套', '鑰匙圈', '飲料提繩']::text[]),
  ('lsy-lamsamyick', array['beauty-tools', 'cosmetic-bags']::text[], array['彩妝刷具', '化妝包', '鏡子']::text[]),
  ('lumoef', array['home-fragrance', 'pet-grooming', 'cleaning', 'bath-and-shower', 'fragrance']::text[], array['居家香氛', '寵物清潔・美容', '洗衣精', '洗沐清潔', '香水']::text[]),
  ('mi-mi-leo', array['outerwear', 'pants', 'tops-and-tshirts', 'socks', 'gloves']::text[], array['外套', '褲裝', '上衣・T恤', '襪子', '袖套']::text[]),
  ('miin', array['skincare', 'home-decor', 'furniture']::text[], array['臉部保養', '居家擺飾', '邊桌']::text[]),
  ('moek-x-jesper', array['kids-tableware', 'tableware', 'crossbody-bags', 'storage-pouches']::text[], array['兒童餐具', '餐具', '肩背包', '束口袋']::text[]),
  ('nagi-nagi', array['stickers', 'figurines-and-plush']::text[], array['貼紙', '公仔']::text[]),
  ('overdigi', array['phone-cases', 'phone-straps']::text[], array['手機殼', '手機掛繩']::text[]),
  ('picupi', array['bath-and-shower', 'cleaning']::text[], array['洗沐清潔', '洗衣用品', '蔬果清潔用品']::text[]),
  ('popola', array['sun-care', 'face-masks', 'pet-supplies']::text[], array['防曬', '面膜', '寵物玩具']::text[]),
  ('shianey', array['underwear-and-intimates', 'kids-clothing']::text[], array['貼身衣物', '童褲']::text[]),
  ('simple-is', array['journals-and-notebooks', 'washi-tape', 'stickers', 'tableware']::text[], array['手帳・筆記本', '紙膠帶', '貼紙', '杯墊']::text[]),
  ('strong-love', array['dried-flowers-and-floral-design', 'paper-goods', 'plants']::text[], array['乾燥花・花藝設計', '紙品', '多肉園藝']::text[]),
  ('su-felting', array['figurines-and-plush', 'illustration-and-art', 'phone-cases', 'stickers']::text[], array['羊毛氈公仔', '插畫・畫作', '手機殼', '貼紙']::text[]),
  ('t-i-n-t-studio', array['home-fragrance', 'home-decor']::text[], array['居家香氛', '居家擺飾', '擴香瓶']::text[]),
  ('taiwan-acheng', array['keychains', 'storage', 'hand-tools', 'craft-kits-and-supplies']::text[], array['鑰匙圈', '收納用品', '手工具', 'DIY材料包']::text[]),
  ('taiwan-wader', array['boots']::text[], array['雨靴']::text[]),
  ('tan-huang-chia', array['desserts-and-pastries']::text[], array['蛋黃酥', '甜點・糕點']::text[]),
  ('tcf', array['pet-apparel', 'hats', 'handbags', 'umbrellas']::text[], array['寵物服飾・配件', '帽子', '手提包', '雨傘', '陽傘']::text[]),
  ('tshapeof', array['home-fragrance', 'ceramics']::text[], array['香道具', '陶瓷・陶藝']::text[]),
  ('tsnowstationery-design-studio', array['paper-goods', 'figurines-and-plush']::text[], array['紙品', '模型擺飾']::text[]),
  ('uffy', array['hair-care', 'cleaning']::text[], array['髮品・頭皮護理', '清潔刷']::text[]),
  ('vichy-s-diary', array['feminine-care']::text[], array['衛生棉', '護墊']::text[]),
  ('viigour', array['bath-and-shower', 'skincare', 'cleaning']::text[], array['洗沐清潔', '臉部保養', '洗衣清潔用品']::text[]),
  ('woolimoo', array['socks', 'scarves-and-shawls', 'tops-and-tshirts', 'home-textiles']::text[], array['襪子', '圍巾・披肩', '上衣・T恤', '毛毯']::text[]),
  ('yufutang', array['skincare', 'face-masks', 'hair-care', 'supplements', 'beauty-tools']::text[], array['臉部保養', '面膜', '髮品・頭皮護理', '保健食品', '美容儀器']::text[]),
  ('zuyun', array['home-fragrance']::text[], array['居家香氛', '盤香', '香粉']::text[]),
  ('專業研發-雙認證工廠製作', array['cleaning']::text[], array['清潔用品', '居家清潔']::text[]);
-- <<< restoration overlay

do $guard$
begin
  if (select count(*) from pg_temp.reverse_label_map) <> 175 then
    raise exception 'reverse label map has % rows, expected 175 live L2 nodes',
      (select count(*) from pg_temp.reverse_label_map);
  end if;
  if (select count(*) from pg_temp.reverse_restoration) <> 51 then
    raise exception 'restoration overlay has % rows, expected 51 brands',
      (select count(*) from pg_temp.reverse_restoration);
  end if;
end;
$guard$;

-- Helpers are plpgsql, not sql: a plpgsql body plans its statements on first
-- execution, so the temp-table references above resolve at call time rather
-- than at CREATE time.

create function pg_temp.reverse_labels(p_slugs text[])
returns text[]
language plpgsql
stable
as $fn$
declare
  v_labels text[];
begin
  if p_slugs is null then return null; end if;
  select coalesce(array_agg(coalesce(m.name_zh, e.value) order by e.ord), '{}'::text[])
    into v_labels
    from unnest(p_slugs) with ordinality as e(value, ord)
    left join pg_temp.reverse_label_map m on m.slug = e.value;
  return v_labels;
end;
$fn$;

-- Set equality, not array equality: the overlay describes which slugs the brand
-- must be carrying, and neither the forward backfill's ordering nor a later
-- reordering changes whether this brand's stored spellings are the right answer.
create function pg_temp.reverse_brand_labels(p_brand_slug text, p_slugs text[])
returns text[]
language plpgsql
stable
as $fn$
declare
  v_restored text[];
begin
  if p_slugs is null or cardinality(p_slugs) = 0 then return p_slugs; end if;
  select r.restored_labels
    into v_restored
    from pg_temp.reverse_restoration r
   where r.brand_slug = p_brand_slug
     and r.expected_slugs <@ p_slugs
     and p_slugs <@ r.expected_slugs;
  if v_restored is not null then return v_restored; end if;
  return pg_temp.reverse_labels(p_slugs);
end;
$fn$;

-- The jsonb surfaces carry subcategory arrays under four different keys and one
-- of them (`suggested_tags`) is sometimes a bare array instead of an object, so
-- this walks the value rather than assuming a shape. A string that is not a
-- known slug passes through untouched, which makes the whole file idempotent:
-- running it twice restores labels once and then changes nothing.
create function pg_temp.reverse_jsonb(p_value jsonb)
returns jsonb
language plpgsql
stable
as $fn$
declare
  v_key text;
  v_result jsonb;
begin
  if p_value is null then return null; end if;

  if jsonb_typeof(p_value) = 'array' then
    select coalesce(
             jsonb_agg(
               case
                 when jsonb_typeof(e.value) = 'string'
                   then to_jsonb(coalesce(m.name_zh, e.value #>> '{}'))
                 else e.value
               end
               order by e.ord
             ),
             '[]'::jsonb
           )
      into v_result
      from jsonb_array_elements(p_value) with ordinality as e(value, ord)
      left join pg_temp.reverse_label_map m
        on jsonb_typeof(e.value) = 'string' and m.slug = e.value #>> '{}';
    return v_result;
  end if;

  if jsonb_typeof(p_value) = 'object' then
    v_result := p_value;
    foreach v_key in array array['subcategories', 'values', 'add', 'remove'] loop
      if jsonb_exists(v_result, v_key)
         and jsonb_typeof(v_result -> v_key) = 'array' then
        v_result := jsonb_set(
          v_result, array[v_key], pg_temp.reverse_jsonb(v_result -> v_key)
        );
      end if;
    end loop;
    return v_result;
  end if;

  return p_value;
end;
$fn$;

-- 1/6 — brands.subcategories, the only surface with per-brand restorations.
with restored as (
  select id, pg_temp.reverse_brand_labels(slug, subcategories) as labels
  from public.brands
  where cardinality(subcategories) > 0
)
update public.brands b
set subcategories = r.labels
from restored r
where b.id = r.id
  and b.subcategories is distinct from r.labels;

-- 2/6 — brands.draft_data, whose keys are camelCase (`BRAND_DRAFT_EDITABLE_KEYS`,
-- src/lib/services/brands.ts:486) but whose subcategory key spells the same in
-- either convention.
update public.brands
set draft_data = pg_temp.reverse_jsonb(draft_data)
where draft_data is not null
  and draft_data is distinct from pg_temp.reverse_jsonb(draft_data);

-- 3/6 — the five brand_submissions payloads. The DEV-1503 normalizers for these
-- were dropped at 20260819090000:748-769, so nothing else rewrites them.
update public.brand_submissions
set base_brand_data = pg_temp.reverse_jsonb(base_brand_data),
    review_overrides = pg_temp.reverse_jsonb(review_overrides),
    owner_data = pg_temp.reverse_jsonb(owner_data),
    enriched_data = pg_temp.reverse_jsonb(enriched_data),
    suggested_tags = pg_temp.reverse_jsonb(suggested_tags)
where base_brand_data is distinct from pg_temp.reverse_jsonb(base_brand_data)
   or review_overrides is distinct from pg_temp.reverse_jsonb(review_overrides)
   or owner_data is distinct from pg_temp.reverse_jsonb(owner_data)
   or enriched_data is distinct from pg_temp.reverse_jsonb(enriched_data)
   or suggested_tags is distinct from pg_temp.reverse_jsonb(suggested_tags);

-- 4/6 — correction proposals. A subcategories proposal is a
-- {add: [], remove: []} delta (src/lib/services/subcategories.ts:15), not a
-- bare array, which is why reverse_jsonb walks object keys.
update public.brand_field_corrections
set proposed_value = pg_temp.reverse_jsonb(proposed_value),
    previous_value = pg_temp.reverse_jsonb(previous_value)
where field = 'subcategories'
  and (proposed_value is distinct from pg_temp.reverse_jsonb(proposed_value)
    or previous_value is distinct from pg_temp.reverse_jsonb(previous_value));

-- 5/6 — the field-event audit trail.
update public.brand_field_events
set old_value = pg_temp.reverse_jsonb(old_value),
    new_value = pg_temp.reverse_jsonb(new_value)
where field = 'subcategories'
  and (old_value is distinct from pg_temp.reverse_jsonb(old_value)
    or new_value is distinct from pg_temp.reverse_jsonb(new_value));

-- 6/6 — brand_ai_results, latest row per brand per phase only, mirroring the
-- forward backfill's scope. Historical rows keep whatever they were written
-- with; they are an audit record of what a model returned, not live data.
with latest as (
  select distinct on (brand_id, phase) id
  from public.brand_ai_results
  order by brand_id, phase, created_at desc, id desc
)
update public.brand_ai_results r
set subcategories = pg_temp.reverse_labels(r.subcategories)
from latest l
where r.id = l.id
  and cardinality(r.subcategories) > 0
  and r.subcategories is distinct from pg_temp.reverse_labels(r.subcategories);

do $ledger$
declare
  v_unreversed integer;
  v_labelled integer;
begin
  select count(*) into v_unreversed
    from public.brands b
   where exists (
     select 1
       from unnest(b.subcategories) as s(value)
       join pg_temp.reverse_label_map m on m.slug = s.value
   );
  if v_unreversed > 0 then
    raise exception 'reverse incomplete: % brands still store subcategory slugs', v_unreversed;
  end if;

  select count(*) into v_labelled
    from public.brands
   where cardinality(subcategories) > 0;
  raise notice 'slug storage reverted: % brands carry zh-TW subcategory labels', v_labelled;
end;
$ledger$;
