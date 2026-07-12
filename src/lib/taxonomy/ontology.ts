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

