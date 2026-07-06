export type EnrichedData = {
  description?: string
  heroImageUrl?: string
  productType?: string
  priceRange?: number
  productTags?: string[]
  socialInstagram?: string
  socialThreads?: string
  socialFacebook?: string
  purchaseWebsite?: string
  purchasePinkoi?: string
  purchaseShopee?: string
  otherUrls?: string[]
  name?: string
}

// ---------------------------------------------------------------------------
// Service boundary transforms — convert between camelCase (TypeScript domain)
// and snake_case (DB JSONB keys).
// ---------------------------------------------------------------------------

export function enrichedDataFromDb(json: Record<string, unknown>): EnrichedData {
  return {
    ...(typeof json.description === 'string' ? { description: json.description } : {}),
    ...(typeof json.name === 'string' ? { name: json.name } : {}),
    ...(typeof json.hero_image_url === 'string' ? { heroImageUrl: json.hero_image_url } : {}),
    ...(typeof json.product_type === 'string' ? { productType: json.product_type } : {}),
    ...(typeof json.price_range === 'number' ? { priceRange: json.price_range } : {}),
    ...(Array.isArray(json.product_tags) ? { productTags: json.product_tags as string[] } : {}),
    ...(typeof json.social_instagram === 'string' ? { socialInstagram: json.social_instagram } : {}),
    ...(typeof json.social_threads === 'string' ? { socialThreads: json.social_threads } : {}),
    ...(typeof json.social_facebook === 'string' ? { socialFacebook: json.social_facebook } : {}),
    ...(typeof json.purchase_website === 'string' ? { purchaseWebsite: json.purchase_website } : {}),
    ...(typeof json.purchase_pinkoi === 'string' ? { purchasePinkoi: json.purchase_pinkoi } : {}),
    ...(typeof json.purchase_shopee === 'string' ? { purchaseShopee: json.purchase_shopee } : {}),
    ...(Array.isArray(json.other_urls) ? { otherUrls: json.other_urls as string[] } : {}),
  }
}

export function enrichedDataToDb(data: EnrichedData): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  if (data.description !== undefined) result.description = data.description
  if (data.name !== undefined) result.name = data.name
  if (data.heroImageUrl !== undefined) result.hero_image_url = data.heroImageUrl
  if (data.productType !== undefined) result.product_type = data.productType
  if (data.priceRange !== undefined) result.price_range = data.priceRange
  if (data.productTags !== undefined) result.product_tags = data.productTags
  if (data.socialInstagram !== undefined) result.social_instagram = data.socialInstagram
  if (data.socialThreads !== undefined) result.social_threads = data.socialThreads
  if (data.socialFacebook !== undefined) result.social_facebook = data.socialFacebook
  if (data.purchaseWebsite !== undefined) result.purchase_website = data.purchaseWebsite
  if (data.purchasePinkoi !== undefined) result.purchase_pinkoi = data.purchasePinkoi
  if (data.purchaseShopee !== undefined) result.purchase_shopee = data.purchaseShopee
  if (data.otherUrls !== undefined) result.other_urls = data.otherUrls
  return result
}
