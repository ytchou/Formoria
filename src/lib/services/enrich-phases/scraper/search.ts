import type { ImageQueryInput, QueryTemplate } from './types'

export const SEARCH_DELAY_MS = 1500

export const DEFAULT_QUERY: QueryTemplate = (name: string) => `${name} 台灣`
const IMAGE_NEGATIVE_TERMS = ['-優惠', '-折扣', '-特價', '-coupon']

function extractSearchDomain(url: string | null | undefined): string | null {
  const value = url?.trim()
  if (!value) {
    return null
  }

  try {
    return new URL(value).hostname.replace(/^www\./, '')
  } catch {
    try {
      return new URL(`https://${value}`).hostname.replace(/^www\./, '')
    } catch {
      return null
    }
  }
}

export function buildImageQueryVariants(input: ImageQueryInput): string[] {
  const brandName = input.brandName.trim()
  if (!brandName) {
    return []
  }

  const productType = input.productType?.trim()
  const productSegment = productType ? `${productType} ` : ''
  const negatives = IMAGE_NEGATIVE_TERMS.join(' ')
  const variants = [
    `"${brandName}" ${productSegment}商品 ${negatives}`,
  ]
  const domain = extractSearchDomain(input.purchaseWebsite)
  if (domain) {
    variants.push(`site:${domain} "${brandName}" ${productSegment}商品 ${negatives}`)
  }
  variants.push(`"${brandName}" 台灣 ${negatives}`)

  return [...new Set(variants)].slice(0, 3)
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

export { searchBrandUrls, batchSearchBrandsWithSnippets, batchSearchBrandImages } from './serper'
export type {
  BrandImageSearchResult,
  BrandSearchResult,
  QueryTemplate,
  ImageQueryInput,
  ImageSearchBrandInput,
} from './types'
