import type { SearchCallStatus } from '@/lib/services/search-results'

export type QueryTemplate = (brandName: string) => string

export type BrandImageSearchResult = {
  url: string
  query: string
  auditResultId?: string
}

/**
 * Image search outcome that keeps the provider call status alongside the rows,
 * so a provider outage (zero rows because the call failed) stays distinguishable
 * from a genuinely empty result set (zero rows because there are no images).
 */
export type BrandImageSearchOutcome = {
  rows: BrandImageSearchResult[]
  callStatus: SearchCallStatus
  httpStatus: number | null
  error: string | null
}

export type BrandSearchEntry = {
  title: string
  link: string
  snippet?: string
  position?: number
}

type BrandSearchResult = {
  urls: string[]
  snippets: string[]
  entries?: BrandSearchEntry[]
  rawEntries?: unknown
  latencyMs?: number
  auditResultId?: string
  callStatus?: SearchCallStatus
  httpStatus?: number | null
  error?: string | null
}

export type ImageQueryInput = {
  brandName: string
  productType?: string | null
  purchaseWebsite?: string | null
}

export type ImageSearchBrandInput = string | ImageQueryInput

export type { BrandSearchResult }
