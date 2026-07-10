export const PRODUCT_TYPE_CATEGORIES = [
  { slug: 'fashion', name: 'Fashion & Apparel', nameZh: '服飾鞋履' },
  { slug: 'bags-accessories', name: 'Bags & Accessories', nameZh: '包袋配件' },
  { slug: 'jewelry', name: 'Jewelry', nameZh: '飾品珠寶' },
  { slug: 'beauty', name: 'Beauty & Personal Care', nameZh: '美妝保養' },
  { slug: 'home', name: 'Home & Living', nameZh: '居家生活' },
  { slug: 'food-drink', name: 'Food & Beverage', nameZh: '食品飲料' },
  { slug: 'crafts', name: 'Crafts & Art', nameZh: '工藝文創' },
  { slug: 'stationery', name: 'Stationery & Design', nameZh: '文具設計' },
  { slug: 'tech', name: 'Tech & Electronics', nameZh: '3C科技' },
  { slug: 'outdoor', name: 'Outdoor & Camping', nameZh: '戶外露營' },
  { slug: 'fitness', name: 'Sports & Fitness', nameZh: '運動健身' },
  { slug: 'kids-pets', name: 'Kids, Baby & Pets', nameZh: '母嬰寵物' },
] as const

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

