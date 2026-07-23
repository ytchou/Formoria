import type { ImageQueryInput, QueryTemplate } from './types'

export const SEARCH_DELAY_MS = 1500

export const DEFAULT_QUERY: QueryTemplate = (name: string) => `${name} 台灣`
const IMAGE_NEGATIVE_TERMS = ['-優惠', '-折扣', '-特價', '-coupon']

export function buildImageQueryVariants(input: ImageQueryInput): string[] {
  const brandName = input.brandName.trim()
  if (!brandName) {
    return []
  }

  const productType = input.productType?.trim()
  const productSegment = productType ? `${productType} ` : ''
  const negatives = IMAGE_NEGATIVE_TERMS.join(' ')
  return [`"${brandName}" ${productSegment}商品 台灣 品牌 ${negatives}`]
}

export function stripTrackingParams(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.searchParams.delete('srsltid')
    return parsed.toString()
  } catch {
    return url
  }
}

export function isGoogleUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return hostname.includes('google.com')
  } catch {
    return false
  }
}

export {
  searchBrandUrls,
  batchSearchBrandsWithSnippets,
  batchSearchBrandImages,
  searchBrandMaps,
  parseBrandSearchEntries,
} from './serper'
export type {
  QueryTemplate,
  ImageQueryInput,
} from './types'
