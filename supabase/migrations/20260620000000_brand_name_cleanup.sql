-- Brand Name Cleanup Migration
-- Generated: 2026-06-20
-- Total updates: 143
-- Purpose: Clean up scraped brand names - remove marketing copy, taglines,
-- decorative unicode, product descriptors, and normalize formatting.
--
-- Review each change carefully before running.

BEGIN;

-- 【 1002 】 → 1002 (remove decorative brackets and extra spaces)
UPDATE brands SET name = '1002', updated_at = now() WHERE id = 'd75f6091-cefb-48cc-a3fe-e8464484bdd2';

-- 【4歲以上｜基隆】漁村美味探險：飛魚卵香腸親子工坊 - 嘿路島民工作室｜Niceday... → 嘿路島民工作室 (event listing; real brand is in description and social links @halopataw)
UPDATE brands SET name = '嘿路島民工作室', updated_at = now() WHERE id = '862ce142-e909-4cc4-b419-3c2a7394373c';

-- 【PS BUBU Dog&Cat】口碑第一 萬人好評 頂級毛孩保健 → PS BUBU (remove brackets and marketing copy)
UPDATE brands SET name = 'PS BUBU', updated_at = now() WHERE id = '1a3fe18f-1952-451e-988b-162c6bb97188';

-- *𝓑𝓾𝓲𝓵𝓭.𝓛𝓲𝓰𝓱𝓽 𝓬𝓪𝓷𝓭𝓵𝓮* → Build.Light Candle (normalize stylized text, remove asterisks)
UPDATE brands SET name = 'Build.Light Candle', updated_at = now() WHERE id = '1bc28e93-3438-4a52-8cea-c8aed5c2e04f';

-- ◜ ◌ 綠洲販賣所 Oasis ​ emporium ◌◜ → 綠洲販賣所 Oasis Emporium (remove decorative unicode)
UPDATE brands SET name = '綠洲販賣所 Oasis Emporium', updated_at = now() WHERE id = '4b4ff68b-745a-4918-8dcd-3672dc05c800';

-- ☼ 椰子派•𝒄𝒐𝒄𝒐𝒏𝒖𝒕 𝒑𝒊𝒆 → 椰子派 Coconut Pie (remove sun symbol, normalize stylized text, remove bullet)
UPDATE brands SET name = '椰子派 Coconut Pie', updated_at = now() WHERE id = '6160be24-9a8a-4cc5-8d55-07dec0ed9aea';

-- 🌤️ (@tw_shoesmaker) → tw_shoesmaker (remove emoji; Instagram handle is the brand identity)
UPDATE brands SET name = 'TW Shoesmaker', updated_at = now() WHERE id = '86bb44e4-6ffe-4184-b93f-ae0917dac070';

-- 2026 居家與醫療電動床 → YOFA (description says "YOFA 名一生技", website is yofa-tech.com, social is @yofa_biotechnology; "2026" is not the brand)
UPDATE brands SET name = 'YOFA', updated_at = now() WHERE id = '6ac09a6b-89ef-4aab-b0b9-e82a14b9575a';

-- 2angels 質感矽膠嬰幼餐具 → 2angels (remove product description)
UPDATE brands SET name = '2angels', updated_at = now() WHERE id = 'ca0e5a59-5a85-4c8d-8d49-50ced6e77692';

-- 𝟒 𝐍𝐮𝐭𝐬 → 4 Nuts (normalize stylized text)
UPDATE brands SET name = '4 Nuts', updated_at = now() WHERE id = 'f5113412-3011-43d7-979a-7b1a827f288d';

-- 404Oligo  你的好菌優化師 → 404 Oligo (remove tagline; description uses "404 Oligo" with space)
UPDATE brands SET name = '404 Oligo', updated_at = now() WHERE id = '74384a49-4029-47f9-8826-f43bb7bb42c4';

-- A.MOUR 經典手工鞋 → A.MOUR (remove product description)
UPDATE brands SET name = 'A.MOUR', updated_at = now() WHERE id = '87b22b17-6b37-490a-94de-f2c1542822d2';

-- AiliN（HANDCRAFTED JEWELRY） → AiliN (remove parenthetical descriptor)
UPDATE brands SET name = 'AiliN', updated_at = now() WHERE id = '6f234f5f-78e2-4349-8a5d-cc20b34f9c3e';

-- Aquamax 面膜 → AQUAMAX (remove product descriptor "面膜"; description uses "AQUAMAX" uppercase)
UPDATE brands SET name = 'AQUAMAX', updated_at = now() WHERE id = '761dc90f-3a24-4d22-b7b6-71b2e209336e';

-- AROMASE艾瑪絲 頭皮療癒永續品牌 → AROMASE 艾瑪絲 (remove tagline)
UPDATE brands SET name = 'AROMASE 艾瑪絲', updated_at = now() WHERE id = 'aeb70f85-db7c-47c2-ad3f-354534b17bcb';

-- BoingBoing 故事鞋與童畫包 → BoingBoing (remove product description)
UPDATE brands SET name = 'BoingBoing', updated_at = now() WHERE id = 'f1991f50-9602-4aaa-9e52-2bab2dc5fbf2';

-- Bonjour女人愛買鞋 → Bonjour (remove marketing tagline "女人愛買鞋"; description uses "BONJOUR")
UPDATE brands SET name = 'Bonjour', updated_at = now() WHERE id = '419e0ad0-755f-4823-8101-9966d28232e6';

-- BOXKITTY抓板大叔MeowMie → BOXKITTY 抓板大叔 (remove "MeowMie" which appears to be a separate thing; description uses "BOXKITTY 抓板大叔")
UPDATE brands SET name = 'BOXKITTY 抓板大叔', updated_at = now() WHERE id = '93795a99-6d13-46fb-bff2-e194c459fb67';

-- Bubble-Nara → Bubble Nara (fix hyphen to space; description uses "Bubble Nara")
UPDATE brands SET name = 'Bubble-Nara', updated_at = now() WHERE id = '2280c7bd-3af3-4e25-81ea-17666fc86e65';

-- Candes_accessories → Candes Accessories (fix underscore spacing)
UPDATE brands SET name = 'Candes Accessories', updated_at = now() WHERE id = '6a316cf4-147e-4eae-a216-6e949d0c683f';

-- 𝒄𝒂𝒏𝒅𝒍𝒆 → Snowbell Handmade Candle Cake (stylized "candle" is not the real brand; description and Instagram say "Snowbell Handmade Candle Cake")
UPDATE brands SET name = 'Snowbell Handmade Candle Cake', updated_at = now() WHERE id = '05074f9e-2f0e-40e7-971a-2b079be0d45d';

-- Change Tone 襪子專賣店┃100%台灣設計製造 → Change Tone (remove store descriptor and marketing copy)
UPDATE brands SET name = 'Change Tone', updated_at = now() WHERE id = '286fac1b-ae98-4490-91c3-9b74024332fe';

-- COLORSMITH 台灣原創品包包品牌 → COLORSMITH (remove descriptor)
UPDATE brands SET name = 'COLORSMITH', updated_at = now() WHERE id = 'a291578c-0e1d-4ca6-b6f0-975654659036';

-- Dasuit大適坐墊 → Dasuit 大適 (remove product descriptor "坐墊"; add space; description uses "Dasuit 大適")
UPDATE brands SET name = 'Dasuit 大適', updated_at = now() WHERE id = 'bb34f719-28dd-43f2-8df2-ce9d42b2c46d';

-- Djulis德朱利斯 台東必買伴手禮 紅藜穀物棒  紅藜小米起司棒 紅藜黑芝麻糕 → Djulis 德朱利斯 (remove product listings)
UPDATE brands SET name = 'Djulis 德朱利斯', updated_at = now() WHERE id = '3e968b61-f0d5-4622-ba82-d18d31bc5c85';

-- DKGP 東客集 MIT 好襪專賣店 → DKGP 東客集 (remove store descriptor)
UPDATE brands SET name = 'DKGP 東客集', updated_at = now() WHERE id = 'fa6707e2-7bc6-4cd4-967f-eb2925799e34';

-- ESCURA 自然 X 機能服飾 → ESCURA (remove tagline)
UPDATE brands SET name = 'ESCURA', updated_at = now() WHERE id = 'b5e243d6-82be-4852-ae03-815064f8339c';

-- evie_drawing_daily → Evie''s Drawing Daily (normalize from IG handle format; description uses "Evie''s Drawing Daily")
UPDATE brands SET name = 'Evie''s Drawing Daily', updated_at = now() WHERE id = 'b13df19f-4e31-4334-8df3-65c18f583388';

-- Fartech翻頁鐘 → Fartech (remove product descriptor "翻頁鐘")
UPDATE brands SET name = 'Fartech', updated_at = now() WHERE id = 'adca66bb-3a9b-4a0f-91a8-8738372ffda9';

-- FuSoap 台南手工皂/訂製/小禮/代製專屬皂 → FuSoap (remove product/service listings)
UPDATE brands SET name = 'FuSoap', updated_at = now() WHERE id = 'cce67284-b55c-42a4-bd57-dcefbfbfd879';

-- FYE專賣店-法樂齊 → FYE (remove store name suffix; description uses "FYE–For Your Earth")
UPDATE brands SET name = 'FYE', updated_at = now() WHERE id = '34e796fc-a60c-409d-bf03-3d71594dc13d';

-- GO!TECHS 創意噴霧 → GO!TECHS (remove product descriptor)
UPDATE brands SET name = 'GO!TECHS', updated_at = now() WHERE id = '3c06a8b5-eb56-4de0-831e-0a5a14080de7';

-- gramonlineshop → Gram&Co. (IG handle name, not brand name; description and website say "Gram&Co.")
UPDATE brands SET name = 'Gram&Co.', updated_at = now() WHERE id = 'ea1a1abd-89e4-4199-9664-ffaab938ac9c';

-- HALFÔR 台灣機能設計襪 → HALFÔR (remove product descriptor)
UPDATE brands SET name = 'HALFÔR', updated_at = now() WHERE id = 'f2d5bec9-13a5-4cc0-9569-100b6701e167';

-- HOME → Kirameku Jewelry (generic word "HOME" is not the brand; website is kiramekujewelry.com)
UPDATE brands SET name = 'Kirameku Jewelry', updated_at = now() WHERE id = 'a8b72a25-fc7a-4964-8916-36c41850cacd';

-- Home Desyne 臺灣捷安傢飾 → Home Desyne (remove Chinese store name suffix)
UPDATE brands SET name = 'Home Desyne', updated_at = now() WHERE id = 'a0afcb4b-e8b2-4eb5-8b63-c0b12e75e779';

-- HOPMA合馬家具 → HOPMA 合馬 (remove product descriptor "家具"; add space)
UPDATE brands SET name = 'HOPMA 合馬', updated_at = now() WHERE id = '7febee06-649e-40e8-9115-f9afd333a491';

-- Horizon 台灣獨家代理 → Horizon (remove "台灣獨家代理" distributor label)
UPDATE brands SET name = 'Horizon', updated_at = now() WHERE id = 'd75f046a-4986-4d28-9330-9023a4756223';

-- I.A.N Design 史上最耐用的環保洗衣袋 → I.A.N Design (remove marketing copy)
UPDATE brands SET name = 'I.A.N Design', updated_at = now() WHERE id = 'd4c47424-83b5-4a16-a734-3a8c4ad9df08';

-- I am so good.襪金賀 → I am so good. 襪金賀 (add space between English and Chinese brand name parts)
UPDATE brands SET name = 'I am so good. 襪金賀', updated_at = now() WHERE id = '32d08d1d-b9b7-4af9-82b3-73524697bfa9';

-- I_am_Eva🌹翡翠職人 → I am Eva 翡翠職人 (remove emoji, fix underscores to spaces)
UPDATE brands SET name = 'I am Eva 翡翠職人', updated_at = now() WHERE id = '7085e12e-b198-4144-a750-8507982e6f8a';

-- JLab 台灣獨家代理 → JLab (remove "台灣獨家代理" distributor label)
UPDATE brands SET name = 'JLab', updated_at = now() WHERE id = '554e0b00-ca36-4027-b5d0-ee0288899187';

-- Jun life 手作ㅣ圍兜ㅣ平安符袋ㅣ奶嘴鍊ㅣ幼兒園夾式手帕ㅣ → Jun Life (remove product listings with Korean-style separators)
UPDATE brands SET name = 'Jun Life', updated_at = now() WHERE id = '05f8c349-78fc-4091-b494-d526043fcfda';

-- Keizu 好鞋好設計 → Keizu (remove tagline)
UPDATE brands SET name = 'Keizu', updated_at = now() WHERE id = '049bdfb7-642a-4ca8-9ecc-056b953b5521';

-- Kikō 低碳材料 → Kikō (remove product descriptor)
UPDATE brands SET name = 'Kikō', updated_at = now() WHERE id = '0bdb7b59-8b84-4a12-b00d-77b3636ef21e';

-- Funmay 手作 → Funmay (remove generic descriptor "手作")
UPDATE brands SET name = 'Funmay', updated_at = now() WHERE id = '070dccea-759c-40ca-96d2-12c32575285c';

-- Destuz健康解密坊 → Destuz 健康解密坊 (add space between English and Chinese)
UPDATE brands SET name = 'Destuz 健康解密坊', updated_at = now() WHERE id = 'a0b0f7fc-242a-4d29-8432-be2417315f22';

-- Bonbons甜點 → Bonbons (remove product descriptor "甜點"; description uses just "Bonbons")
UPDATE brands SET name = 'Bonbons', updated_at = now() WHERE id = '0bfdbe7b-2a63-483e-910f-b854fc6d179b';

-- AGAPE雅家倍 → AGAPE 雅家倍 (add space between English and Chinese; description uses "AGAPE 雅家倍")
UPDATE brands SET name = 'AGAPE 雅家倍', updated_at = now() WHERE id = '885ae28a-a05b-4499-ba6c-420f0e313427';

-- Cicala Pu 喜樂鋪手工鞋 → Cicala Pu 喜樂鋪 (remove product descriptor "手工鞋")
UPDATE brands SET name = 'Cicala Pu 喜樂鋪', updated_at = now() WHERE id = 'fca3cf2d-9011-438f-ab4c-d37cc100a113';

-- JSwood檜樂花 → JSwood 檜樂花 (add space between English and Chinese)
UPDATE brands SET name = 'JSwood 檜樂花', updated_at = now() WHERE id = 'ab8aae80-aace-4429-936b-4de958374e9f';

-- LEEDS WEATHER® 色彩個性襪子品牌 → LEEDS WEATHER (remove product tagline "色彩個性襪子品牌")
UPDATE brands SET name = 'LEEDS WEATHER', updated_at = now() WHERE id = '7339f3bf-bc38-485d-bc4c-5b5bf1ad05de';

-- LemnaAsta游離態蝦紅素🍒 → LemnaAsta (remove product descriptor "游離態蝦紅素" and emoji; IG is @lemnaasta)
UPDATE brands SET name = 'LemnaAsta', updated_at = now() WHERE id = '75685e04-329d-4564-8672-65bafe1973bd';

-- Lianne baby 梨安手工圍兜 → Lianne Baby (remove product descriptor "手工圍兜"; brand is "Lianne Baby 梨安" but "梨安" is the Chinese name — keep bilingual identity; actually IG is @liannebaby.tw and domain is liannebaby.com, so "梨安" is part of the name)
UPDATE brands SET name = 'Lianne Baby 梨安', updated_at = now() WHERE id = 'd751d035-486f-420e-abc8-7b089953c878';

-- LUCGLE ｜台灣織襪設計品牌 → LUCGLE (remove tagline "台灣織襪設計品牌" and separator)
UPDATE brands SET name = 'LUCGLE', updated_at = now() WHERE id = 'cf48b8ad-836f-4b0e-986b-bc06eab53a92';

-- LUMIRONA I 水晶×珍珠飾品 → LUMIRONA (remove product descriptor "水晶×珍珠飾品" and stray "I"; IG is @lumirona)
UPDATE brands SET name = 'LUMIRONA', updated_at = now() WHERE id = '84b028c9-2111-4d17-91ac-ce883d720b96';

-- 𝐿𝓊𝓃𝒶 ☪︎ 미스 루나露娜小姐║台中香氛蠟燭 → Luna 露娜小姐 (normalize stylized text, remove decorative unicode, remove location+product descriptor; IG is @miss_luna_candle)
UPDATE brands SET name = 'Luna 露娜小姐', updated_at = now() WHERE id = '01126ba5-37c5-476e-afc6-332b79bfaedf';

-- 𝙈𝙖𝙙𝙖𝙢 訂製珠寶・輕奢珠寶𓆝𓆜 → Madam (normalize stylized text, remove product descriptors and decorative unicode; IG is @petit.madam.acc)
UPDATE brands SET name = 'Petit Madam', updated_at = now() WHERE id = 'b4122405-d8e9-4e4a-96f5-041c533fe3f5';

-- LOTUS 瑜珈墊 → Lotus Fitness (remove product name "瑜珈墊"; description says brand is "Lotus Fitness", domain is lotusfitness.com.tw)
UPDATE brands SET name = 'Lotus Fitness', updated_at = now() WHERE id = '52993592-40a7-4c3c-ac67-4ae4cac7c42b';

-- MIT訂製 Le Gusta 品牌專區 → Le Gusta (remove "MIT訂製" prefix and "品牌專區" suffix — scraped store section title; domain is gusta.com.tw, IG is @lovelegusta)
UPDATE brands SET name = 'Le Gusta', updated_at = now() WHERE id = 'be43ba3e-a258-4dde-b47a-445d45bad02b';

-- Mypoint 尋找身心平衡 → Mypoint (remove tagline "尋找身心平衡"; domain is mypoint.com.tw)
UPDATE brands SET name = 'Mypoint', updated_at = now() WHERE id = '3c19d0fe-561b-430e-913b-89148be02b0b';

-- Natub 台灣製造天然手工皂 品牌專賣館 → Natub (remove marketing copy "台灣製造天然手工皂 品牌專賣館")
UPDATE brands SET name = 'Natub', updated_at = now() WHERE id = '5f323f0f-4dda-4c46-b350-45c5c9fbb1fc';

-- NewStar寶寶&媽咪樂活品牌 → NewStar (remove product line descriptor "寶寶&媽咪樂活品牌"; domain is newstarbaby.com.tw)
UPDATE brands SET name = 'NewStar', updated_at = now() WHERE id = '041106ea-a94f-4425-ab9c-d74cff1cf540';

-- November8 香氛 → November 8 (remove product descriptor "香氛"; domain is november8.com.tw; description says "November 8" with space)
UPDATE brands SET name = 'November 8', updated_at = now() WHERE id = '5615700e-0ca2-443a-917e-d91245492e02';

-- One Shoe 全臺唯一草編鞋專賣店 → One Shoe (remove marketing tagline "全臺唯一草編鞋專賣店")
UPDATE brands SET name = 'One Shoe', updated_at = now() WHERE id = 'ce21454a-c492-41ea-ad87-141a0d35d96d';

-- ÓLIVE 自然睡眠計劃 → ÓLIVE (remove tagline, keep accent "自然睡眠計劃"; domain is olive-mattress.com)
UPDATE brands SET name = 'ÓLIVE', updated_at = now() WHERE id = 'febc9881-4582-4cd9-a0fc-4fe74f0ddcf3';

-- Pato Pato 巧拼地墊 / 居家清潔液 → Pato Pato (remove product listing "巧拼地墊 / 居家清潔液"; domain is patopato.co)
UPDATE brands SET name = 'Pato Pato', updated_at = now() WHERE id = '6e10b594-4723-46f2-9044-3f27ff0b8824';

-- PLAYZU 歐美設計地墊 → PLAYZU (remove product descriptor "歐美設計地墊"; domain is playzu.com.tw)
UPDATE brands SET name = 'PLAYZU', updated_at = now() WHERE id = 'c13fe62a-6ab7-4e4e-b837-26f91a5364e6';

-- QMAT 設計館 → QMAT (remove "設計館" which is Pinkoi store name suffix)
UPDATE brands SET name = 'QMAT', updated_at = now() WHERE id = '1208c755-e047-4f07-8f69-2d878f1f8875';

-- RBRK Designer handbag & Accessories → RBRK (remove product descriptor "Designer handbag & Accessories"; brand is RBRK per description)
UPDATE brands SET name = 'RBRK', updated_at = now() WHERE id = 'a43feb14-4f83-4c1b-8044-4910de9a2a43';

-- Re:Nrob Lab 永續再生倡議品牌 → Re:Nrob Lab (remove tagline "永續再生倡議品牌"; domain is shop.renroblab.com)
UPDATE brands SET name = 'Re:Nrob Lab', updated_at = now() WHERE id = 'e52bb29f-c860-4fe3-bf55-d14cec42817b';

-- Robber 925 Silver 大盜飾品工作室 → Robber 925 Silver (remove Chinese descriptor "大盜飾品工作室"; domain is robber925silver.com)
UPDATE brands SET name = 'Robber 925 Silver', updated_at = now() WHERE id = '63209b39-6997-4fde-bd85-bd271ffbff21';

-- Roomix路米家，台灣鐵管收納層架工廠 → Roomix 路米家 (remove product/factory descriptor "台灣鐵管收納層架工廠" and fix comma to space; IG is @roomixtw)
UPDATE brands SET name = 'Roomix 路米家', updated_at = now() WHERE id = '72c7dd29-68d3-4298-8677-89a0f5c4495b';

-- S Pantyhose 足健美嚴選 → S Pantyhose (remove Chinese tagline "足健美嚴選")
UPDATE brands SET name = 'S Pantyhose', updated_at = now() WHERE id = '20b15285-b156-4eb9-994d-510910cfc013';

-- S Y D N N I → SYDNNI (remove decorative spacing; domain is sydnni.com, IG is @sydnni.co)
UPDATE brands SET name = 'SYDNNI', updated_at = now() WHERE id = '12e99b89-62a2-44c9-ab96-656ed348cf62';

-- SATBAKHI 膠原蛋白織造所 → SATBAKHI (remove product descriptor "膠原蛋白織造所"; domain is satbakhi.com)
UPDATE brands SET name = 'SATBAKHI', updated_at = now() WHERE id = 'acd457ad-1af0-4ad4-a7fb-571ba2587462';

-- SDN 臺灣製涼鞋 → SDN (remove product descriptor "臺灣製涼鞋"; domain is sdn.com.tw)
UPDATE brands SET name = 'SDN', updated_at = now() WHERE id = '99e0e11b-c2e9-48f6-8868-d038aedaaa01';

-- SnN溫度真皮手工鞋 → SnN (remove product descriptor "溫度真皮手工鞋"; brand name is SnN per description)
UPDATE brands SET name = 'SnN', updated_at = now() WHERE id = '302293a5-0bf4-4ea0-b7f7-b119d44fccc4';

-- sNug給足呵護 → sNug (remove tagline "給足呵護"; IG is @snugsocks)
UPDATE brands SET name = 'sNug', updated_at = now() WHERE id = '3e6bd360-290b-4762-a60f-9e37cfbe16c9';

-- SoulKind 靈感實驗室 → SoulKind (remove tagline "靈感實驗室"; domain is soulkind.com.tw)
UPDATE brands SET name = 'SoulKind', updated_at = now() WHERE id = 'bfcbfe15-4bf3-41c9-8a3f-f4c05fd12603';

-- Sudio品牌旗艦館 → Sudio (remove "品牌旗艦館" which means "brand flagship store" — scraped store title)
UPDATE brands SET name = 'Sudio', updated_at = now() WHERE id = '4c8fc87b-a78d-4a01-8c1a-ce3da50e4e26';

-- Sunday night手作寵物烘培/寵物甜點店/寵物派對零食/客制化寵物蛋糕/寵物零食 → Sunday Night (remove product listing; IG is @sunday_night0205; description confirms "Sunday Night")
UPDATE brands SET name = 'Sunday Night', updated_at = now() WHERE id = '14f0687e-6057-410d-bba0-569d177e8146';

-- SunDream｜美好飾物 → SunDream (remove tagline separator and "美好飾物"; domain is sundreamtw.com)
UPDATE brands SET name = 'SunDream', updated_at = now() WHERE id = '11fb3649-3cb4-4094-82ff-ed2f8c5223b9';

-- Tri-Aid 按摩三角 肌筋膜舒緩按摩器 澳洲品牌授權台灣代理 → Tri-Aid (remove product description and distributor info; brand name is Tri-Aid)
UPDATE brands SET name = 'Tri-Aid', updated_at = now() WHERE id = '8889e11a-5770-4b7f-9d8a-e6a62056940c';

-- MXM 專業手工具 → MXM (remove product descriptor "專業手工具"; domain is store.mxmtools.com)
UPDATE brands SET name = 'MXM', updated_at = now() WHERE id = '8760c48e-6c10-476b-9042-894f6c1e846c';

-- MIIJON宓 愛 將 製 衣 → MIIJON (remove spaced-out Chinese tagline "宓 愛 將 製 衣"; domain is Miijon.com)
UPDATE brands SET name = 'MIIJON', updated_at = now() WHERE id = '184d11bf-8342-4c91-8088-3260fe97e72a';

-- [uma hana 台灣製造防水包] → [uma hana] (remove product description "台灣製造防水包")
UPDATE brands SET name = 'uma hana', updated_at = now() WHERE id = 'e91d1165-96f0-461c-be4f-994a9e540821';

-- [VCool 專注平衡生活的養護品牌] → [VCool] (remove tagline "專注平衡生活的養護品牌")
UPDATE brands SET name = 'VCool', updated_at = now() WHERE id = 'df2bbd30-f6cd-41a0-b993-242a932cfa71';

-- [ViewFinder - 中性聯名服飾 & 圖像授權周邊] → [ViewFinder] (remove product category description)
UPDATE brands SET name = 'ViewFinder', updated_at = now() WHERE id = '29962608-f84e-4806-bc32-bdb606e79e38';

-- [zoodi (咩問題有限公司)] → [zoodi] (remove company legal name in parentheses)
UPDATE brands SET name = 'zoodi', updated_at = now() WHERE id = 'c4a919cf-fdb9-41da-924c-ab4a7206e627';

-- [Գ 川 衣 WEAR BEING Գ] → [川衣 WEAR BEING] (remove decorative Armenian letter Գ and fix spacing)
UPDATE brands SET name = '川衣 WEAR BEING', updated_at = now() WHERE id = '6597d167-7c7b-4e5a-bc98-15b8992f27ba';

-- [乙木羊鮮羊奶-台灣生態循環鮮羊奶] → [乙木羊] (remove product description; brand is "乙木羊" per description context)
UPDATE brands SET name = '乙木羊鮮羊奶', updated_at = now() WHERE id = '4d05fde2-bd62-4116-8314-36a51ca3abdc';

-- [冷研碳索館-氣體觀光工廠｜嘉義親子 DIY 手作推薦｜室內景點｜戶外教學好去處] → [冷研碳索館] (remove SEO marketing copy)
UPDATE brands SET name = '冷研碳索館', updated_at = now() WHERE id = '28790999-732e-4306-9b97-41559e0e7046';

-- [凱茲好鞋好設計] → [凱茲 KEIZU] (remove tagline "好鞋好設計"; description reveals brand is "KEIZU SHOES" / "凱茲")
UPDATE brands SET name = '凱茲', updated_at = now() WHERE id = '116649f1-1bd4-49c4-acff-d26fc65683d7';

-- [創樂子文化社企有限公司 Strong Love Culture SE Ltd.創樂子文化社企有限公司 Strong Love Culture SE Ltd.] → [創樂子 Strong Love] (duplicated full company name; clean to brand name)
UPDATE brands SET name = '創樂子 Strong Love', updated_at = now() WHERE id = '2f5d8f0c-90ba-4a7c-846c-57c73c44dcca';

-- [創設小物工作室,mydslife] → [創設小物工作室 mydslife] (replace comma with space)
UPDATE brands SET name = '創設小物工作室 mydslife', updated_at = now() WHERE id = '61d8043d-b2d5-4e3a-8d08-6c033cf82818';

-- [台灣地質公園X台灣咖啡茶運銷合作社X台灣繪本協會] → [台灣咖啡茶運銷合作社] (three orgs joined with X; the core brand is the cooperative per description context)
UPDATE brands SET name = '台灣咖啡茶運銷合作社', updated_at = now() WHERE id = 'd817cd0d-7ead-4507-9fb6-df88ebf90158';

-- [品牌故事,Darker Than Black Bags] → [Darker Than Black Bags] (remove "品牌故事," scraped page section header)
UPDATE brands SET name = 'Darker Than Black Bags', updated_at = now() WHERE id = '03369361-cb86-446d-9b79-4090439877c7';

-- [基隆委託行 ◆ 設計文創 ◆ 觀光輕旅] → [基隆委託行] (remove decorative bullets and category descriptions)
UPDATE brands SET name = '基隆委託行', updated_at = now() WHERE id = 'fd2c21c8-7e15-4cff-ab98-614a8d92f36b';

-- [基隆寵物鮮食（冷凍肉品）] → [基隆寵物鮮食] (remove parenthetical product type)
UPDATE brands SET name = '基隆寵物鮮食', updated_at = now() WHERE id = '0d67cf43-3f70-4859-816d-8b905f1491e6';

-- [塔塔藝術實驗室 - 創生夥伴介紹,台灣地方創生基金會] → [塔塔藝術實驗室] (remove scraped page breadcrumb)
UPDATE brands SET name = '塔塔藝術實驗室', updated_at = now() WHERE id = '208d9d95-6d15-4194-8932-2fbc88c4c9eb';

-- [大I獨角獸✧光棲之所] → [大I獨角獸 光棲之所] (remove decorative unicode ✧)
UPDATE brands SET name = '大I獨角獸 光棲之所', updated_at = now() WHERE id = 'dd3ba8ce-4803-45b1-b970-40e26bda6814';

-- [大山北月,森林步道 X 策展空間 X 慢活餐飲] → [大山北月] (remove marketing category descriptions)
UPDATE brands SET name = '大山北月', updated_at = now() WHERE id = '691db855-5819-421c-961e-00c384ff6af1';

-- [大自然的珠寶盒𓆝𓆟𓆜] → [大自然的珠寶盒] (remove decorative Egyptian hieroglyph unicode characters)
UPDATE brands SET name = '大自然的珠寶盒', updated_at = now() WHERE id = 'ec0bb46a-e61e-4d88-b295-15c6dc563f80';

-- [女兒不懂茶-紅烏龍專賣店] → [女兒不懂茶] (remove product descriptor "紅烏龍專賣店")
UPDATE brands SET name = '女兒不懂茶', updated_at = now() WHERE id = '3b5afe09-fa9c-4a26-a768-4b1f8f7fa584';

-- [家適居家寢飾生活館 三麗鷗授權 床包首選] → [家適居家] (remove marketing copy; description confirms brand is "家適居家")
UPDATE brands SET name = '家適居家寢飾生活館', updated_at = now() WHERE id = '988de96a-ccd4-4944-89f3-2cd218955960';

-- [小村遠遠｜台東天然香草精油與日常保養品牌] → [小村遠遠] (remove pipe-separated tagline)
UPDATE brands SET name = '小村遠遠', updated_at = now() WHERE id = '45de6c6f-b67b-451a-b531-8bcfb5e3db8f';

-- [仙湖農場 - 仙湖休閒農場] → [仙湖休閒農場] (deduplicate; "仙湖休閒農場" is the full proper name per description and social links)
UPDATE brands SET name = '仙湖休閒農場', updated_at = now() WHERE id = 'e5dc735f-5c4c-46b5-8f1f-501dab4a312a';

-- [光引 quoin．開關插座設計] → [光引 quoin] (remove product category "開關插座設計")
UPDATE brands SET name = '光引 quoin', updated_at = now() WHERE id = '4e4b9785-b846-44b9-8c59-5c37eb406a32';

-- [台灣保養品代工廠] → [頂宏生物科技] (generic description used as name; description reveals actual company is "頂宏生物科技")
UPDATE brands SET name = '頂宏生物科技', updated_at = now() WHERE id = 'd51e3466-5d7b-47fb-830e-2ae68582897e';

-- [嶼霧茶堂｜台灣茶品牌] → [嶼霧茶堂] (remove pipe-separated generic descriptor)
UPDATE brands SET name = '嶼霧茶堂', updated_at = now() WHERE id = 'c6f96e42-8820-419c-b643-41ab71452917';

-- [廣源良 - MIT] → [廣源良] (remove "- MIT" suffix; MIT is a generic label not part of brand name)
UPDATE brands SET name = '廣源良', updated_at = now() WHERE id = '8ea128e8-4b5a-49a0-a6dc-e242b8a85e85';

-- [微醺農場 種的無毒吃得健康] → [微醺農場] (remove tagline "種的無毒吃得健康")
UPDATE brands SET name = '微醺農場', updated_at = now() WHERE id = 'ef4200a6-da9d-46a0-a451-29c22d2dd7aa';

-- [媽祖埔豆腐張 - 創生夥伴介紹,台灣地方創生基金會] → [媽祖埔豆腐張] (remove scraped page breadcrumb)
UPDATE brands SET name = '媽祖埔豆腐張', updated_at = now() WHERE id = 'e3c7046a-8453-40a9-9e43-a2089080eae6';

-- [據點文創工作室 - 創生夥伴介紹,台灣地方創生基金會] → [據點文創工作室] (remove scraped page breadcrumb)
UPDATE brands SET name = '據點文創工作室', updated_at = now() WHERE id = 'c24e763a-b7cc-44b9-8fa8-0cb13a435556';

-- [大匠夫-MakerSoulHK] → [大匠夫 MakerSoulHK] (replace dash with space for proper name formatting)
UPDATE brands SET name = '大匠夫 MakerSoulHK', updated_at = now() WHERE id = 'bcf401f7-da48-44ba-8536-d2e60db33c45';

-- [愛麗絲傢俱義式復刻體驗館] → [愛麗絲傢俱] (remove "義式復刻體驗館" marketing descriptor; IG "iliz.furniture" confirms brand is just "愛麗絲傢俱")
UPDATE brands SET name = '愛麗絲傢俱', updated_at = now() WHERE id = '7de672a4-c73d-4764-9db4-43b8dcc17409';

-- 方粼 fanglinＩ手工皂 → 方粼 fanglin (remove fullwidth I and product descriptor "手工皂")
UPDATE brands SET name = '方粼 fanglin', updated_at = now() WHERE id = '69b575ed-a2e4-4c2a-9b7c-5577ac0196ba';

-- 旅學堂-淡水生活體驗平台 → 旅學堂 (remove platform descriptor)
UPDATE brands SET name = '旅學堂', updated_at = now() WHERE id = '464dd1dd-b3c6-43d7-86c1-82ec4a0ff16d';

-- 日月潭 ONELIFE → ONELIFE (日月潭 is a location, not part of the brand name; website/socials confirm ONELIFE)
UPDATE brands SET name = 'ONELIFE', updated_at = now() WHERE id = 'b8589c62-41d2-418a-a321-7892daba5830';

-- 月光下友善農場 - 創生夥伴介紹,台灣地方創生基金會 → 月光下友善農場 (remove scraped page title suffix)
UPDATE brands SET name = '月光下友善農場', updated_at = now() WHERE id = '3ee6b221-d887-430c-9035-875c56b58b07';

-- 李家蜂蜜 - 創生夥伴介紹,台灣地方創生基金會 → 李家蜂蜜 (remove scraped page title suffix)
UPDATE brands SET name = '李家蜂蜜', updated_at = now() WHERE id = '0510f74b-b104-413b-bd1c-c978d6eddc12';

-- 永旭生菜農場-生菜批發 → 永旭生菜農場 (remove business activity descriptor "生菜批發")
UPDATE brands SET name = '永旭生菜農場', updated_at = now() WHERE id = '89d6f67d-7a81-4dfa-9d25-5c73b9481624';

-- 植椛。飾 ｜封存溫柔片刻的手作飾品 → 植椛飾 (remove decorative punctuation and tagline)
UPDATE brands SET name = '植椛。飾', updated_at = now() WHERE id = '29d90034-e912-488e-8b38-8a845af75b87';

-- 植茁ᴢʜɪ ɢʀᴏᴡ → 植茁 Zhi Grow (normalize small caps to plain text)
UPDATE brands SET name = '植茁 Zhi Grow', updated_at = now() WHERE id = '1a485333-24ff-47bc-b229-c6cbc73e3afd';

-- 梨大爺🥑 → 梨大爺 (remove emoji)
UPDATE brands SET name = '梨大爺', updated_at = now() WHERE id = 'b35adb3a-ea4c-440f-9d4a-6195341185d9';

-- 梨山•福果園 → 梨山福果園 (remove decorative bullet)
UPDATE brands SET name = '梨山福果園', updated_at = now() WHERE id = '10b367dc-ed8f-41a9-89c0-6490b211d322';

-- 稜光 AURA (Aura Craft) → 稜光 AURA (remove parenthetical alias; website is aura-craft.com but brand identity is 稜光 AURA)
UPDATE brands SET name = '稜光 AURA', updated_at = now() WHERE id = 'c02e2dba-fa75-4114-88b4-596ce7de8afe';

-- 特莉莎夾「心」米餅 → 特莉莎 (remove product name "夾心米餅"; Instagram handle theresa_since2019 confirms brand is Theresa/特莉莎)
UPDATE brands SET name = '特莉莎米餅', updated_at = now() WHERE id = 'ae069516-e74c-44f8-bfda-8daa7019c8b1';

-- 福壽山順韻茶葉-618年中盛典 → 順韻茶葉 (remove location prefix and promotional event suffix; socials confirm 順韻 Shunyun Tea)
UPDATE brands SET name = '順韻茶葉', updated_at = now() WHERE id = 'c57a2bc4-0672-4e0c-adbd-f13a951624f2';

-- 福灣巧克力｜從土地到靈魂的生命至美 → 福灣巧克力 (remove tagline)
UPDATE brands SET name = '福灣巧克力', updated_at = now() WHERE id = '875eebe8-847c-44e5-abd7-17e03fe523c5';

-- 羽曦堂,頂級臺灣茶葉品牌 → 羽曦堂 (remove marketing descriptor)
UPDATE brands SET name = '羽曦堂', updated_at = now() WHERE id = '572f61ec-7615-489b-8906-8e7435c36b37';

-- 蟬說 - 漫步台灣，蟬說生活 → 蟬說 (remove tagline)
UPDATE brands SET name = '蟬說', updated_at = now() WHERE id = '1195f2c3-cfc6-4426-a54b-8e71e08f179c';

-- 転和制作所｜清水転和有機書店 → 転和制作所 (remove secondary business name)
UPDATE brands SET name = '転和制作所', updated_at = now() WHERE id = '377c35bd-7034-47c2-87f3-91a81b277c91';

-- 阿嬤的配方 腿部保養專家 → 阿嬤的配方 (remove product category descriptor)
UPDATE brands SET name = '阿嬤的配方', updated_at = now() WHERE id = 'da53ad84-ca44-4d8e-a74a-1b3af8b05313';

-- 里響咖啡RESHOCK COFFEE臺灣阿里山咖啡第一品牌 → 里響咖啡 RESHOCK COFFEE (remove marketing claim)
UPDATE brands SET name = '里響咖啡 RESHOCK COFFEE', updated_at = now() WHERE id = '702b2bdf-336e-4b8f-ba38-13dff5c3685a';

-- 金雁手作中央廚房®️ → 金雁手作 (remove ®️ emoji and "中央廚房" which is a facility type not brand name)
UPDATE brands SET name = '金雁手作', updated_at = now() WHERE id = '3128c4bf-3d7a-48bf-9595-108c64d587e8';

-- 莫蒂精品巧克力🍫 → 莫蒂精品巧克力 (remove emoji)
UPDATE brands SET name = '莫蒂精品巧克力', updated_at = now() WHERE id = '85d78b99-0ea3-4470-ae49-5c053fc17c01';

-- 颳風下雨，穿它就對！😉 → Gracile (name is a marketing slogan, not a brand name; Instagram gracile.mit reveals brand is Gracile)
UPDATE brands SET name = 'Gracile', updated_at = now() WHERE id = '6087e166-31bd-4fdd-9d74-e143c34a5418';

-- 食在美好FOODHO 質感健康飲食嚴選：機能飲品、在地美食、無添加零食、即食料理 → 食在美好 FOODHO (remove product category listing)
UPDATE brands SET name = '食在美好 FOODHO', updated_at = now() WHERE id = 'd7fb6b98-d940-4b6d-9c6e-c90e2aefc345';

-- 首頁 → JUN616XTEEN (name is scraped page title "首頁" meaning "homepage"; description/socials confirm brand is JUN616XTEEN)
UPDATE brands SET name = 'JUN616XTEEN', updated_at = now() WHERE id = '46f100b9-c241-4c17-be26-59789524ecc4';

-- 高雄市旗山區糖廠社區發展協會｜ESG環境教育遊程、旗山伴手禮、DIY體驗行程 - 首頁 → 金旗山城 (full page title scraped; description identifies the brand as 金旗山城)
UPDATE brands SET name = '金旗山城', updated_at = now() WHERE id = 'ec99cd49-d463-4176-8328-185839caaadc';

-- 花見小路・手製鞋 hanamikoji → 花見小路 hanamikoji (remove product descriptor "手製鞋" and decorative dot)
UPDATE brands SET name = '花見小路 hanamikoji', updated_at = now() WHERE id = '49a173c5-daff-43e6-aadc-b8a6be362bd0';

COMMIT;
