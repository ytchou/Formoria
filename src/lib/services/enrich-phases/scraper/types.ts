export type QueryTemplate = (brandName: string) => string

export type BrandImageSearchResult = {
  url: string
  query: string
}

type BrandSearchResult = { urls: string[], snippets: string[], rawEntries?: unknown, latencyMs?: number }

export type ImageQueryInput = {
  brandName: string
  productType?: string | null
  purchaseWebsite?: string | null
}

export type ImageSearchBrandInput = string | ImageQueryInput

export type { BrandSearchResult }
