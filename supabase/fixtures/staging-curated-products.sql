-- Private staging only. Throwaway curation for the landing-page redesign
-- (DEV-1477), deliberately not publishable content — that is DEV-1472.
--
-- 90 products across the 30 staging fixture brands that have at least three
-- active product photos, three per brand. Every image_url is an existing
-- public brand-images object: next/image only renders *.supabase.co
-- (src/lib/images/allowed-image-hosts.ts), so a URL on a brand's own site
-- would silently fall back to the placeholder tile.
--
-- The homepage wall still shows at most two per brand and 32 tiles total; the
-- third product per brand serves brand detail pages and trails.
--
-- The image spread is intentionally uneven. Every photo was reviewed and named
-- against what it actually shows, including a sofa dimension sheet, a video
-- still, a Father's Day sale banner and a snapshot of two people holding
-- products. A hand-picked best-of set would flatter the redesign and produce
-- decisions that collapse against real supply.

with fixture(
  id, brand_id, key, name_zh, l1, official_url, image_url,
  highlight_rationale_zh, wall_position
) as (
  values
    (
      '53000000-0000-4000-8000-000000000001'::uuid,
      '51000000-0000-4000-8000-000000000002'::uuid,
      'leather-card-wallet', '手縫皮革卡夾', 'bags-accessories',
      'https://www.instagram.com/87rabbit__/',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/5080a163-7cf1-49af-8a2f-020b35190ab4/e08ea77b-9fb4-48fe-af42-f4432bed9aea.webp',
      '側邊手縫線是自己收的，邊角磨圓後不會刮到口袋。', null
    ),
    (
      '53000000-0000-4000-8000-000000000002'::uuid,
      '51000000-0000-4000-8000-000000000002'::uuid,
      'rabbit-badge-reel', '兔子造型伸縮識別證夾', 'bags-accessories',
      'https://www.instagram.com/87rabbit__/',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/5080a163-7cf1-49af-8a2f-020b35190ab4/4698d4f4-b84f-456c-8193-dda26604b15a.webp',
      '夾片可以扣在包帶上，識別證拉出來就能刷。', null
    ),
    (
      '53000000-0000-4000-8000-000000000003'::uuid,
      '51000000-0000-4000-8000-000000000002'::uuid,
      'plush-donut-squeeze', '甜甜圈造型絨毛玩偶', 'bags-accessories',
      'https://www.instagram.com/87rabbit__/',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/5080a163-7cf1-49af-8a2f-020b35190ab4/53c391af-01a6-4781-884a-8039d1af37c4.webp',
      '照片是影片截圖，捏下去的回彈比靜態照片好判斷。', null
    ),
    (
      '53000000-0000-4000-8000-000000000004'::uuid,
      '51000000-0000-4000-8000-000000000003'::uuid,
      'leather-bible-cover', '真皮聖經書套', 'bags-accessories',
      'https://www.amerryheart.co',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/4f8e39ab-07f2-400f-a436-e7fc981dd7bf/6eb2ed1d-aebf-4c41-a5df-11d5932aee23.webp',
      '書口留了緞帶書籤，封面壓字沒有做過度裝飾。', null
    ),
    (
      '53000000-0000-4000-8000-000000000005'::uuid,
      '51000000-0000-4000-8000-000000000003'::uuid,
      'wide-leg-trousers', '寬版長褲', 'bags-accessories',
      'https://www.amerryheart.co',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/4f8e39ab-07f2-400f-a436-e7fc981dd7bf/1c76d3fa-dd4a-4f0f-b88e-bc250e838ffa.webp',
      '褲長到腳踝，照片只拍下半身，方便看落地的垂墜。', null
    ),
    (
      '53000000-0000-4000-8000-000000000006'::uuid,
      '51000000-0000-4000-8000-000000000003'::uuid,
      'checked-shirt-outfit', '格紋襯衫外搭', 'bags-accessories',
      'https://www.amerryheart.co',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/4f8e39ab-07f2-400f-a436-e7fc981dd7bf/ee7fc4af-e4d6-44ac-a909-d31433c261e1.webp',
      '拍的是整套穿著比例，不是平拍，比較看得出寬鬆程度。', null
    ),
    (
      '53000000-0000-4000-8000-000000000007'::uuid,
      '51000000-0000-4000-8000-000000000004'::uuid,
      'uv-sun-sleeve-hood', '防曬袖套連帽', 'bags-accessories',
      'https://www.instagram.com/ash.island/',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/c2a45b93-6498-4ba3-9ee6-d63cdd04bc9c/b92c1cd1-4133-4591-b257-f056c054a398.webp',
      '袖套和帽子連在一起，戴上後脖子不會露出一段。', null
    ),
    (
      '53000000-0000-4000-8000-000000000008'::uuid,
      '51000000-0000-4000-8000-000000000004'::uuid,
      'illustrated-luggage-tags', '插畫行李吊牌', 'bags-accessories',
      'https://www.instagram.com/ash.island/',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/c2a45b93-6498-4ba3-9ee6-d63cdd04bc9c/6ab3de90-a720-44f4-bd44-17c75469201f.webp',
      '兩款圖案，翻面可以寫名字，照片是直接放在地板上拍的。', null
    ),
    (
      '53000000-0000-4000-8000-000000000009'::uuid,
      '51000000-0000-4000-8000-000000000004'::uuid,
      'sheer-long-sleeve-top', '印花薄長袖上衣', 'bags-accessories',
      'https://www.instagram.com/ash.island/',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/c2a45b93-6498-4ba3-9ee6-d63cdd04bc9c/531c9eae-74f9-4f57-b3da-cf442f38bc71.webp',
      '平拍照偏亮，實際顏色會比照片深一點。', null
    ),
    (
      '53000000-0000-4000-8000-000000000010'::uuid,
      '51000000-0000-4000-8000-000000000005'::uuid,
      'cleansing-tube', '洗面乳', 'beauty',
      'https://www.3triforce.com.tw',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/b2c6afc3-e99e-4a2e-aacb-51131b85de0e/5eebb0d4-d91a-4dd8-96c2-ba5763606526.webp',
      '軟管包裝，成分表印在外盒不是只寫在官網。', 7
    ),
    (
      '53000000-0000-4000-8000-000000000011'::uuid,
      '51000000-0000-4000-8000-000000000005'::uuid,
      'cleansing-oil', '卸妝油', 'beauty',
      'https://www.3triforce.com.tw',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/fd87f467-7195-4d06-b933-7d1f2493c88a/6f586845-7c43-4e13-a962-6cc9637bb983.webp',
      '按壓頭一次的量固定，用完可以看到瓶身刻度。', null
    ),
    (
      '53000000-0000-4000-8000-000000000012'::uuid,
      '51000000-0000-4000-8000-000000000005'::uuid,
      'repair-sheet-mask', '修護面膜', 'beauty',
      'https://www.3triforce.com.tw',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/fd87f467-7195-4d06-b933-7d1f2493c88a/24710c57-fe6d-4482-90cd-9c9b39ad6d14.webp',
      '單片包裝，背景全黑讓包裝上的字比較好讀。', null
    ),
    (
      '53000000-0000-4000-8000-000000000013'::uuid,
      '51000000-0000-4000-8000-000000000006'::uuid,
      'mask-box', '醫療口罩盒裝', 'beauty',
      'https://www.shop8vd.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/74f9f6a0-ef2b-4ecb-b283-ddb766e536af/3d428553-5633-4f30-bb52-f5562dedddad.webp',
      '盒上標了尺寸與片數，這張是品牌自己的行銷圖。', null
    ),
    (
      '53000000-0000-4000-8000-000000000014'::uuid,
      '51000000-0000-4000-8000-000000000006'::uuid,
      'printed-mask', '印花口罩', 'beauty',
      'https://www.shop8vd.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/44d409ea-8684-45b7-b8ef-fed9a12d0453/a9cc2257-f6e6-4fe2-98d3-5424ee80587f.webp',
      '拍的是實際戴上的樣子，右下角壓了品牌活動字樣。', null
    ),
    (
      '53000000-0000-4000-8000-000000000015'::uuid,
      '51000000-0000-4000-8000-000000000006'::uuid,
      'adult-v-mask', '成人立體口罩', 'beauty',
      'https://www.shop8vd.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/74f9f6a0-ef2b-4ecb-b283-ddb766e536af/5e35f231-a9b8-451d-a6ef-f39fd52a3986.webp',
      '橫幅圖上直接列了顏色與盒裝數量。', null
    ),
    (
      '53000000-0000-4000-8000-000000000016'::uuid,
      '51000000-0000-4000-8000-000000000007'::uuid,
      'botanical-oil', '植萃精油', 'beauty',
      'https://www.adela.tw',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/4a07d7c4-1f4a-40d0-8181-555b9972c304/9c0ed914-9f4d-47e1-b3c2-947c1e0653f1.webp',
      '合成的情境圖，瓶身標籤在原圖上看得比較清楚。', null
    ),
    (
      '53000000-0000-4000-8000-000000000017'::uuid,
      '51000000-0000-4000-8000-000000000007'::uuid,
      'body-wash-set', '沐浴組', 'beauty',
      'https://www.adela.tw',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/4a07d7c4-1f4a-40d0-8181-555b9972c304/07f5cb74-9b2d-46ba-8741-86de8c6d5ffe.webp',
      '兩瓶一組，圖上的文案佔掉了一半畫面。', null
    ),
    (
      '53000000-0000-4000-8000-000000000018'::uuid,
      '51000000-0000-4000-8000-000000000007'::uuid,
      'salon-care-set', '沙龍護理組', 'beauty',
      'https://www.adela.tw',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/4a07d7c4-1f4a-40d0-8181-555b9972c304/c81c9f3d-b875-43b0-9e50-8ecdd160dc5f.webp',
      '這張是很寬的橫幅，裁切成方形後主體會被切掉。', null
    ),
    (
      '53000000-0000-4000-8000-000000000019'::uuid,
      '51000000-0000-4000-8000-000000000008'::uuid,
      'miniature-bread-case', '迷你麵包標本盒', 'crafts',
      'https://1cmhandmade.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/be843530-20e2-44f8-a21c-413a9a66806b/92e670cb-84cf-4194-868d-c996370702e0.webp',
      '每一顆都是黏土捏的，盒子可以直接立起來。', null
    ),
    (
      '53000000-0000-4000-8000-000000000020'::uuid,
      '51000000-0000-4000-8000-000000000008'::uuid,
      'framed-bread-set', '麵包相框擺件', 'crafts',
      'https://1cmhandmade.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/be843530-20e2-44f8-a21c-413a9a66806b/0f8cdcd4-9f9c-4913-a320-844235065177.webp',
      '兩種尺寸，木框深度留給黏土立體的厚度。', null
    ),
    (
      '53000000-0000-4000-8000-000000000021'::uuid,
      '51000000-0000-4000-8000-000000000008'::uuid,
      'donut-painting-kit', '甜甜圈上色材料包', 'crafts',
      'https://1cmhandmade.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/be843530-20e2-44f8-a21c-413a9a66806b/f5144843-a810-4297-8c79-603d607eb37a.webp',
      '照片拍的是上色過程，看得出筆和顏料的實際大小。', null
    ),
    (
      '53000000-0000-4000-8000-000000000022'::uuid,
      '51000000-0000-4000-8000-000000000009'::uuid,
      'sirius-figurine', '陶製角色公仔', 'crafts',
      'https://www.instagram.com/91art.studio/',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/6b547f78-7469-43ff-bf47-16a83b680a05/35ccded8-cfd9-48e5-af75-1fcbca25d1d2.webp',
      '情境圖放在花叢裡，右上角壓了系列名稱。', null
    ),
    (
      '53000000-0000-4000-8000-000000000023'::uuid,
      '51000000-0000-4000-8000-000000000009'::uuid,
      'cloudy-figurine', '小尺寸陶偶', 'crafts',
      'https://www.instagram.com/91art.studio/',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/6b547f78-7469-43ff-bf47-16a83b680a05/32da679c-2a66-4fce-8264-1973e92488f5.webp',
      '放在桌面拍，可以對照杯子看出實際大小。', null
    ),
    (
      '53000000-0000-4000-8000-000000000024'::uuid,
      '51000000-0000-4000-8000-000000000009'::uuid,
      'sirius-branch-figurine', '陶偶枯枝版', 'crafts',
      'https://www.instagram.com/91art.studio/',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/6b547f78-7469-43ff-bf47-16a83b680a05/d768e71c-f389-492e-a018-54d21b7fc6b3.webp',
      '同一款換場景拍，焦點比另一張鬆一點。', null
    ),
    (
      '53000000-0000-4000-8000-000000000025'::uuid,
      '51000000-0000-4000-8000-000000000010'::uuid,
      'illustrated-tote', '插畫托特包', 'crafts',
      'https://www.acuiart.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/a401f742-1c41-4d9c-8a69-97fd58129665/68feae0a-1631-4546-bcb0-9eedff27518f.webp',
      '同一組插畫做成三種底色，圖是工作室自己畫的。', null
    ),
    (
      '53000000-0000-4000-8000-000000000026'::uuid,
      '51000000-0000-4000-8000-000000000010'::uuid,
      'illustrated-scarf', '插畫方巾', 'crafts',
      'https://www.acuiart.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/a401f742-1c41-4d9c-8a69-97fd58129665/a1cc0e3d-2271-4cd5-bdc2-5ec0df9db5e8.webp',
      '攤平和打結兩種拍法放在同一張圖上。', null
    ),
    (
      '53000000-0000-4000-8000-000000000027'::uuid,
      '51000000-0000-4000-8000-000000000010'::uuid,
      'felt-keyrings', '不織布鑰匙圈', 'crafts',
      'https://www.acuiart.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/a401f742-1c41-4d9c-8a69-97fd58129665/58d1303b-5913-4ab0-9b0a-99be76b8dd7f.webp',
      '手縫的小吊飾，縫線看得出來是人做的。', null
    ),
    (
      '53000000-0000-4000-8000-000000000028'::uuid,
      '51000000-0000-4000-8000-000000000011'::uuid,
      'indoor-slippers', '室內拖鞋', 'fashion',
      'https://www.2bm.com.tw',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/c30652ce-5632-4fb3-a2b4-93dfb2e625ec/33837c54-3210-41fb-b23b-424e6719f6a4.webp',
      '品牌自己的推薦圖，左上角壓了文案。', null
    ),
    (
      '53000000-0000-4000-8000-000000000029'::uuid,
      '51000000-0000-4000-8000-000000000011'::uuid,
      'flip-flop-lineup', '夾腳拖系列', 'fashion',
      'https://www.2bm.com.tw',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/801fb143-0495-48e4-89f9-5eac296a51ae/f896b1a3-0f48-4e9f-b125-269a6ecc0977.webp',
      '模特兒照和色卡拼在一起，一次看得到所有顏色。', null
    ),
    (
      '53000000-0000-4000-8000-000000000030'::uuid,
      '51000000-0000-4000-8000-000000000011'::uuid,
      'air-cushion-slippers', '氣墊拖鞋', 'fashion',
      'https://www.2bm.com.tw',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/801fb143-0495-48e4-89f9-5eac296a51ae/7cc3375c-4139-45b1-9fd7-6a662ca4d8a5.webp',
      '鞋底厚度是這款的重點，圖上用大字寫了品名。', null
    ),
    (
      '53000000-0000-4000-8000-000000000031'::uuid,
      '51000000-0000-4000-8000-000000000012'::uuid,
      'foam-clogs', '洞洞鞋', 'fashion',
      'https://www.333-slippers.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/d69c860f-0e4e-44aa-9fd8-bdbbf1b330c2/bfa9cba5-e32d-4ea2-91bc-4b39faa7b2ea.webp',
      '後帶可以翻到前面當包鞋穿。', 6
    ),
    (
      '53000000-0000-4000-8000-000000000032'::uuid,
      '51000000-0000-4000-8000-000000000012'::uuid,
      'smiley-slides', '笑臉拖鞋', 'fashion',
      'https://www.333-slippers.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/d69c860f-0e4e-44aa-9fd8-bdbbf1b330c2/78ba462a-e7fa-43d9-8b96-6c73c465b61a.webp',
      '鞋面只有一條寬帶，鞋底做了一體成型的厚度。', null
    ),
    (
      '53000000-0000-4000-8000-000000000033'::uuid,
      '51000000-0000-4000-8000-000000000012'::uuid,
      'two-strap-sandals', '雙帶涼拖', 'fashion',
      'https://www.333-slippers.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/d69c860f-0e4e-44aa-9fd8-bdbbf1b330c2/3aa7101c-befc-45ed-befa-71c06d4f9262.webp',
      '四個顏色排在一起，扣環的位置可以調。', null
    ),
    (
      '53000000-0000-4000-8000-000000000034'::uuid,
      '51000000-0000-4000-8000-000000000013'::uuid,
      'taiwan-hoodie', '台灣印花帽T', 'fashion',
      'https://en.pinkoi.com/store/7thisland',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/a6712a81-c37e-4441-9896-5f0914f436b7/2ab18eec-719b-4a07-8e12-4dc126cc5e91.webp',
      '正面印花是品牌自己設計的字體。', null
    ),
    (
      '53000000-0000-4000-8000-000000000035'::uuid,
      '51000000-0000-4000-8000-000000000013'::uuid,
      'rainbow-stripe-tote', '彩虹條紋托特包', 'fashion',
      'https://en.pinkoi.com/store/7thisland',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/a6712a81-c37e-4441-9896-5f0914f436b7/ea25dac3-42e5-476c-877f-d77ebffdca07.webp',
      '在室內隨手拍的，顏色會比實品再亮一些。', null
    ),
    (
      '53000000-0000-4000-8000-000000000036'::uuid,
      '51000000-0000-4000-8000-000000000013'::uuid,
      'red-envelope-set', '紅包袋組', 'fashion',
      'https://en.pinkoi.com/store/7thisland',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/a6712a81-c37e-4441-9896-5f0914f436b7/3ec01cb4-f022-4afd-9f95-2ce57316ea7a.webp',
      '三款圖案，攤開放在木桌上拍。', null
    ),
    (
      '53000000-0000-4000-8000-000000000037'::uuid,
      '51000000-0000-4000-8000-000000000014'::uuid,
      'outdoor-set', '戶外運動套裝', 'fitness',
      'https://nineoootwo.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/279192fe-27a2-483f-892d-221fd0493817/9d599b3f-027e-45e8-a0cc-4ccbc3bc5c8e.webp',
      '外景照，看得出布料在動作時的垂墜。', null
    ),
    (
      '53000000-0000-4000-8000-000000000038'::uuid,
      '51000000-0000-4000-8000-000000000014'::uuid,
      'skirt-set', '運動裙套裝', 'fitness',
      'https://nineoootwo.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/279192fe-27a2-483f-892d-221fd0493817/77bff721-5478-4b60-b3a6-e7f893d2f033.webp',
      '棚拍全身照，裙長與比例比較好判斷。', null
    ),
    (
      '53000000-0000-4000-8000-000000000039'::uuid,
      '51000000-0000-4000-8000-000000000014'::uuid,
      'training-set', '訓練套裝', 'fitness',
      'https://nineoootwo.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/279192fe-27a2-483f-892d-221fd0493817/e8ae3217-b02e-40bc-90df-eba617c4b7d2.webp',
      '上下身分開賣，尺寸可以各自選。', null
    ),
    (
      '53000000-0000-4000-8000-000000000040'::uuid,
      '51000000-0000-4000-8000-000000000015'::uuid,
      'protein-drink', '乳清蛋白飲', 'fitness',
      'https://tw.be-rule.com/',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/c7384f07-6d66-41d7-a523-795b72a2044d/6910bb0b-10e9-4911-8bc6-90b650461bf9.webp',
      '罐身標示容量與蛋白含量，單罐拍攝。', null
    ),
    (
      '53000000-0000-4000-8000-000000000041'::uuid,
      '51000000-0000-4000-8000-000000000015'::uuid,
      'protein-drink-campaign', '乳清蛋白飲代言版', 'fitness',
      'https://tw.be-rule.com/',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/c7384f07-6d66-41d7-a523-795b72a2044d/4397227f-f6a9-4738-85d0-9d30d3f4c18e.webp',
      '同一罐加上代言人合成圖，字比產品大。', null
    ),
    (
      '53000000-0000-4000-8000-000000000042'::uuid,
      '51000000-0000-4000-8000-000000000015'::uuid,
      'shaker-bottle', '搖搖杯', 'fitness',
      'https://tw.be-rule.com/',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/1635b40e-4015-40ba-aa37-29f56fd33f3e/f2aef84d-530c-4ac7-9239-684aec896576.webp',
      '規格直接列在圖上：材質、耐溫與防漏結構。', null
    ),
    (
      '53000000-0000-4000-8000-000000000043'::uuid,
      '51000000-0000-4000-8000-000000000016'::uuid,
      'massage-gun', '筋膜槍', 'fitness',
      'https://www.hueiyeh.com.tw/',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/18f70bdd-0333-46d8-9656-842443bbacf5/46b98e07-b70d-49de-909b-38c031abd0d7.webp',
      '單機拍攝，握把長度和槍頭大小看得出來。', null
    ),
    (
      '53000000-0000-4000-8000-000000000044'::uuid,
      '51000000-0000-4000-8000-000000000016'::uuid,
      'massage-cushion', '按摩椅墊', 'fitness',
      'https://www.hueiyeh.com.tw/',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/18f70bdd-0333-46d8-9656-842443bbacf5/226513db-fc7b-4005-9aaf-68c4188d6e9c.webp',
      '附遙控器，椅墊可以直接放在既有的椅子上。', null
    ),
    (
      '53000000-0000-4000-8000-000000000045'::uuid,
      '51000000-0000-4000-8000-000000000016'::uuid,
      'massage-pad-promo', '按摩墊檔期圖', 'fitness',
      'https://www.hueiyeh.com.tw/',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/18f70bdd-0333-46d8-9656-842443bbacf5/ddfd0c89-7d2a-4414-9227-c808b76d0938.webp',
      '這張是父親節的促銷圖，產品只佔下半部。', null
    ),
    (
      '53000000-0000-4000-8000-000000000046'::uuid,
      '51000000-0000-4000-8000-000000000018'::uuid,
      'tea-sampler', '茶葉品飲組', 'food-drink',
      'https://www.pinkoi.com/store/luyuan-tea',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/7f885efe-117d-41c9-ae98-1425c1a42492/5de4ffa9-8743-459f-9561-5b8b7b32ac4e.webp',
      '平拍加上得獎資訊拼成一張，資訊量偏多。', null
    ),
    (
      '53000000-0000-4000-8000-000000000047'::uuid,
      '51000000-0000-4000-8000-000000000018'::uuid,
      'jasmine-green-tea', '茉莉綠茶', 'food-drink',
      'https://www.pinkoi.com/store/luyuan-tea',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/7f885efe-117d-41c9-ae98-1425c1a42492/bc645a81-43d7-4a36-b76a-608fe4d799fe.webp',
      '鋁箔袋單包裝，正面印了茶種與年份。', null
    ),
    (
      '53000000-0000-4000-8000-000000000048'::uuid,
      '51000000-0000-4000-8000-000000000018'::uuid,
      'tea-gift-box', '茶葉禮盒', 'food-drink',
      'https://www.pinkoi.com/store/luyuan-tea',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/7f885efe-117d-41c9-ae98-1425c1a42492/3812e2c0-e7d1-41ed-97cc-1298fd1e988d.webp',
      '兩罐一盒，盒面是深色壓印。', 2
    ),
    (
      '53000000-0000-4000-8000-000000000049'::uuid,
      '51000000-0000-4000-8000-000000000019'::uuid,
      'seasonal-gift-set', '節慶禮盒', 'food-drink',
      'https://www.3030selection3030.com/',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/040d2355-1473-4099-881d-7d0830ddcb57/95d94dfe-222b-4766-89e8-6917655e196e.webp',
      '紅色主視覺的品牌宣傳圖。', null
    ),
    (
      '53000000-0000-4000-8000-000000000050'::uuid,
      '51000000-0000-4000-8000-000000000019'::uuid,
      'tea-canister', '茶罐與茶包', 'food-drink',
      'https://www.3030selection3030.com/',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/040d2355-1473-4099-881d-7d0830ddcb57/30142b84-d0a3-4cdf-bf8c-ec3c4b43f067.webp',
      '罐裝和單包同時賣，可以先買單包試味道。', null
    ),
    (
      '53000000-0000-4000-8000-000000000051'::uuid,
      '51000000-0000-4000-8000-000000000019'::uuid,
      'award-gift-box', '得獎禮盒', 'food-drink',
      'https://www.3030selection3030.com/',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/040d2355-1473-4099-881d-7d0830ddcb57/8ca6e6ac-68f2-4a9d-a30b-fb08900f8969.webp',
      '圖上壓了評鑑標章，開盒的內容一次看得到。', null
    ),
    (
      '53000000-0000-4000-8000-000000000052'::uuid,
      '51000000-0000-4000-8000-000000000020'::uuid,
      'cocoa-bar', '可可磚', 'food-drink',
      'https://www.404oligo.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/450231ff-a543-4e30-8778-9ec3f69bee34/cbd9d021-4f36-4815-a846-19dbba38108c.webp',
      '用可可果實排出來的情境圖，標了可可含量。', null
    ),
    (
      '53000000-0000-4000-8000-000000000053'::uuid,
      '51000000-0000-4000-8000-000000000020'::uuid,
      'cocoa-powder', '可可粉', 'food-drink',
      'https://www.404oligo.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/brands/74384a49-4029-47f9-8826-f43bb7bb42c4/3ccf9506-7b65-4430-a722-adf50c5d441d.webp',
      '深色平拍，周圍放了原料對照。', null
    ),
    (
      '53000000-0000-4000-8000-000000000054'::uuid,
      '51000000-0000-4000-8000-000000000020'::uuid,
      'cocoa-gift-set', '可可禮盒', 'food-drink',
      'https://www.404oligo.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/450231ff-a543-4e30-8778-9ec3f69bee34/3afb0fe3-2943-4245-99b2-425a0ac40c97.webp',
      '這張是活動現場的合照，產品被拿在手上。', null
    ),
    (
      '53000000-0000-4000-8000-000000000055'::uuid,
      '51000000-0000-4000-8000-000000000021'::uuid,
      'solid-wood-dining-set', '實木餐桌椅組', 'home',
      'https://1973home.myshopify.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/5935ad14-8b78-4c7a-aae4-b0021e2d8256/38080c9c-8434-4756-8bc8-1de9077c4e29.webp',
      '桌椅可以隨使用位置調整，不需要先動到固定家具。', null
    ),
    (
      '53000000-0000-4000-8000-000000000056'::uuid,
      '51000000-0000-4000-8000-000000000021'::uuid,
      'fabric-sofa', '布面沙發', 'home',
      'https://1973home.myshopify.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/5935ad14-8b78-4c7a-aae4-b0021e2d8256/731b31d1-df69-496f-b2bd-a7417ce8750f.webp',
      '淺色布面在靠窗的位置不會把光線吃掉。', 1
    ),
    (
      '53000000-0000-4000-8000-000000000057'::uuid,
      '51000000-0000-4000-8000-000000000021'::uuid,
      'sofa-dimension-sheet', '沙發尺寸圖', 'home',
      'https://1973home.myshopify.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/5935ad14-8b78-4c7a-aae4-b0021e2d8256/65155e0f-53a4-4320-9711-670a0dc9ea3d.webp',
      '這張是尺寸標示圖不是實品照，但寬度與深度標得很清楚。', null
    ),
    (
      '53000000-0000-4000-8000-000000000058'::uuid,
      '51000000-0000-4000-8000-000000000022'::uuid,
      'paper-animal-sculptures', '摺紙動物擺飾', 'home',
      'https://store.25togo.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/feb9a616-bad0-4e39-af9e-df12f08d3dbc/503c0197-0fc2-4886-88e5-676a38305d2c.webp',
      '體積小，放在座位旁的層架上不會擋到伸手的動線。', null
    ),
    (
      '53000000-0000-4000-8000-000000000059'::uuid,
      '51000000-0000-4000-8000-000000000022'::uuid,
      'hanging-scent-sachet', '香氛掛袋', 'home',
      'https://store.25togo.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/feb9a616-bad0-4e39-af9e-df12f08d3dbc/0b9ee5d3-fdc9-4a89-9dfa-61090e506967.webp',
      '可以掛在手邊，需要時再拿下來，不必固定佔一個位置。', null
    ),
    (
      '53000000-0000-4000-8000-000000000060'::uuid,
      '51000000-0000-4000-8000-000000000022'::uuid,
      'scent-tin-set', '香氛鐵盒組', 'home',
      'https://store.25togo.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/feb9a616-bad0-4e39-af9e-df12f08d3dbc/4653ef52-8db9-4382-ae68-3cfa47c98956.webp',
      '手拿的照片，鐵盒直徑大概是一個掌心。', null
    ),
    (
      '53000000-0000-4000-8000-000000000061'::uuid,
      '51000000-0000-4000-8000-000000000024'::uuid,
      'twin-rings', '對戒', 'jewelry',
      'https://5amjewelry.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/9b06cd4c-6157-47e9-942b-3dfb425b7af9/358a3cc4-9cb7-4f30-9213-4848d285e72c.webp',
      '表面保留手工痕跡，兩只的紋路不會完全一樣。', 3
    ),
    (
      '53000000-0000-4000-8000-000000000062'::uuid,
      '51000000-0000-4000-8000-000000000024'::uuid,
      'textured-ring', '紋理戒指', 'jewelry',
      'https://5amjewelry.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/9b06cd4c-6157-47e9-942b-3dfb425b7af9/d9bf01c6-7976-4f05-b1be-be37ce7cfcf4.webp',
      '黑白照拍在書頁上，看得出戒圈的起伏。', null
    ),
    (
      '53000000-0000-4000-8000-000000000063'::uuid,
      '51000000-0000-4000-8000-000000000024'::uuid,
      'hand-ring', '單只戒指', 'jewelry',
      'https://5amjewelry.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/4cd1de23-132b-4997-af6e-bb8be27be54a/491e3683-5a53-4b79-b89c-ad7e980617b4.webp',
      '線條細，疊戴時不會和其他戒指互相卡住。', null
    ),
    (
      '53000000-0000-4000-8000-000000000064'::uuid,
      '51000000-0000-4000-8000-000000000026'::uuid,
      'bark-texture-ring', '樹皮紋戒指', 'jewelry',
      'https://www.pinkoi.com/store/bobird',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/e6fe23ad-0dec-43fb-a1ab-475202d4e029/e20b4193-3422-458f-8d71-0bb833b2e067.webp',
      '戒面是不規則的鍛敲面，每只的紋路都不同。', null
    ),
    (
      '53000000-0000-4000-8000-000000000065'::uuid,
      '51000000-0000-4000-8000-000000000026'::uuid,
      'branch-ring-pair', '枝葉造型戒指', 'jewelry',
      'https://www.pinkoi.com/store/bobird',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/e6fe23ad-0dec-43fb-a1ab-475202d4e029/df7b8d17-7b8f-4937-b3a1-7f44b81de324.webp',
      '白底拍兩只，戒臂的粗細差得出來。', null
    ),
    (
      '53000000-0000-4000-8000-000000000066'::uuid,
      '51000000-0000-4000-8000-000000000026'::uuid,
      'silver-bangle-set', '銀手環系列', 'jewelry',
      'https://www.pinkoi.com/store/bobird',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/e6fe23ad-0dec-43fb-a1ab-475202d4e029/4151ea33-b4c8-4c5f-aa1c-b46bd87e8589.webp',
      '擺在漂流木上一次拍多款，單品細節會被縮小。', null
    ),
    (
      '53000000-0000-4000-8000-000000000067'::uuid,
      '51000000-0000-4000-8000-000000000028'::uuid,
      'silicone-bib', '矽膠圍兜', 'kids-pets',
      'https://2angelsbaby.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/140238ce-2187-4f08-9947-988a8104f901/2ed4cc98-b88b-4741-bcf4-d7af1399fbca.webp',
      '前方口袋是立體的，可以接住掉下來的食物。', null
    ),
    (
      '53000000-0000-4000-8000-000000000068'::uuid,
      '51000000-0000-4000-8000-000000000028'::uuid,
      'food-freezer-tray', '副食品分裝盒', 'kids-pets',
      'https://2angelsbaby.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/140238ce-2187-4f08-9947-988a8104f901/046ea1e0-cb01-42c5-98d6-6f0b5993d65d.webp',
      '分格尺寸不同，蓋子可以直接疊放。', null
    ),
    (
      '53000000-0000-4000-8000-000000000069'::uuid,
      '51000000-0000-4000-8000-000000000028'::uuid,
      'weaning-starter-set', '副食品入門組', 'kids-pets',
      'https://2angelsbaby.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/140238ce-2187-4f08-9947-988a8104f901/00899f54-a15f-4c53-ad0c-01a6ebe028c4.webp',
      '整組一次拍，包含分裝盒、餐碗與湯匙。', null
    ),
    (
      '53000000-0000-4000-8000-000000000070'::uuid,
      '51000000-0000-4000-8000-000000000029'::uuid,
      'cat-scratching-post', '貓抓柱', 'kids-pets',
      'https://www.anglewave.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/85c405dd-b615-45fa-a53c-e1c407b2c7e4/aaba7616-4f37-4f73-8d66-fd2f87569432.webp',
      '底座配重比柱身寬，貓站上去不會倒。', 5
    ),
    (
      '53000000-0000-4000-8000-000000000071'::uuid,
      '51000000-0000-4000-8000-000000000029'::uuid,
      'cat-cabinet', '貓櫃', 'kids-pets',
      'https://www.anglewave.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/85c405dd-b615-45fa-a53c-e1c407b2c7e4/a44bf62a-5457-4593-a583-8298b4ce7657.webp',
      '開孔在側面，櫃體同時是收納也是通道。', null
    ),
    (
      '53000000-0000-4000-8000-000000000072'::uuid,
      '51000000-0000-4000-8000-000000000029'::uuid,
      'cat-litter-cabinet', '貓砂櫃', 'kids-pets',
      'https://www.anglewave.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/85c405dd-b615-45fa-a53c-e1c407b2c7e4/ef3f62cb-ed26-4350-b154-12f2a9ac4d54.webp',
      '把貓砂盆收進櫃體，外觀維持一般家具的樣子。', null
    ),
    (
      '53000000-0000-4000-8000-000000000073'::uuid,
      '51000000-0000-4000-8000-000000000030'::uuid,
      'sport-sunglasses', '運動太陽眼鏡', 'outdoor',
      'https://www.aceka.com.tw',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/brands/e9cfc9a0-a1da-4ecd-8fd2-f7f56196e959/9e6d09c4-6e03-4154-ad88-1b0b24f3be3d.webp',
      '鏡片與鏡框分開更換，戶外使用時比整副替換省事。', 0
    ),
    (
      '53000000-0000-4000-8000-000000000074'::uuid,
      '51000000-0000-4000-8000-000000000030'::uuid,
      'square-sunglasses', '方框太陽眼鏡', 'outdoor',
      'https://www.aceka.com.tw',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/dea361bb-48e7-4b1e-99b2-2134f7bdf650/6a379160-27de-4bd5-98b3-01bc9d5705dd.webp',
      '白底單支拍攝，鏡腳的品牌字樣看得清楚。', null
    ),
    (
      '53000000-0000-4000-8000-000000000075'::uuid,
      '51000000-0000-4000-8000-000000000030'::uuid,
      'cycling-sunglasses', '自行車太陽眼鏡', 'outdoor',
      'https://www.aceka.com.tw',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/brands/e9cfc9a0-a1da-4ecd-8fd2-f7f56196e959/9e3a394e-a3d9-468d-981b-38df1575c62b.webp',
      '規格圖列了鼻墊、重量與抗UV等級。', null
    ),
    (
      '53000000-0000-4000-8000-000000000076'::uuid,
      '51000000-0000-4000-8000-000000000031'::uuid,
      'hooded-jacket', '連帽外套', 'outdoor',
      'https://www.easymain.com.tw',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/c128cdee-fede-44a1-8a84-9beadc340148/d0161d59-8480-4857-b2a6-ac7b55f70796.webp',
      '白底去背，帽緣與口袋位置一眼看得到。', null
    ),
    (
      '53000000-0000-4000-8000-000000000077'::uuid,
      '51000000-0000-4000-8000-000000000031'::uuid,
      'half-zip-top', '半門襟長袖上衣', 'outdoor',
      'https://www.easymain.com.tw',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/c128cdee-fede-44a1-8a84-9beadc340148/3b728d1d-307f-4cb5-81d7-cac0b7890d54.webp',
      '領口拉鍊只到胸口，套頭時不用整件解開。', null
    ),
    (
      '53000000-0000-4000-8000-000000000078'::uuid,
      '51000000-0000-4000-8000-000000000031'::uuid,
      'insulated-vest', '保暖背心', 'outdoor',
      'https://www.easymain.com.tw',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/c128cdee-fede-44a1-8a84-9beadc340148/ea9aad6e-f462-4693-91a7-86ea49a90317.webp',
      '外景照，兩款背心同時穿在身上比較厚度。', null
    ),
    (
      '53000000-0000-4000-8000-000000000079'::uuid,
      '51000000-0000-4000-8000-000000000034'::uuid,
      'wooden-stamp-set', '木頭印章組', 'stationery',
      'https://www.asteroidb610.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/c4060da5-4e4a-4478-894e-8717dc05af98/73dd349b-3021-4c55-913b-21e53906d1e0.webp',
      '一組多款圖樣，適合排版在手帳的邊緣。', 4
    ),
    (
      '53000000-0000-4000-8000-000000000080'::uuid,
      '51000000-0000-4000-8000-000000000034'::uuid,
      'stone-dish-stamp', '石皿木章', 'stationery',
      'https://www.asteroidb610.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/572d510d-fbcd-4974-9795-81170b71851b/a254305d-f06c-40e0-87de-e949b4fb5ffb.webp',
      '單顆木章，章面刻的是短句而不是圖樣。', null
    ),
    (
      '53000000-0000-4000-8000-000000000081'::uuid,
      '51000000-0000-4000-8000-000000000034'::uuid,
      'stamp-postcard-set', '印章明信片組', 'stationery',
      'https://www.asteroidb610.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/c4060da5-4e4a-4478-894e-8717dc05af98/861ff8a3-1773-4936-96cf-6a00f5d80439.webp',
      '印章和明信片一起拍，看得出蓋出來的比例。', null
    ),
    (
      '53000000-0000-4000-8000-000000000082'::uuid,
      '51000000-0000-4000-8000-000000000036'::uuid,
      'straw-tumbler', '吸管隨行杯', 'stationery',
      'https://s.shopee.tw/70FhByEaQd',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/dcf860cf-4522-4ae3-9a8c-589078d64e74/36d90c02-2a87-47b9-bbe1-ff1b941bbaa9.webp',
      '杯身透明，貼紙是可以自己換的。', null
    ),
    (
      '53000000-0000-4000-8000-000000000083'::uuid,
      '51000000-0000-4000-8000-000000000036'::uuid,
      'iced-drink-tumbler', '冷飲隨行杯', 'stationery',
      'https://s.shopee.tw/70FhByEaQd',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/dcf860cf-4522-4ae3-9a8c-589078d64e74/17dc7dbf-00dc-49d8-b951-2d1f34dd0f9c.webp',
      '手拿的照片，杯子高度大約一個手掌。', null
    ),
    (
      '53000000-0000-4000-8000-000000000084'::uuid,
      '51000000-0000-4000-8000-000000000036'::uuid,
      'tumbler-lid-set', '杯蓋配件組', 'stationery',
      'https://s.shopee.tw/70FhByEaQd',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/dcf860cf-4522-4ae3-9a8c-589078d64e74/947e0618-8a04-421e-a0de-bf1f69cb1f94.webp',
      '吸管與直飲兩種蓋子可以互換。', null
    ),
    (
      '53000000-0000-4000-8000-000000000085'::uuid,
      '51000000-0000-4000-8000-000000000039'::uuid,
      'hippo-silicone-holder', '河馬造型矽膠小物', 'tech',
      'https://hipporizz.com.tw',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/a27e67af-fd79-424c-acd6-976a99fc07fd/0311063d-6534-47e6-9471-27a365556a09.webp',
      '品牌自己的角色造型，桌面上當小擺件也站得住。', null
    ),
    (
      '53000000-0000-4000-8000-000000000086'::uuid,
      '51000000-0000-4000-8000-000000000039'::uuid,
      'wireless-charging-stand', '無線充電座', 'tech',
      'https://hipporizz.com.tw',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/a27e67af-fd79-424c-acd6-976a99fc07fd/ea50581d-adbe-4405-98f5-9b018c0f699c.webp',
      '手機立起來充電，底座同時收線。', null
    ),
    (
      '53000000-0000-4000-8000-000000000087'::uuid,
      '51000000-0000-4000-8000-000000000039'::uuid,
      'organizer-pouch', '配件收納包', 'tech',
      'https://hipporizz.com.tw',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/a27e67af-fd79-424c-acd6-976a99fc07fd/728cba3a-dd38-4edf-8be5-a108adc3ab49.webp',
      '這張是品牌橫幅圖，包身顏色比實品更飽和。', null
    ),
    (
      '53000000-0000-4000-8000-000000000088'::uuid,
      '51000000-0000-4000-8000-000000000040'::uuid,
      'phone-lanyard', '手機掛繩', 'tech',
      'https://www.overdigi.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/submissions/fbc85beb-60b0-4d21-9697-73a5f5faafc7/b71c9340-cd66-4943-b573-d7125831ceb5.webp',
      '兩種織帶寬度，扣環可以拆下換到別條繩上。', null
    ),
    (
      '53000000-0000-4000-8000-000000000089'::uuid,
      '51000000-0000-4000-8000-000000000040'::uuid,
      'lanyard-adapter', '掛繩夾片', 'tech',
      'https://www.overdigi.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/brands/49f57974-f047-4b0f-a9ad-9eb58aa861c9/65b4befe-3037-45e5-afaf-1df574bf6315.webp',
      '夾片墊在殼與機身之間，適用全包式硬殼。', null
    ),
    (
      '53000000-0000-4000-8000-000000000090'::uuid,
      '51000000-0000-4000-8000-000000000040'::uuid,
      'clear-phone-case', '透明手機殼', 'tech',
      'https://www.overdigi.com',
      'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/brands/49f57974-f047-4b0f-a9ad-9eb58aa861c9/f3cd022f-4188-41da-aa69-2c8e1df272f0.webp',
      '連同吊卡一起拍的實拍照，包裝上的型號還沒拆。', null
    )
)
insert into public.curated_products (
  id, brand_id, key, name_zh, l1, official_url, image_url, image_usage,
  lifecycle, link_state, link_checked_at, source_checked_at,
  highlight_rationale_zh, wall_position, proposed_by
)
select
  id,
  brand_id,
  key,
  name_zh,
  l1,
  official_url,
  image_url,
  'permitted',
  'published',
  'ok',
  '2026-08-16T00:00:00Z'::timestamptz,
  '2026-08-16T00:00:00Z'::timestamptz,
  highlight_rationale_zh,
  wall_position,
  'admin'
from fixture
on conflict (brand_id, key) do update set
  name_zh = excluded.name_zh,
  l1 = excluded.l1,
  official_url = excluded.official_url,
  image_url = excluded.image_url,
  image_usage = excluded.image_usage,
  lifecycle = excluded.lifecycle,
  link_state = excluded.link_state,
  link_checked_at = excluded.link_checked_at,
  source_checked_at = excluded.source_checked_at,
  highlight_rationale_zh = excluded.highlight_rationale_zh,
  wall_position = excluded.wall_position,
  proposed_by = excluded.proposed_by;

-- The homepage read embeds curated_product_sources with !inner, so a product
-- without an active source row disappears from the wall entirely.
with fixture as (
  select id as product_id, official_url
  from public.curated_products
  where id >= '53000000-0000-4000-8000-000000000001'::uuid
    and id <= '53000000-0000-4000-8000-000000000090'::uuid
)
insert into public.curated_product_sources (
  id, product_id, url, source_type, checked_at, state
)
select
  ('54000000-0000-4000-8000-' || lpad(row_number() over (order by product_id)::text, 12, '0'))::uuid,
  product_id,
  official_url,
  'official',
  '2026-08-16T00:00:00Z'::timestamptz,
  'active'
from fixture
on conflict (product_id, url) do update set
  source_type = excluded.source_type,
  checked_at = excluded.checked_at,
  state = excluded.state;

-- Trail placements exist only for the four home products, so the Discovery
-- Trail page has cards once someone flips the MDX out of draft locally. The
-- rest of the wall renders on highlight_rationale_zh alone — the selection
-- embed is non-inner.
with fixture(product_id, section_key, position, rationale_zh) as (
  values
    ('53000000-0000-4000-8000-000000000055'::uuid, 'moveable-setup', 0,
     '桌椅可以隨閱讀位置調整，不需要先動到固定家具。'),
    ('53000000-0000-4000-8000-000000000056'::uuid, 'light-first', 0,
     '淺色布面放在靠窗的位置，不會把讀書需要的光線吃掉。'),
    ('53000000-0000-4000-8000-000000000058'::uuid, 'beside-seat', 0,
     '體積小，放在座位旁的層架上不會擋到伸手的動線。'),
    ('53000000-0000-4000-8000-000000000059'::uuid, 'beside-seat', 1,
     '可以掛在手邊，需要時再拿下來，不必固定佔一個位置。')
)
insert into public.curated_product_selections (
  product_id, trail_slug, section_key, position, rationale_zh, state
)
select
  product_id,
  'small-space-reading-corner',
  section_key,
  position,
  rationale_zh,
  'active'
from fixture
on conflict (product_id, trail_slug, section_key) do update set
  position = excluded.position,
  rationale_zh = excluded.rationale_zh,
  state = excluded.state;
