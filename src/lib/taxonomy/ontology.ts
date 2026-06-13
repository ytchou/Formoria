export const PRODUCT_TYPE_CATEGORIES = [
  { slug: 'fashion', name: 'Fashion & Apparel', nameZh: '服飾鞋履' },
  { slug: 'bags-accessories', name: 'Bags & Accessories', nameZh: '包袋配件' },
  { slug: 'jewelry', name: 'Jewelry', nameZh: '飾品珠寶' },
  { slug: 'beauty', name: 'Beauty & Personal Care', nameZh: '美妝保養' },
  { slug: 'home', name: 'Home & Living', nameZh: '居家生活' },
  { slug: 'food-drink', name: 'Food & Beverage', nameZh: '食品飲料' },
  { slug: 'crafts', name: 'Crafts, Art & Stationery', nameZh: '工藝文創' },
  { slug: 'tech', name: 'Tech & Electronics', nameZh: '3C科技' },
  { slug: 'outdoor', name: 'Outdoor, Sports & Health', nameZh: '戶外運動保健' },
  { slug: 'kids-pets', name: 'Kids, Baby & Pets', nameZh: '母嬰寵物' },
] as const

export type ProductTypeSlug = typeof PRODUCT_TYPE_CATEGORIES[number]['slug']

export function getProductTypeName(slug: string, locale: 'zh-TW' | 'en' = 'zh-TW'): string | undefined {
  const cat = PRODUCT_TYPE_CATEGORIES.find(c => c.slug === slug)
  return cat ? (locale === 'zh-TW' ? cat.nameZh : cat.name) : undefined
}
