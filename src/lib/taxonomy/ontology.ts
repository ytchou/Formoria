export const PRODUCT_TYPE_CATEGORIES = [
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
  { slug: 'kids-pets', name: 'Kids, Baby & Pets', nameZh: '母嬰寵物', tint: 'oklch(0.935 0.022 60)' },
] as const

export function categoryLabel(
  item: { name: string; nameZh: string | null },
  locale: string,
): string {
  return locale === 'zh-TW' ? (item.nameZh ?? item.name) : item.name
}

export function deriveCategoryFromProductType(
  productType: string,
  productTypeNote?: string | null,
): string | null {
  if (productType) {
    const match = PRODUCT_TYPE_CATEGORIES.find(c => c.slug === productType)
    return match?.nameZh ?? null
  }
  if (productTypeNote?.trim()) {
    return productTypeNote.trim()
  }
  return null
}

const WARM_SURFACE = 'oklch(0.963 0.004 80)'

export function categoryTint(slug: string | null | undefined): string {
  if (!slug) return WARM_SURFACE
  const match = PRODUCT_TYPE_CATEGORIES.find(c => c.slug === slug)
  return match?.tint ?? WARM_SURFACE
}

// ---------------------------------------------------------------------------
// L2 Product Subcategories
// ---------------------------------------------------------------------------

export type ProductSubcategory = {
  slug: string
  nameZh: string
  nameEn: string
  category: (typeof PRODUCT_TYPE_CATEGORIES)[number]['slug']
  aliases: readonly string[]
}

export const PRODUCT_SUBCATEGORIES: readonly ProductSubcategory[] = [
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
  { slug: 'boots', nameZh: '靴子', nameEn: 'Boots', category: 'fashion', aliases: ['短靴'] },

  // bags-accessories (22)
  { slug: 'backpacks', nameZh: '後背包', nameEn: 'Backpacks', category: 'bags-accessories', aliases: ['登山背包', '媽媽包'] },
  { slug: 'tote-bags', nameZh: '托特包', nameEn: 'Tote Bags', category: 'bags-accessories', aliases: [] },
  { slug: 'crossbody-bags', nameZh: '斜背包', nameEn: 'Crossbody Bags', category: 'bags-accessories', aliases: ['側背包', '斜挎包', '郵差包'] },
  { slug: 'handbags', nameZh: '手提包', nameEn: 'Handbags', category: 'bags-accessories', aliases: [] },
  { slug: 'clutches', nameZh: '手拿包', nameEn: 'Clutches', category: 'bags-accessories', aliases: ['晚宴包'] },
  { slug: 'clasp-frame-bags', nameZh: '口金包', nameEn: 'Clasp-Frame Bags', category: 'bags-accessories', aliases: ['口金零錢包', '口金夾'] },
  { slug: 'bucket-bags', nameZh: '水桶包', nameEn: 'Bucket Bags', category: 'bags-accessories', aliases: [] },
  { slug: 'belt-and-sling-bags', nameZh: '腰包・胸包', nameEn: 'Belt & Sling Bags', category: 'bags-accessories', aliases: ['腰包胸包', '腰包', '胸包'] },
  { slug: 'eco-and-shopping-bags', nameZh: '環保袋・購物袋', nameEn: 'Eco & Shopping Bags', category: 'bags-accessories', aliases: ['環保袋購物袋', '環保袋', '購物袋', '帆布袋', '飲料提袋'] },
  { slug: 'wallets', nameZh: '皮夾・錢包', nameEn: 'Wallets', category: 'bags-accessories', aliases: ['皮夾錢包', '皮夾', '錢包', '長夾', '短夾', '中夾'] },
  { slug: 'coin-purses', nameZh: '零錢包', nameEn: 'Coin Purses', category: 'bags-accessories', aliases: [] },
  { slug: 'card-holders', nameZh: '卡夾・證件套', nameEn: 'Card Holders', category: 'bags-accessories', aliases: ['卡夾證件套', '卡夾', '證件套'] },
  { slug: 'pouches', nameZh: '收納包・化妝包', nameEn: 'Pouches', category: 'bags-accessories', aliases: ['收納包化妝包', '收納包', '化妝包', '旅行收納包'] },
  { slug: 'laptop-bags', nameZh: '筆電包', nameEn: 'Laptop Bags', category: 'bags-accessories', aliases: [] },
  { slug: 'camera-bags', nameZh: '相機包', nameEn: 'Camera Bags', category: 'bags-accessories', aliases: [] },
  { slug: 'luggage-and-travel', nameZh: '行李箱・旅行袋', nameEn: 'Luggage & Travel', category: 'bags-accessories', aliases: ['行李箱旅行袋', '行李箱', '旅行袋'] },
  { slug: 'hats', nameZh: '帽子', nameEn: 'Hats', category: 'bags-accessories', aliases: [] },
  { slug: 'scarves-and-shawls', nameZh: '圍巾・披肩', nameEn: 'Scarves & Shawls', category: 'bags-accessories', aliases: ['圍巾披肩', '圍巾', '披肩'] },
  { slug: 'eyewear', nameZh: '眼鏡・太陽眼鏡', nameEn: 'Eyewear', category: 'bags-accessories', aliases: ['眼鏡太陽眼鏡', '眼鏡', '太陽眼鏡', '偏光', '運動太陽眼鏡'] },
  { slug: 'watches', nameZh: '手錶', nameEn: 'Watches', category: 'bags-accessories', aliases: [] },
  { slug: 'keychains-and-charms', nameZh: '鑰匙圈・吊飾', nameEn: 'Keychains & Charms', category: 'bags-accessories', aliases: ['鑰匙圈吊飾', '鑰匙圈', '吊飾'] },
  { slug: 'phone-bags-and-straps', nameZh: '手機袋・手機背帶', nameEn: 'Phone Bags & Straps', category: 'bags-accessories', aliases: ['手機袋手機背帶', '手機袋', '手機背帶'] },

  // jewelry (7)
  { slug: 'earrings', nameZh: '耳環', nameEn: 'Earrings', category: 'jewelry', aliases: ['耳夾'] },
  { slug: 'necklaces', nameZh: '項鍊', nameEn: 'Necklaces', category: 'jewelry', aliases: ['鎖骨鍊'] },
  { slug: 'rings', nameZh: '戒指', nameEn: 'Rings', category: 'jewelry', aliases: [] },
  { slug: 'bracelets-and-bangles', nameZh: '手鍊・手環', nameEn: 'Bracelets & Bangles', category: 'jewelry', aliases: ['手鍊手環', '手鍊', '手環'] },
  { slug: 'wedding-and-couple-rings', nameZh: '婚戒・對戒', nameEn: 'Wedding & Couple Rings', category: 'jewelry', aliases: ['婚戒對戒', '婚戒', '對戒'] },
  { slug: 'brooches', nameZh: '胸針', nameEn: 'Brooches', category: 'jewelry', aliases: [] },
  { slug: 'hair-accessories', nameZh: '髮飾', nameEn: 'Hair Accessories', category: 'jewelry', aliases: [] },

  // beauty (13)
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
  { slug: 'supplements', nameZh: '保健食品', nameEn: 'Supplements', category: 'beauty', aliases: ['益生菌', '膠囊', '機能食品'] },
  { slug: 'oral-care', nameZh: '口腔護理', nameEn: 'Oral Care', category: 'beauty', aliases: [] },
  { slug: 'protective-sprays', nameZh: '防蚊・止汗噴霧', nameEn: 'Protective Sprays', category: 'beauty', aliases: ['防蚊止汗噴霧', '防蚊', '止汗噴霧'] },

  // home (22 in list; spec header says 23 — see deviations note)
  { slug: 'bedding', nameZh: '寢具', nameEn: 'Bedding', category: 'home', aliases: ['床包', '涼被', '枕頭'] },
  { slug: 'mattresses', nameZh: '床墊', nameEn: 'Mattresses', category: 'home', aliases: ['乳膠墊', '獨立筒'] },
  { slug: 'furniture', nameZh: '家具', nameEn: 'Furniture', category: 'home', aliases: ['沙發', '餐桌', '書桌', '櫃', '椅'] },
  { slug: 'kids-furniture', nameZh: '兒童家具', nameEn: "Kids' Furniture", category: 'home', aliases: ['成長書桌'] },
  { slug: 'lighting', nameZh: '燈飾', nameEn: 'Lighting', category: 'home', aliases: ['桌燈', '夜燈'] },
  { slug: 'clocks', nameZh: '時鐘', nameEn: 'Clocks', category: 'home', aliases: ['掛鐘', '桌鐘'] },
  { slug: 'home-decor', nameZh: '居家擺飾', nameEn: 'Home Décor', category: 'home', aliases: ['壁飾', '裝飾畫', '擴香石'] },
  { slug: 'towels-and-textiles', nameZh: '毛巾・生活織品', nameEn: 'Towels & Textiles', category: 'home', aliases: ['毛巾生活織品', '毛巾', '生活織品', '浴巾', '抱枕', '毯'] },
  { slug: 'rugs-and-mats', nameZh: '地墊・地毯', nameEn: 'Rugs & Mats', category: 'home', aliases: ['地墊地毯', '地墊', '地毯'] },
  { slug: 'tableware', nameZh: '餐具', nameEn: 'Tableware', category: 'home', aliases: ['筷子', '碗盤'] },
  { slug: 'tea-and-coffee-ware', nameZh: '茶具・咖啡器具', nameEn: 'Tea & Coffee Ware', category: 'home', aliases: ['茶具咖啡器具', '茶具', '咖啡器具', '品茗杯'] },
  { slug: 'cookware', nameZh: '鍋具', nameEn: 'Cookware', category: 'home', aliases: [] },
  { slug: 'tumblers-and-bottles', nameZh: '隨行杯・保溫瓶', nameEn: 'Tumblers & Bottles', category: 'home', aliases: ['隨行杯保溫瓶', '隨行杯', '保溫瓶', '保溫杯', '水壺'] },
  { slug: 'reusable-utensils-and-straws', nameZh: '環保餐具・吸管', nameEn: 'Reusable Utensils & Straws', category: 'home', aliases: ['環保餐具吸管', '環保餐具', '吸管'] },
  { slug: 'storage', nameZh: '收納用品', nameEn: 'Storage', category: 'home', aliases: ['收納盒', '置物架', '衣架'] },
  { slug: 'cleaning', nameZh: '清潔用品', nameEn: 'Cleaning', category: 'home', aliases: ['抹布', '清潔液'] },
  { slug: 'home-appliances', nameZh: '生活家電', nameEn: 'Home Appliances', category: 'home', aliases: ['吸塵器', '吊扇', '空氣清淨機'] },
  { slug: 'home-fragrance-and-candles', nameZh: '香氛・蠟燭', nameEn: 'Home Fragrance & Candles', category: 'home', aliases: ['香氛蠟燭', '香氛', '蠟燭', '線香', '擴香', '香氛袋'] },
  { slug: 'floral-and-plants', nameZh: '花藝・植栽', nameEn: 'Floral & Plants', category: 'home', aliases: ['花藝植栽', '花藝', '植栽', '花器', '盆栽'] },
  { slug: 'curtains', nameZh: '窗簾', nameEn: 'Curtains', category: 'home', aliases: [] },
  { slug: 'bath-accessories', nameZh: '衛浴用品', nameEn: 'Bath Accessories', category: 'home', aliases: [] },
  { slug: 'care-and-mobility-aids', nameZh: '照護輔具', nameEn: 'Care & Mobility Aids', category: 'home', aliases: ['輪椅', '助行器', '電動床'] },

  // food-drink (19)
  { slug: 'tea', nameZh: '茶葉', nameEn: 'Tea', category: 'food-drink', aliases: ['烏龍茶', '紅茶', '高山茶'] },
  { slug: 'tea-bags-and-drinks', nameZh: '茶包・茶飲', nameEn: 'Tea Bags & Drinks', category: 'food-drink', aliases: ['茶包茶飲', '茶包', '茶飲', '冷泡茶', '花草茶'] },
  { slug: 'coffee', nameZh: '咖啡', nameEn: 'Coffee', category: 'food-drink', aliases: ['咖啡豆', '濾掛'] },
  { slug: 'chocolate-and-cacao', nameZh: '巧克力・可可', nameEn: 'Chocolate & Cacao', category: 'food-drink', aliases: ['巧克力可可', '巧克力', '可可'] },
  { slug: 'honey', nameZh: '蜂蜜', nameEn: 'Honey', category: 'food-drink', aliases: [] },
  { slug: 'jams-and-spreads', nameZh: '果醬・抹醬', nameEn: 'Jams & Spreads', category: 'food-drink', aliases: ['果醬抹醬', '果醬', '抹醬', '堅果醬'] },
  { slug: 'desserts-and-pastries', nameZh: '甜點・糕點', nameEn: 'Desserts & Pastries', category: 'food-drink', aliases: ['甜點糕點', '甜點', '糕點', '蛋糕', '塔', '布丁'] },
  { slug: 'cookies-and-rice-crackers', nameZh: '餅乾・米餅', nameEn: 'Cookies & Rice Crackers', category: 'food-drink', aliases: ['餅乾米餅', '餅乾', '米餅', '米香', '蛋捲'] },
  { slug: 'snacks', nameZh: '零食', nameEn: 'Snacks', category: 'food-drink', aliases: [] },
  { slug: 'dried-fruits', nameZh: '果乾', nameEn: 'Dried Fruits', category: 'food-drink', aliases: [] },
  { slug: 'rice-and-grains', nameZh: '米・雜糧', nameEn: 'Rice & Grains', category: 'food-drink', aliases: ['米雜糧', '米', '雜糧', '糙米', '紅藜'] },
  { slug: 'fresh-produce', nameZh: '生鮮蔬果', nameEn: 'Fresh Produce', category: 'food-drink', aliases: [] },
  { slug: 'dairy', nameZh: '乳製品', nameEn: 'Dairy', category: 'food-drink', aliases: ['鮮乳', '優格', '乳酪'] },
  { slug: 'milk-powder', nameZh: '奶粉', nameEn: 'Milk Powder', category: 'food-drink', aliases: [] },
  { slug: 'alcohol', nameZh: '酒類', nameEn: 'Alcohol', category: 'food-drink', aliases: ['氣泡酒', '清酒'] },
  { slug: 'beverages', nameZh: '飲品', nameEn: 'Beverages', category: 'food-drink', aliases: ['果汁', '康普茶'] },
  { slug: 'seasonings-and-sauces', nameZh: '調味料・醬料', nameEn: 'Seasonings & Sauces', category: 'food-drink', aliases: ['調味料醬料', '調味料', '醬料', '味噌', '醋'] },
  { slug: 'ready-meals', nameZh: '料理包・加工食品', nameEn: 'Ready Meals', category: 'food-drink', aliases: ['料理包加工食品', '料理包', '加工食品'] },
  { slug: 'gift-boxes', nameZh: '食品禮盒', nameEn: 'Gift Boxes', category: 'food-drink', aliases: ['伴手禮'] },

  // crafts (14)
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
  { slug: 'custom-gifts', nameZh: '客製化禮品', nameEn: 'Custom Gifts', category: 'crafts', aliases: ['企業禮品'] },
  { slug: 'workshops-and-diy-kits', nameZh: '體驗課程・DIY材料', nameEn: 'Workshops & DIY Kits', category: 'crafts', aliases: ['體驗課程DIY材料', '體驗課程', 'DIY材料', '手作課程', '材料包'] },

  // stationery (10)
  { slug: 'journals-and-notebooks', nameZh: '手帳・筆記本', nameEn: 'Journals & Notebooks', category: 'stationery', aliases: ['手帳筆記本', '手帳', '筆記本'] },
  { slug: 'washi-tape', nameZh: '紙膠帶', nameEn: 'Washi Tape', category: 'stationery', aliases: [] },
  { slug: 'stickers', nameZh: '貼紙', nameEn: 'Stickers', category: 'stationery', aliases: [] },
  { slug: 'stamps-and-seals', nameZh: '印章', nameEn: 'Stamps & Seals', category: 'stationery', aliases: [] },
  { slug: 'cards-and-postcards', nameZh: '卡片・明信片', nameEn: 'Cards & Postcards', category: 'stationery', aliases: ['卡片明信片', '卡片', '明信片'] },
  { slug: 'pens-and-writing', nameZh: '筆具', nameEn: 'Pens & Writing', category: 'stationery', aliases: [] },
  { slug: 'calendars', nameZh: '月曆・日曆', nameEn: 'Calendars', category: 'stationery', aliases: ['月曆日曆', '月曆', '日曆'] },
  { slug: 'desk-mats', nameZh: '桌墊', nameEn: 'Desk Mats', category: 'stationery', aliases: ['切割墊'] },
  { slug: 'paper-goods', nameZh: '紙品', nameEn: 'Paper Goods', category: 'stationery', aliases: [] },
  { slug: 'desk-organization', nameZh: '文具收納', nameEn: 'Desk Organization', category: 'stationery', aliases: [] },

  // tech (10)
  { slug: 'phone-cases', nameZh: '手機殼', nameEn: 'Phone Cases', category: 'tech', aliases: ['防摔殼'] },
  { slug: 'device-sleeves', nameZh: '保護套・皮套', nameEn: 'Device Sleeves', category: 'tech', aliases: ['保護套皮套', '保護套', '皮套'] },
  { slug: 'chargers-and-cables', nameZh: '充電器・充電線', nameEn: 'Chargers & Cables', category: 'tech', aliases: ['充電器充電線', '充電器', '充電線', '快充頭', '氮化鎵'] },
  { slug: 'power-banks', nameZh: '行動電源', nameEn: 'Power Banks', category: 'tech', aliases: [] },
  { slug: 'wireless-charging', nameZh: '無線充電', nameEn: 'Wireless Charging', category: 'tech', aliases: ['磁吸', 'MagSafe'] },
  { slug: 'earphones-and-headphones', nameZh: '耳機', nameEn: 'Earphones & Headphones', category: 'tech', aliases: ['藍牙耳機', '骨傳導'] },
  { slug: 'speakers', nameZh: '藍牙喇叭', nameEn: 'Speakers', category: 'tech', aliases: [] },
  { slug: 'stands-and-mounts', nameZh: '支架', nameEn: 'Stands & Mounts', category: 'tech', aliases: [] },
  { slug: 'storage-devices', nameZh: '儲存裝置', nameEn: 'Storage Devices', category: 'tech', aliases: ['隨身碟', '記憶卡'] },
  { slug: 'hand-tools', nameZh: '手工具', nameEn: 'Hand Tools', category: 'tech', aliases: ['起子', '扳手'] },

  // outdoor (6)
  { slug: 'hiking-and-camping-gear', nameZh: '登山・露營用品', nameEn: 'Hiking & Camping Gear', category: 'outdoor', aliases: ['登山露營用品', '登山', '露營用品', '露營燈'] },
  { slug: 'picnic-supplies', nameZh: '野餐用品', nameEn: 'Picnic Supplies', category: 'outdoor', aliases: ['野餐墊'] },
  { slug: 'wetsuits-and-water-sports', nameZh: '防寒衣・水上運動', nameEn: 'Wetsuits & Water Sports', category: 'outdoor', aliases: ['防寒衣水上運動', '防寒衣', '水上運動', '潛水'] },
  { slug: 'cycling-and-riding', nameZh: '自行車・騎士用品', nameEn: 'Cycling & Riding', category: 'outdoor', aliases: ['自行車騎士用品', '自行車', '騎士用品', '騎士服'] },
  { slug: 'helmets', nameZh: '安全帽', nameEn: 'Helmets', category: 'outdoor', aliases: [] },
  { slug: 'outdoor-accessories', nameZh: '戶外配件', nameEn: 'Outdoor Accessories', category: 'outdoor', aliases: [] },

  // fitness (4)
  { slug: 'yoga-gear', nameZh: '瑜珈用品', nameEn: 'Yoga Gear', category: 'fitness', aliases: ['瑜珈墊', '磚', '環'] },
  { slug: 'fitness-equipment', nameZh: '健身器材', nameEn: 'Fitness Equipment', category: 'fitness', aliases: ['彈力帶', '筋膜球', '超慢跑墊'] },
  { slug: 'massage-and-recovery', nameZh: '按摩・放鬆', nameEn: 'Massage & Recovery', category: 'fitness', aliases: ['按摩放鬆', '按摩', '放鬆', '按摩槍', '滾筒'] },
  { slug: 'protective-gear', nameZh: '護具', nameEn: 'Protective Gear', category: 'fitness', aliases: [] },

  // kids-pets (17)
  { slug: 'kids-clothing', nameZh: '童裝', nameEn: "Kids' Clothing", category: 'kids-pets', aliases: ['童鞋'] },
  { slug: 'family-matching', nameZh: '親子裝', nameEn: 'Family Matching', category: 'kids-pets', aliases: [] },
  { slug: 'baby-clothing', nameZh: '嬰幼兒服飾', nameEn: 'Baby Clothing', category: 'kids-pets', aliases: ['包屁衣', '紗布衣'] },
  { slug: 'baby-bedding', nameZh: '嬰幼兒寢具', nameEn: 'Baby Bedding', category: 'kids-pets', aliases: ['防踢被', '洞洞毯'] },
  { slug: 'bibs-and-muslin', nameZh: '圍兜・紗布巾', nameEn: 'Bibs & Muslin', category: 'kids-pets', aliases: ['圍兜紗布巾', '圍兜', '紗布巾', '口水巾', '安撫巾'] },
  { slug: 'baby-gift-sets', nameZh: '彌月禮盒', nameEn: 'Baby Gift Sets', category: 'kids-pets', aliases: [] },
  { slug: 'kids-tableware', nameZh: '兒童餐具', nameEn: "Kids' Tableware", category: 'kids-pets', aliases: ['學習湯匙', '吸盤碗'] },
  { slug: 'toys-and-learning', nameZh: '玩具・教具', nameEn: 'Toys & Learning', category: 'kids-pets', aliases: ['玩具教具', '玩具', '教具', '布偶', '益智玩具'] },
  { slug: 'play-mats-and-fences', nameZh: '遊戲地墊・圍欄', nameEn: 'Play Mats & Fences', category: 'kids-pets', aliases: ['遊戲地墊圍欄', '遊戲地墊', '圍欄'] },
  { slug: 'parenting-essentials', nameZh: '育兒用品', nameEn: 'Parenting Essentials', category: 'kids-pets', aliases: ['濕紙巾'] },
  { slug: 'pet-food', nameZh: '寵物食品', nameEn: 'Pet Food', category: 'kids-pets', aliases: ['鮮食', '主食罐', '飼料'] },
  { slug: 'pet-treats', nameZh: '寵物零食', nameEn: 'Pet Treats', category: 'kids-pets', aliases: ['肉泥'] },
  { slug: 'pet-supplements', nameZh: '寵物保健', nameEn: 'Pet Supplements', category: 'kids-pets', aliases: [] },
  { slug: 'pet-apparel', nameZh: '寵物服飾・配件', nameEn: 'Pet Apparel', category: 'kids-pets', aliases: ['寵物服飾配件', '寵物服飾', '配件', '項圈', '牽繩', '雨衣'] },
  { slug: 'pet-beds-and-scratchers', nameZh: '貓抓板・寵物床窩', nameEn: 'Pet Beds & Scratchers', category: 'kids-pets', aliases: ['貓抓板寵物床窩', '貓抓板', '寵物床窩', '貓屋'] },
  { slug: 'pet-grooming', nameZh: '寵物清潔・美容', nameEn: 'Pet Grooming', category: 'kids-pets', aliases: ['寵物清潔美容', '寵物清潔', '美容', '沐浴露', '貓砂'] },
  { slug: 'pet-supplies', nameZh: '寵物生活用品', nameEn: 'Pet Supplies', category: 'kids-pets', aliases: ['食器'] },
]

function _normalizeKey(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/・/g, '') // strip katakana middle dot (U+30FB ・)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

const _subcategoryMap = new Map<string, ProductSubcategory>()
for (const sub of PRODUCT_SUBCATEGORIES) {
  for (const key of [sub.nameZh, sub.nameEn, ...sub.aliases]) {
    _subcategoryMap.set(_normalizeKey(key), sub)
  }
}

export function matchSubcategory(input: string): ProductSubcategory | null {
  const key = _normalizeKey(input)
  if (!key) return null
  return _subcategoryMap.get(key) ?? null
}

let _subcategorySlugMap: Map<string, ProductSubcategory> | null = null

function _getSubcategorySlugMap(): Map<string, ProductSubcategory> {
  if (!_subcategorySlugMap) {
    _subcategorySlugMap = new Map(PRODUCT_SUBCATEGORIES.map((sub) => [sub.slug, sub]))
  }
  return _subcategorySlugMap
}

export function subcategoryBySlug(slug: string): ProductSubcategory | null {
  return _getSubcategorySlugMap().get(slug) ?? null
}

export function resolveSubcategorySlugs(
  categorySlug: string | null,
  slugs: string[],
): ProductSubcategory[] {
  if (!categorySlug || slugs.length === 0) return []

  const seen = new Set<string>()
  const subcategories: ProductSubcategory[] = []
  for (const slug of slugs) {
    if (seen.has(slug)) continue
    seen.add(slug)

    const subcategory = subcategoryBySlug(slug)
    if (subcategory?.category === categorySlug) subcategories.push(subcategory)
  }
  return subcategories
}

export function subcategoryLabel(sub: ProductSubcategory, locale: string): string {
  return locale === 'zh-TW' ? sub.nameZh : sub.nameEn
}
