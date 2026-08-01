import { productTypeNameZh } from '@/lib/taxonomy/ontology'
import type { ImageQueryInput, QueryTemplate } from './types'

export const SEARCH_DELAY_MS = 1500

export const DEFAULT_QUERY: QueryTemplate = (name: string) => `${name} 台灣`

export function buildImageQueryVariants(input: ImageQueryInput): string[] {
  const brandName = input.brandName.trim()
  if (!brandName) {
    return []
  }

  // The image endpoint runs with hl=zh-TW, so the product type has to be the
  // Chinese category name — a raw English slug pulls in off-brand SERPs.
  const typeZh = productTypeNameZh(input.productType?.trim())
  const typeSegment = typeZh ? ` ${typeZh}` : ''
  return [`"${brandName}"${typeSegment} 商品`]
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
  batchCaptureBrandImages,
  searchBrandMaps,
  parseBrandSearchEntries,
} from './serper'
export type {
  QueryTemplate,
  ImageQueryInput,
  BrandImageSearchOutcome,
  BrandImageSearchResult,
} from './types'
export type { SerperRawImageCandidate, SerperRawImageSearchOutcome } from './serper'
