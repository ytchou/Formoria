export type QueryTemplate = (brandName: string) => string

export type BrandImageSearchResult = {
  url: string
  query: string
  auditResultId?: string
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
  callStatus?: string
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
