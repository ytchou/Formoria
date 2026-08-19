/**
 * The use axis: 13 L1 categories carrying 175 L2 subcategories.
 *
 * This is a transitional shape, agreed in
 * `docs/decisions/2026-08-19-taxonomy-vocabulary-and-gifting-facet.md`. DEV-1510
 * splits `kids-pets` into `kids` and `pets` and admits 9 new L2s, taking 166 to
 * 175. DEV-1507 then retires `crafts` — 12 L2s leave and `illustration-and-art`
 * relocates to `home` as `wall-art`, so `175 - 12 + 1 == 164` across 12 L1s,
 * which is the end state that decision names. `crafts` is deliberately
 * untouched here: `e2e/helpers/seed.ts` and two published stories depend on it.
 *
 * A node is admitted only when at least one of Faire / Pinkoi / Ankorstore
 * carries it as a real taxonomy node AND it passes the is-a test below. Use
 * count shows that a gap exists; it never sets the shape.
 */
export const L1_CATEGORIES = [
  { slug: 'fashion', name: 'Fashion & Apparel', nameZh: '服飾鞋履', tint: 'oklch(0.935 0.022 350)' },
  { slug: 'bags-accessories', name: 'Bags & Accessories', nameZh: '包袋配件', tint: 'oklch(0.935 0.022 25)' },
  { slug: 'jewelry', name: 'Jewelry', nameZh: '飾品珠寶', tint: 'oklch(0.935 0.022 55)' },
  { slug: 'beauty', name: 'Beauty & Personal Care', nameZh: '美妝保養', tint: 'oklch(0.935 0.022 330)' },
  { slug: 'home', name: 'Home & Living', nameZh: '居家生活', tint: 'oklch(0.935 0.022 80)' },
  { slug: 'food-drink', name: 'Food & Beverage', nameZh: '食品飲料', tint: 'oklch(0.935 0.022 100)' },
  { slug: 'crafts', name: 'Crafts & Art', nameZh: '工藝文創', tint: 'oklch(0.935 0.022 140)' },
  { slug: 'stationery', name: 'Stationery & Design', nameZh: '文具設計', tint: 'oklch(0.935 0.022 200)' },
  { slug: 'tech', name: 'Tech & Electronics', nameZh: '3C科技', tint: 'oklch(0.935 0.022 240)' },
  { slug: 'outdoor', name: 'Outdoor & Camping', nameZh: '戶外露營', tint: 'oklch(0.935 0.022 160)' },
  { slug: 'fitness', name: 'Sports & Fitness', nameZh: '運動健身', tint: 'oklch(0.935 0.022 280)' },
  // Split from `kids-pets` by DEV-1510. All three reference trees keep pets out
  // of kids, and `keyword-map.yaml:414` recorded the sibling-dimension defect a
  // fortnight before this. `pets` ships `eligibility: defer-brands` — a correct
  // node held below the supply bar, not a node waiting on supply to be correct.
  { slug: 'kids', name: 'Kids & Baby', nameZh: '母嬰童', tint: 'oklch(0.935 0.022 60)' },
  { slug: 'pets', name: 'Pets', nameZh: '寵物', tint: 'oklch(0.935 0.022 300)' },
] as const

export function categoryLabel(
  item: { name: string; nameZh: string | null },
  locale: string,
): string {
  return locale === 'zh-TW' ? (item.nameZh ?? item.name) : item.name
}

/**
 * Chinese display name for an L1 category slug. Enrichment search queries
 * run against a zh-TW SERP, so the raw English slug must never leak into a
 * query string — resolve through here instead of inlining the lookup.
 */
export function categoryLabelZh(slug: string | null | undefined): string | null {
  if (!slug) return null
  return L1_CATEGORIES.find(c => c.slug === slug)?.nameZh ?? null
}

export function deriveCategoryLabel(
  categorySlug: string,
  categoryNote?: string | null,
): string | null {
  if (categorySlug) {
    return categoryLabelZh(categorySlug)
  }
  if (categoryNote?.trim()) {
    return categoryNote.trim()
  }
  return null
}

const WARM_SURFACE = 'oklch(0.963 0.004 80)'

export function categoryTint(slug: string | null | undefined): string {
  if (!slug) return WARM_SURFACE
  const match = L1_CATEGORIES.find(c => c.slug === slug)
  return match?.tint ?? WARM_SURFACE
}

// ---------------------------------------------------------------------------
// L2 Subcategories
// ---------------------------------------------------------------------------

export type L2Subcategory = {
  slug: string
  nameZh: string
  nameEn: string
  category: (typeof L1_CATEGORIES)[number]['slug']
  aliases: readonly string[]
}

/**
 * L2 admission rule: an entry must name a kind of product that is a proper
 * subset of its parent L1. Occasion, recipient, packaging format, fulfilment
 * mode, price tier, and service are not product kinds and do not qualify as
 * L2s. Crafts is the recorded technique exception: 陶瓷, 木藝, and 金工 are
 * kinds of 工藝, so technique-based entries pass the same is-a test.
 */
export const L2_SUBCATEGORIES: readonly L2Subcategory[] = [
  // fashion (16)
  { slug: 'tops-and-tshirts', nameZh: '上衣・T恤', nameEn: 'Tops & T-shirts', category: 'fashion', aliases: ['T恤', '襯衫', '帽T', 'Polo衫', '針織衫', '上衣T恤', '上衣'] },
  { slug: 'dresses', nameZh: '洋裝', nameEn: 'Dresses', category: 'fashion', aliases: ['連身裙'] },
  { slug: 'skirts', nameZh: '裙裝', nameEn: 'Skirts', category: 'fashion', aliases: [] },
  { slug: 'pants', nameZh: '褲裝', nameEn: 'Pants', category: 'fashion', aliases: ['牛仔褲', '內搭褲'] },
  { slug: 'outerwear', nameZh: '外套', nameEn: 'Outerwear', category: 'fashion', aliases: ['夾克', '防曬外套'] },
  { slug: 'underwear-and-intimates', nameZh: '貼身衣物', nameEn: 'Underwear & Intimates', category: 'fashion', aliases: ['內衣', '內褲', '塑身衣', '運動內衣'] },
  { slug: 'loungewear', nameZh: '睡衣・居家服', nameEn: 'Loungewear', category: 'fashion', aliases: ['睡衣居家服', '睡衣', '居家服'] },
  { slug: 'swimwear', nameZh: '泳裝', nameEn: 'Swimwear', category: 'fashion', aliases: [] },
  { slug: 'performance-apparel', nameZh: '機能服飾', nameEn: 'Performance Apparel', category: 'fashion', aliases: ['排汗衣', '壓力褲'] },
  { slug: 'activewear', nameZh: '運動服飾', nameEn: 'Activewear', category: 'fashion', aliases: ['瑜珈服'] },
  { slug: 'socks', nameZh: '襪子', nameEn: 'Socks', category: 'fashion', aliases: ['除臭襪', '機能襪', '隱形襪', '壓力襪'] },
  { slug: 'casual-shoes', nameZh: '休閒鞋', nameEn: 'Casual Shoes', category: 'fashion', aliases: ['小白鞋', '德訓鞋', '帆布鞋', '懶人鞋'] },
  { slug: 'leather-shoes', nameZh: '皮鞋', nameEn: 'Leather Shoes', category: 'fashion', aliases: ['樂福鞋', '牛津鞋', '德比鞋', '孟克鞋', '瑪莉珍鞋'] },
  { slug: 'heels', nameZh: '高跟鞋', nameEn: 'Heels', category: 'fashion', aliases: ['婚鞋'] },
  { slug: 'sandals-and-slippers', nameZh: '涼鞋・拖鞋', nameEn: 'Sandals & Slippers', category: 'fashion', aliases: ['涼鞋拖鞋', '涼鞋', '拖鞋', '穆勒鞋'] },
  { slug: 'boots', nameZh: '靴子', nameEn: 'Boots', category: 'fashion', aliases: ['短靴', '雨靴'] },

  // bags-accessories (27)
  { slug: 'backpacks', nameZh: '後背包', nameEn: 'Backpacks', category: 'bags-accessories', aliases: ['登山背包', '媽媽包'] },
  { slug: 'tote-bags', nameZh: '托特包', nameEn: 'Tote Bags', category: 'bags-accessories', aliases: ['帆布包'] },
  { slug: 'crossbody-bags', nameZh: '斜背包', nameEn: 'Crossbody Bags', category: 'bags-accessories', aliases: ['側背包', '斜挎包', '郵差包', '肩背包'] },
  { slug: 'handbags', nameZh: '手提包', nameEn: 'Handbags', category: 'bags-accessories', aliases: [] },
  { slug: 'clutches', nameZh: '手拿包', nameEn: 'Clutches', category: 'bags-accessories', aliases: ['晚宴包'] },
  { slug: 'clasp-frame-bags', nameZh: '口金包', nameEn: 'Clasp-Frame Bags', category: 'bags-accessories', aliases: ['口金零錢包', '口金夾'] },
  { slug: 'bucket-bags', nameZh: '水桶包', nameEn: 'Bucket Bags', category: 'bags-accessories', aliases: [] },
  // 皮帶 is the weakest mapping in the table: no `belts` node exists and the
  // admission rule bars adding one here, so the belt-worn node absorbs it.
  // Revisit if DEV-1507 admits `belts`.
  { slug: 'belt-and-sling-bags', nameZh: '腰包・胸包', nameEn: 'Belt & Sling Bags', category: 'bags-accessories', aliases: ['腰包胸包', '腰包', '胸包', '皮帶'] },
  { slug: 'eco-and-shopping-bags', nameZh: '環保袋・購物袋', nameEn: 'Eco & Shopping Bags', category: 'bags-accessories', aliases: ['環保袋購物袋', '環保袋', '購物袋', '帆布袋', '飲料提袋', '飲料提繩'] },
  { slug: 'wallets', nameZh: '皮夾・錢包', nameEn: 'Wallets', category: 'bags-accessories', aliases: ['皮夾錢包', '皮夾', '錢包', '長夾', '短夾', '中夾'] },
  { slug: 'coin-purses', nameZh: '零錢包', nameEn: 'Coin Purses', category: 'bags-accessories', aliases: [] },
  { slug: 'card-holders', nameZh: '卡夾・證件套', nameEn: 'Card Holders', category: 'bags-accessories', aliases: ['卡夾證件套', '卡夾', '證件套', '卡套'] },
  { slug: 'storage-pouches', nameZh: '收納包', nameEn: 'Storage Pouches', category: 'bags-accessories', aliases: ['旅行收納包', '束口袋'] },
  { slug: 'cosmetic-bags', nameZh: '化妝包', nameEn: 'Cosmetic Bags', category: 'bags-accessories', aliases: [] },
  { slug: 'laptop-bags', nameZh: '筆電包', nameEn: 'Laptop Bags', category: 'bags-accessories', aliases: [] },
  { slug: 'camera-bags', nameZh: '相機包', nameEn: 'Camera Bags', category: 'bags-accessories', aliases: [] },
  { slug: 'luggage-and-travel', nameZh: '行李箱・旅行袋', nameEn: 'Luggage & Travel', category: 'bags-accessories', aliases: ['行李箱旅行袋', '行李箱', '旅行袋', '旅行頸枕'] },
  { slug: 'hats', nameZh: '帽子', nameEn: 'Hats', category: 'bags-accessories', aliases: [] },
  { slug: 'scarves-and-shawls', nameZh: '圍巾・披肩', nameEn: 'Scarves & Shawls', category: 'bags-accessories', aliases: ['圍巾披肩', '圍巾', '披肩', '手帕'] },
  { slug: 'eyewear', nameZh: '眼鏡・太陽眼鏡', nameEn: 'Eyewear', category: 'bags-accessories', aliases: ['眼鏡太陽眼鏡', '眼鏡', '太陽眼鏡', '偏光', '運動太陽眼鏡'] },
  { slug: 'watches', nameZh: '手錶', nameEn: 'Watches', category: 'bags-accessories', aliases: [] },
  { slug: 'keychains', nameZh: '鑰匙圈', nameEn: 'Keychains', category: 'bags-accessories', aliases: [] },
  { slug: 'charms', nameZh: '吊飾', nameEn: 'Charms', category: 'bags-accessories', aliases: [] },
  { slug: 'phone-bags', nameZh: '手機袋', nameEn: 'Phone Bags', category: 'bags-accessories', aliases: [] },
  { slug: 'phone-straps', nameZh: '手機背帶', nameEn: 'Phone Straps', category: 'bags-accessories', aliases: ['手機掛繩', '手機吊飾'] },
  // Added 2026-08-19 (DEV-1510). `umbrellas` must never alias 雨衣 — a raincoat
  // is `pet-apparel`'s, and the two spellings sit one character apart.
  { slug: 'umbrellas', nameZh: '雨傘・陽傘', nameEn: 'Umbrellas', category: 'bags-accessories', aliases: ['雨傘', '陽傘', '折疊傘', '防風傘'] },
  { slug: 'gloves', nameZh: '手套', nameEn: 'Gloves & Mittens', category: 'bags-accessories', aliases: ['護理手套', '袖套'] },

  // jewelry (8)
  { slug: 'earrings', nameZh: '耳環', nameEn: 'Earrings', category: 'jewelry', aliases: ['耳夾'] },
  { slug: 'necklaces', nameZh: '項鍊', nameEn: 'Necklaces', category: 'jewelry', aliases: ['鎖骨鍊'] },
  { slug: 'rings', nameZh: '戒指', nameEn: 'Rings', category: 'jewelry', aliases: [] },
  { slug: 'bracelets-and-bangles', nameZh: '手鍊・手環', nameEn: 'Bracelets & Bangles', category: 'jewelry', aliases: ['手鍊手環', '手鍊', '手環'] },
  { slug: 'wedding-and-couple-rings', nameZh: '婚戒・對戒', nameEn: 'Wedding & Couple Rings', category: 'jewelry', aliases: ['婚戒對戒', '婚戒', '對戒'] },
  { slug: 'brooches', nameZh: '胸針', nameEn: 'Brooches', category: 'jewelry', aliases: ['徽章'] },
  { slug: 'hair-accessories', nameZh: '髮飾', nameEn: 'Hair Accessories', category: 'jewelry', aliases: [] },
  { slug: 'cufflinks-and-tie-clips', nameZh: '袖扣・領帶夾', nameEn: 'Cufflinks & Tie Clips', category: 'jewelry', aliases: ['袖扣'] },

  // beauty (14)
  { slug: 'handmade-soap', nameZh: '手工皂', nameEn: 'Handmade Soap', category: 'beauty', aliases: ['冷製皂', '洗顏皂'] },
  { slug: 'skincare', nameZh: '臉部保養', nameEn: 'Skincare', category: 'beauty', aliases: ['精華液', '乳液'] },
  { slug: 'face-masks', nameZh: '面膜', nameEn: 'Face Masks', category: 'beauty', aliases: [] },
  { slug: 'body-care', nameZh: '身體保養', nameEn: 'Body Care', category: 'beauty', aliases: [] },
  { slug: 'bath-and-shower', nameZh: '洗沐清潔', nameEn: 'Bath & Shower', category: 'beauty', aliases: ['沐浴乳', '洗面露'] },
  { slug: 'hair-care', nameZh: '髮品・頭皮護理', nameEn: 'Hair Care', category: 'beauty', aliases: ['髮品頭皮護理', '髮品', '頭皮護理', '洗髮精', '洗髮餅', '護髮'] },
  { slug: 'makeup', nameZh: '彩妝', nameEn: 'Makeup', category: 'beauty', aliases: ['唇膏', '底妝'] },
  { slug: 'sun-care', nameZh: '防曬', nameEn: 'Sun Care', category: 'beauty', aliases: [] },
  { slug: 'fragrance', nameZh: '香水', nameEn: 'Fragrance', category: 'beauty', aliases: [] },
  { slug: 'essential-oils-and-hydrosols', nameZh: '精油・純露', nameEn: 'Essential Oils & Hydrosols', category: 'beauty', aliases: ['精油純露', '精油', '純露'] },
  { slug: 'oral-care', nameZh: '口腔護理', nameEn: 'Oral Care', category: 'beauty', aliases: ['牙刷', '牙膏', '牙線', '漱口水', '牙間刷'] },
  { slug: 'protective-sprays', nameZh: '防蚊・止汗噴霧', nameEn: 'Protective Sprays', category: 'beauty', aliases: ['防蚊止汗噴霧', '防蚊', '止汗噴霧'] },
  { slug: 'feminine-care', nameZh: '生理用品', nameEn: 'Feminine Care', category: 'beauty', aliases: ['衛生棉', '護墊'] },
  { slug: 'beauty-tools', nameZh: '美妝工具・儀器', nameEn: 'Beauty Tools & Devices', category: 'beauty', aliases: ['美容儀器', '彩妝刷具', '鏡子'] },

  // home (27)
  { slug: 'bedding', nameZh: '寢具', nameEn: 'Bedding', category: 'home', aliases: ['床包', '涼被', '枕頭'] },
  { slug: 'mattresses', nameZh: '床墊', nameEn: 'Mattresses', category: 'home', aliases: ['乳膠墊', '獨立筒'] },
  { slug: 'furniture', nameZh: '家具', nameEn: 'Furniture', category: 'home', aliases: ['沙發', '餐桌', '書桌', '櫃', '椅', '邊桌'] },
  { slug: 'kids-furniture', nameZh: '兒童家具', nameEn: "Kids' Furniture", category: 'home', aliases: ['成長書桌', '嬰兒床'] },
  { slug: 'lighting', nameZh: '燈飾', nameEn: 'Lighting', category: 'home', aliases: ['桌燈', '夜燈'] },
  { slug: 'clocks', nameZh: '時鐘', nameEn: 'Clocks', category: 'home', aliases: ['掛鐘', '桌鐘'] },
  { slug: 'home-decor', nameZh: '居家擺飾', nameEn: 'Home Décor', category: 'home', aliases: ['壁飾', '裝飾畫', '擴香石'] },
  { slug: 'towels', nameZh: '毛巾', nameEn: 'Towels', category: 'home', aliases: ['浴巾'] },
  { slug: 'home-textiles', nameZh: '居家織品', nameEn: 'Home Textiles', category: 'home', aliases: ['抱枕', '毯', '毛毯'] },
  { slug: 'rugs-and-mats', nameZh: '地墊・地毯', nameEn: 'Rugs & Mats', category: 'home', aliases: ['地墊地毯', '地墊', '地毯'] },
  { slug: 'tableware', nameZh: '餐具', nameEn: 'Tableware', category: 'home', aliases: ['筷子', '碗盤', '杯墊', '玻璃杯盤'] },
  { slug: 'tea-and-coffee-ware', nameZh: '茶具・咖啡器具', nameEn: 'Tea & Coffee Ware', category: 'home', aliases: ['茶具咖啡器具', '茶具', '咖啡器具', '品茗杯'] },
  { slug: 'cookware', nameZh: '鍋具', nameEn: 'Cookware', category: 'home', aliases: [] },
  { slug: 'tumblers-and-bottles', nameZh: '隨行杯・保溫瓶', nameEn: 'Tumblers & Bottles', category: 'home', aliases: ['隨行杯保溫瓶', '隨行杯', '保溫瓶', '保溫杯', '水壺'] },
  { slug: 'reusable-utensils-and-straws', nameZh: '環保餐具・吸管', nameEn: 'Reusable Utensils & Straws', category: 'home', aliases: ['環保餐具吸管', '環保餐具', '吸管'] },
  { slug: 'storage', nameZh: '收納用品', nameEn: 'Storage', category: 'home', aliases: ['收納盒', '置物架', '衣架'] },
  { slug: 'cleaning', nameZh: '清潔用品', nameEn: 'Cleaning', category: 'home', aliases: ['抹布', '清潔液', '居家清潔', '洗衣用品', '洗衣清潔用品', '洗衣精', '蔬果清潔用品', '清潔刷'] },
  { slug: 'home-appliances', nameZh: '生活家電', nameEn: 'Home Appliances', category: 'home', aliases: ['吸塵器', '吊扇', '空氣清淨機'] },
  { slug: 'home-fragrance', nameZh: '居家香氛', nameEn: 'Home Fragrance', category: 'home', aliases: ['線香', '擴香', '香氛袋', '擴香瓶', '盤香', '香粉', '香道具'] },
  { slug: 'candles', nameZh: '蠟燭', nameEn: 'Candles', category: 'home', aliases: [] },
  { slug: 'floral-arrangements', nameZh: '花藝', nameEn: 'Floral Arrangements', category: 'home', aliases: [] },
  { slug: 'plants', nameZh: '植栽', nameEn: 'Plants', category: 'home', aliases: ['盆栽', '多肉園藝'] },
  { slug: 'curtains', nameZh: '窗簾', nameEn: 'Curtains', category: 'home', aliases: [] },
  { slug: 'bath-accessories', nameZh: '衛浴用品', nameEn: 'Bath Accessories', category: 'home', aliases: [] },
  { slug: 'hand-tools', nameZh: '手工具', nameEn: 'Hand Tools', category: 'home', aliases: ['起子', '扳手', '剪刀'] },
  // Added 2026-08-19 (DEV-1510). `pest-control` must never alias 防蚊 — that is
  // `protective-sprays`' and the overlap is one character wide.
  { slug: 'pest-control', nameZh: '防蟲用品', nameEn: 'Pest Control', category: 'home', aliases: ['除蟲用品', '環境用藥'] },
  // Not `toys`: a display figure is decor a collector buys for themselves, and
  // Pinkoi files 公仔/玩偶 under 居家生活, not under 玩具.
  { slug: 'figurines-and-plush', nameZh: '公仔・玩偶', nameEn: 'Figurines & Plush', category: 'home', aliases: ['公仔', '絨毛玩偶', '抱枕娃娃', '磁吸娃娃', '羊毛氈公仔', '模型擺飾'] },

  // food-drink (20)
  { slug: 'tea', nameZh: '茶葉', nameEn: 'Tea', category: 'food-drink', aliases: ['烏龍茶', '紅茶', '高山茶'] },
  { slug: 'tea-bags', nameZh: '茶包', nameEn: 'Tea Bags', category: 'food-drink', aliases: [] },
  { slug: 'tea-drinks', nameZh: '茶飲', nameEn: 'Tea Drinks', category: 'food-drink', aliases: ['冷泡茶'] },
  { slug: 'coffee', nameZh: '咖啡', nameEn: 'Coffee', category: 'food-drink', aliases: ['咖啡豆', '濾掛'] },
  { slug: 'chocolate-and-cacao', nameZh: '巧克力・可可', nameEn: 'Chocolate & Cacao', category: 'food-drink', aliases: ['巧克力可可', '巧克力', '可可'] },
  { slug: 'honey', nameZh: '蜂蜜', nameEn: 'Honey', category: 'food-drink', aliases: [] },
  { slug: 'jams-and-spreads', nameZh: '果醬・抹醬', nameEn: 'Jams & Spreads', category: 'food-drink', aliases: ['果醬抹醬', '果醬', '抹醬', '堅果醬'] },
  { slug: 'desserts-and-pastries', nameZh: '甜點・糕點', nameEn: 'Desserts & Pastries', category: 'food-drink', aliases: ['甜點糕點', '甜點', '糕點', '蛋糕', '塔', '布丁', '麵包', '可麗露', '蛋黃酥'] },
  { slug: 'cookies-and-rice-crackers', nameZh: '餅乾・米餅', nameEn: 'Cookies & Rice Crackers', category: 'food-drink', aliases: ['餅乾米餅', '餅乾', '米餅', '米香', '蛋捲'] },
  { slug: 'snacks', nameZh: '零食', nameEn: 'Snacks', category: 'food-drink', aliases: ['堅果'] },
  { slug: 'dried-fruits', nameZh: '果乾', nameEn: 'Dried Fruits', category: 'food-drink', aliases: [] },
  { slug: 'rice-and-grains', nameZh: '米・雜糧', nameEn: 'Rice & Grains', category: 'food-drink', aliases: ['米雜糧', '米', '雜糧', '糙米', '紅藜'] },
  { slug: 'fresh-produce', nameZh: '生鮮蔬果', nameEn: 'Fresh Produce', category: 'food-drink', aliases: [] },
  { slug: 'dairy', nameZh: '乳製品', nameEn: 'Dairy', category: 'food-drink', aliases: ['鮮乳', '優格', '乳酪'] },
  { slug: 'milk-powder', nameZh: '奶粉', nameEn: 'Milk Powder', category: 'food-drink', aliases: [] },
  { slug: 'alcohol', nameZh: '酒類', nameEn: 'Alcohol', category: 'food-drink', aliases: ['氣泡酒', '清酒'] },
  { slug: 'beverages', nameZh: '飲品', nameEn: 'Beverages', category: 'food-drink', aliases: ['果汁', '康普茶'] },
  { slug: 'seasonings-and-sauces', nameZh: '調味料・醬料', nameEn: 'Seasonings & Sauces', category: 'food-drink', aliases: ['調味料醬料', '調味料', '醬料', '味噌', '醋'] },
  { slug: 'ready-meals', nameZh: '料理包・加工食品', nameEn: 'Ready Meals', category: 'food-drink', aliases: ['料理包加工食品', '料理包', '加工食品'] },
  { slug: 'supplements', nameZh: '保健食品', nameEn: 'Supplements', category: 'food-drink', aliases: ['益生菌', '膠囊', '機能食品'] },

  // crafts (12)
  { slug: 'ceramics', nameZh: '陶瓷・陶藝', nameEn: 'Ceramics', category: 'crafts', aliases: ['陶瓷陶藝', '陶瓷', '陶藝'] },
  { slug: 'woodcraft', nameZh: '木藝・木作', nameEn: 'Woodcraft', category: 'crafts', aliases: ['木藝木作', '木藝', '木作', '檜木製品'] },
  { slug: 'metalwork', nameZh: '金工', nameEn: 'Metalwork', category: 'crafts', aliases: [] },
  { slug: 'bamboo-craft', nameZh: '竹編・竹藝', nameEn: 'Bamboo Craft', category: 'crafts', aliases: ['竹編竹藝', '竹編', '竹藝'] },
  { slug: 'glass-art', nameZh: '玻璃・琉璃', nameEn: 'Glass Art', category: 'crafts', aliases: ['玻璃琉璃', '玻璃', '琉璃'] },
  { slug: 'natural-dyeing', nameZh: '藍染・植物染', nameEn: 'Natural Dyeing', category: 'crafts', aliases: ['藍染植物染', '藍染', '植物染', '手染'] },
  { slug: 'leather-craft', nameZh: '皮革工藝', nameEn: 'Leather Craft', category: 'crafts', aliases: ['手工皮件'] },
  { slug: 'embroidery', nameZh: '刺繡', nameEn: 'Embroidery', category: 'crafts', aliases: [] },
  { slug: 'needle-felting', nameZh: '羊毛氈', nameEn: 'Needle Felting', category: 'crafts', aliases: [] },
  { slug: 'weaving-and-crochet', nameZh: '編織・鉤織', nameEn: 'Weaving & Crochet', category: 'crafts', aliases: ['編織鉤織', '編織', '鉤織'] },
  { slug: 'illustration-and-art', nameZh: '插畫・畫作', nameEn: 'Illustration & Art', category: 'crafts', aliases: ['插畫畫作', '插畫', '畫作', '水彩', '版畫', '無框畫'] },
  { slug: 'dried-flowers-and-floral-design', nameZh: '乾燥花・花藝設計', nameEn: 'Dried Flowers & Floral Design', category: 'crafts', aliases: ['乾燥花花藝設計', '乾燥花', '花藝設計'] },

  // stationery (12)
  { slug: 'journals-and-notebooks', nameZh: '手帳・筆記本', nameEn: 'Journals & Notebooks', category: 'stationery', aliases: ['手帳筆記本', '手帳', '筆記本'] },
  { slug: 'washi-tape', nameZh: '紙膠帶', nameEn: 'Washi Tape', category: 'stationery', aliases: [] },
  { slug: 'stickers', nameZh: '貼紙', nameEn: 'Stickers', category: 'stationery', aliases: [] },
  { slug: 'stamps-and-seals', nameZh: '印章', nameEn: 'Stamps & Seals', category: 'stationery', aliases: [] },
  { slug: 'cards-and-postcards', nameZh: '卡片・明信片', nameEn: 'Cards & Postcards', category: 'stationery', aliases: ['卡片明信片', '卡片', '明信片'] },
  { slug: 'pens-and-writing', nameZh: '筆具', nameEn: 'Pens & Writing', category: 'stationery', aliases: [] },
  { slug: 'calendars', nameZh: '月曆・日曆', nameEn: 'Calendars', category: 'stationery', aliases: ['月曆日曆', '月曆', '日曆', '萬年曆'] },
  { slug: 'desk-mats', nameZh: '桌墊', nameEn: 'Desk Mats', category: 'stationery', aliases: ['切割墊'] },
  { slug: 'paper-goods', nameZh: '紙品', nameEn: 'Paper Goods', category: 'stationery', aliases: [] },
  { slug: 'desk-organization', nameZh: '文具收納', nameEn: 'Desk Organization', category: 'stationery', aliases: ['桌面配件'] },
  // Added 2026-08-19 (DEV-1510).
  { slug: 'bookmarks', nameZh: '書籤', nameEn: 'Bookmarks', category: 'stationery', aliases: [] },
  { slug: 'craft-kits-and-supplies', nameZh: '手作材料・工具', nameEn: 'Craft Kits & Supplies', category: 'stationery', aliases: ['DIY材料包', '創作工具', '布料'] },

  // tech (11)
  { slug: 'phone-cases', nameZh: '手機殼', nameEn: 'Phone Cases', category: 'tech', aliases: ['防摔殼'] },
  { slug: 'device-sleeves', nameZh: '保護套・皮套', nameEn: 'Device Sleeves', category: 'tech', aliases: ['保護套皮套', '保護套', '皮套'] },
  { slug: 'chargers-and-cables', nameZh: '充電器・充電線', nameEn: 'Chargers & Cables', category: 'tech', aliases: ['充電器充電線', '充電器', '充電線', '快充頭', '氮化鎵'] },
  { slug: 'power-banks', nameZh: '行動電源', nameEn: 'Power Banks', category: 'tech', aliases: [] },
  { slug: 'wireless-charging', nameZh: '無線充電', nameEn: 'Wireless Charging', category: 'tech', aliases: ['磁吸', 'MagSafe'] },
  // The zero use count here was an alias gap, not a node gap — the four
  // spellings below are how the catalogue actually writes 耳機.
  { slug: 'earphones-and-headphones', nameZh: '耳機', nameEn: 'Earphones & Headphones', category: 'tech', aliases: ['藍牙耳機', '骨傳導', '真無線藍牙耳機', '降噪耳機', '兒童耳機', '開放式耳罩耳機'] },
  { slug: 'speakers', nameZh: '藍牙喇叭', nameEn: 'Speakers', category: 'tech', aliases: [] },
  { slug: 'stands-and-mounts', nameZh: '支架', nameEn: 'Stands & Mounts', category: 'tech', aliases: [] },
  { slug: 'storage-devices', nameZh: '儲存裝置', nameEn: 'Storage Devices', category: 'tech', aliases: ['隨身碟', '記憶卡'] },
  // Added 2026-08-11: both labels were already stored on brands but unregistered,
  // so they rendered no facet. Additive only — heals existing orphans, creates none.
  { slug: 'security-cameras', nameZh: '攝影機', nameEn: 'Security Cameras', category: 'tech', aliases: ['監視器', '網路攝影機', '雲端攝影機', '監控攝影機'] },
  { slug: 'smart-doorbells', nameZh: '智慧門鈴', nameEn: 'Smart Doorbells', category: 'tech', aliases: ['門鈴', '視訊門鈴'] },

  // outdoor (6)
  { slug: 'hiking-and-camping-gear', nameZh: '登山・露營用品', nameEn: 'Hiking & Camping Gear', category: 'outdoor', aliases: ['登山露營用品', '登山', '露營用品', '露營燈'] },
  { slug: 'picnic-supplies', nameZh: '野餐用品', nameEn: 'Picnic Supplies', category: 'outdoor', aliases: ['野餐墊'] },
  { slug: 'wetsuits-and-water-sports', nameZh: '防寒衣・水上運動', nameEn: 'Wetsuits & Water Sports', category: 'outdoor', aliases: ['防寒衣水上運動', '防寒衣', '水上運動', '潛水'] },
  { slug: 'cycling-and-riding', nameZh: '自行車・騎士用品', nameEn: 'Cycling & Riding', category: 'outdoor', aliases: ['自行車騎士用品', '自行車', '騎士用品', '騎士服'] },
  { slug: 'helmets', nameZh: '安全帽', nameEn: 'Helmets', category: 'outdoor', aliases: [] },
  { slug: 'outdoor-accessories', nameZh: '戶外配件', nameEn: 'Outdoor Accessories', category: 'outdoor', aliases: [] },

  // fitness (5)
  { slug: 'yoga-gear', nameZh: '瑜珈用品', nameEn: 'Yoga Gear', category: 'fitness', aliases: ['瑜珈墊', '磚', '環'] },
  { slug: 'fitness-equipment', nameZh: '健身器材', nameEn: 'Fitness Equipment', category: 'fitness', aliases: ['彈力帶', '筋膜球', '超慢跑墊'] },
  { slug: 'massage-and-recovery', nameZh: '按摩・放鬆', nameEn: 'Massage & Recovery', category: 'fitness', aliases: ['按摩放鬆', '按摩', '放鬆', '按摩槍', '滾筒'] },
  { slug: 'protective-gear', nameZh: '護具', nameEn: 'Protective Gear', category: 'fitness', aliases: [] },
  { slug: 'care-and-mobility-aids', nameZh: '照護輔具', nameEn: 'Care & Mobility Aids', category: 'fitness', aliases: ['輪椅', '助行器', '電動床'] },

  // kids (10) — split from kids-pets by DEV-1510
  { slug: 'kids-clothing', nameZh: '童裝', nameEn: "Kids' Clothing", category: 'kids', aliases: ['童鞋', '童褲'] },
  { slug: 'family-matching', nameZh: '親子裝', nameEn: 'Family Matching', category: 'kids', aliases: [] },
  { slug: 'baby-clothing', nameZh: '嬰幼兒服飾', nameEn: 'Baby Clothing', category: 'kids', aliases: ['包屁衣', '紗布衣'] },
  { slug: 'baby-bedding', nameZh: '嬰幼兒寢具', nameEn: 'Baby Bedding', category: 'kids', aliases: ['防踢被', '洞洞毯'] },
  { slug: 'bibs-and-muslin', nameZh: '圍兜・紗布巾', nameEn: 'Bibs & Muslin', category: 'kids', aliases: ['圍兜紗布巾', '圍兜', '紗布巾', '口水巾', '安撫巾'] },
  { slug: 'kids-tableware', nameZh: '兒童餐具', nameEn: "Kids' Tableware", category: 'kids', aliases: ['學習湯匙', '吸盤碗'] },
  { slug: 'toys', nameZh: '玩具', nameEn: 'Toys', category: 'kids', aliases: ['布偶', '益智玩具'] },
  { slug: 'learning-aids', nameZh: '教具', nameEn: 'Learning Aids', category: 'kids', aliases: [] },
  { slug: 'play-mats-and-fences', nameZh: '遊戲地墊・圍欄', nameEn: 'Play Mats & Fences', category: 'kids', aliases: ['遊戲地墊圍欄', '遊戲地墊', '圍欄'] },
  { slug: 'parenting-essentials', nameZh: '育兒用品', nameEn: 'Parenting Essentials', category: 'kids', aliases: ['濕紙巾'] },

  // pets (7) — split from kids-pets by DEV-1510; ships eligibility: defer-brands
  { slug: 'pet-food', nameZh: '寵物食品', nameEn: 'Pet Food', category: 'pets', aliases: ['鮮食', '主食罐', '飼料'] },
  { slug: 'pet-treats', nameZh: '寵物零食', nameEn: 'Pet Treats', category: 'pets', aliases: ['肉泥'] },
  { slug: 'pet-supplements', nameZh: '寵物保健', nameEn: 'Pet Supplements', category: 'pets', aliases: [] },
  { slug: 'pet-apparel', nameZh: '寵物服飾・配件', nameEn: 'Pet Apparel', category: 'pets', aliases: ['寵物服飾配件', '寵物服飾', '配件', '項圈', '牽繩', '雨衣'] },
  { slug: 'pet-beds-and-scratchers', nameZh: '貓抓板・寵物床窩', nameEn: 'Pet Beds & Scratchers', category: 'pets', aliases: ['貓抓板寵物床窩', '貓抓板', '寵物床窩', '貓屋'] },
  { slug: 'pet-grooming', nameZh: '寵物清潔・美容', nameEn: 'Pet Grooming', category: 'pets', aliases: ['寵物清潔美容', '寵物清潔', '美容', '沐浴露', '貓砂'] },
  { slug: 'pet-supplies', nameZh: '寵物生活用品', nameEn: 'Pet Supplies', category: 'pets', aliases: ['食器', '寵物玩具'] },
]

// ---------------------------------------------------------------------------
// Material axis
// ---------------------------------------------------------------------------

/**
 * The third axis cuts on material — what the object is made of — and closes at
 * 12 terms. This list is the CHECK constraint DEV-1502 deferred on
 * `brands.material` and `curated_products.material`.
 *
 * Technique is deliberately not modelled. A 藍染 scarf is technique 藍染 and
 * material 織品; only the second is stored, and 藍染 collapses into 織品. That
 * is an accepted cost — a technique axis must clear the
 * `2026-08-07-secondary-taxonomy-axes.md` bar first, and no ticket, supply
 * evidence or demand evidence exists for one.
 *
 * 紙, 石, 藤 and 漆 carry zero production evidence and are in the vocabulary
 * anyway: the CHECK is cheapest to widen now, while every row is still an
 * empty array. Render them only where the count is above zero.
 */
export const MATERIALS = [
  '陶瓷',
  '木',
  '織品',
  '玻璃',
  '金屬',
  '竹',
  '羊毛',
  '皮革',
  '紙',
  '石',
  '藤',
  '漆',
] as const

export type Material = (typeof MATERIALS)[number]

/**
 * The single matching basis for subcategory strings: NFKC (collapses full-width Latin),
 * middle-dot strip, trim, lowercase, whitespace collapse. Exported because
 * callers that store subcategories the ontology does NOT know (novel correction subcategories)
 * still have to dedupe them the way `matchSubcategory` would have, or 'Vegan'
 * and 'vegan' become two distinct subcategories for one concept.
 */
export function normalizeSubcategoryKey(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/・/g, '') // strip katakana middle dot (U+30FB ・)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/**
 * Labels the vocabulary deliberately drops. They are a **separate set from
 * aliases and must stay that way**: adding `食品禮盒` to a node's `aliases`
 * resurrects the label the closure exists to remove, and the L2 screen in
 * `ontology.test.ts` reads `nameZh` only — nothing else would catch it.
 *
 * Membership means the backfill deletes the value rather than failing on it.
 * That distinction is the whole point: a label resolving to nothing is
 * otherwise indistinguishable from one meant to be evicted.
 *
 * Sources: `docs/decisions/2026-08-19-taxonomy-vocabulary-and-gifting-facet.md`
 * (decisions 5 and 8) and the 57-row residual table at
 * `docs/reports/2026-08-19-label-resolution-table.csv`.
 *
 * `體驗課程・DIY材料` is here as the **default** disposition, not the whole
 * story: 24 of its 34 uses drop and 10 named brands are re-tagged by hand to
 * `craft-kits-and-supplies`. That triage is per-brand work in the backfill, not
 * a mapping-table entry — which is exactly why it is not an alias.
 */
export const EVICTED_LABELS = [
  // Occasion, recipient and packaging — decision 8, no facet at any level.
  '食品禮盒',
  '客製化禮品',
  '彌月禮盒',
  '盲包',
  '禮盒',
  '文具禮盒',
  '模型禮盒',
  // Service — decision 5's 體驗課程 half.
  '體驗課程・DIY材料',
  // L1 names and L1-level generics used as L2s.
  '文具',
  '文具用品',
  '服飾',
  '服飾配件',
  '包包',
  '居家生活',
  '飾品珠寶',
  '個人護理',
  '手機配件',
  '旅行用品',
  '防護用品',
  '鞋子',
  '珍珠飾品',
  // Material descriptor — belongs on the material axis, not the use axis.
  '織物',
  // Marketing string, not a product kind.
  '虱目魚鱗胜肽服飾',
  // Real product kinds with no admissible node. Each one costs a brand its
  // only tag or close to it; see the zero-subcategory table in
  // `docs/decisions/2026-08-19-cross-l1-read-fix-and-slug-migration-scope.md`.
  '樂器',
  '止滑墊',
  '口罩',
  '保護貼',
  '高爾夫球桿套',
] as const

/**
 * Labels whose brands leave the directory — decision 7. Distinct from
 * `EVICTED_LABELS` because the outcome is different: an evicted label loses a
 * tag, an out-of-frame label loses the brand. `蟬說-漫步台灣-蟬說生活` reaching
 * zero subcategories through 民宿住宿 + 自然景觀體驗 is the intended result, not
 * a defect the backfill should report.
 */
export const OUT_OF_FRAME_LABELS = [
  '石材',
  '天花板材料',
  '工業用布',
  '居家修繕服務',
  '民宿住宿',
  '自然景觀體驗',
  '字型',
  '字體授權',
  '字型教育',
  '茶會製作',
  'SUP體驗',
  '自力造筏',
  '單車遊湖',
  '淨潭淨山活動',
] as const

/**
 * Labels retired by the DEV-1361 split. They remain explicit deny-list values
 * rather than aliases: an old middle-dot or compact spelling must not come
 * back as a novel subcategory after the atomic replacements are installed.
 */
export const RETIRED_COMPOSITE_LABELS = [
  '香氛・蠟燭',
  '鑰匙圈・吊飾',
  '收納包・化妝包',
  '茶包・茶飲',
  '玩具・教具',
  '花藝・植栽',
  '毛巾・生活織品',
  '手機袋・手機背帶',
] as const

const RETIRED_COMPOSITE_KEYS = new Set(
  RETIRED_COMPOSITE_LABELS.map((label) => normalizeSubcategoryKey(label)),
)

export function isRetiredCompositeLabel(input: string): boolean {
  return RETIRED_COMPOSITE_KEYS.has(normalizeSubcategoryKey(input))
}

/**
 * A composite subcategory bundles two concepts behind one label, joined by the
 * katakana middle dot (U+30FB ・) that `normalizeSubcategoryKey` strips. This module owns
 * the separator, so it owns the predicate too: callers that hand-rolled
 * `nameZh.includes('・')` drifted into two spellings of the same codepoint across
 * two files.
 */
export function isCompositeSubcategory(subcategory: { nameZh: string }): boolean {
  return subcategory.nameZh.includes('・')
}

const _subcategoryMap = new Map<string, L2Subcategory>()
for (const sub of L2_SUBCATEGORIES) {
  for (const key of [sub.nameZh, sub.nameEn, ...sub.aliases]) {
    _subcategoryMap.set(normalizeSubcategoryKey(key), sub)
  }
}

export function matchSubcategory(input: string): L2Subcategory | null {
  const key = normalizeSubcategoryKey(input)
  if (!key) return null
  return _subcategoryMap.get(key) ?? null
}

let _subcategorySlugMap: Map<string, L2Subcategory> | null = null

function _getSubcategorySlugMap(): Map<string, L2Subcategory> {
  if (!_subcategorySlugMap) {
    _subcategorySlugMap = new Map(L2_SUBCATEGORIES.map((sub) => [sub.slug, sub]))
  }
  return _subcategorySlugMap
}

export function subcategoryBySlug(slug: string): L2Subcategory | null {
  return _getSubcategorySlugMap().get(slug) ?? null
}

export function resolveSubcategorySlugs(
  categorySlug: string | null,
  slugs: string[],
): L2Subcategory[] {
  if (!categorySlug || slugs.length === 0) return []

  const seen = new Set<string>()
  const subcategories: L2Subcategory[] = []
  for (const slug of slugs) {
    if (seen.has(slug)) continue
    seen.add(slug)

    const subcategory = subcategoryBySlug(slug)
    if (subcategory?.category === categorySlug) subcategories.push(subcategory)
  }
  return subcategories
}

export function subcategoryLabel(sub: L2Subcategory, locale: string): string {
  return locale === 'zh-TW' ? sub.nameZh : sub.nameEn
}
