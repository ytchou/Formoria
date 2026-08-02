export type CandidateImageSource = 'scrape' | 'json_ld' | 'google_image'

export type CandidateImage = {
  url: string
  source: CandidateImageSource
  sourceUrl?: string
  pageUrl?: string
  previewUrl?: string
  /**
   * How this candidate was acquired, e.g. 'instagram_adapter' | 'crawl'.
   * `source` alone flattens every scraper into 'scrape'.
   */
  method?: string
  title?: string
  providerSource?: string
  domain?: string
  position?: number
  query?: string
  auditResultId?: string
  imageWidth?: number
  imageHeight?: number
  thumbnailWidth?: number
  thumbnailHeight?: number
}

export type CandidateImageInput = string | Omit<CandidateImage, 'source'>

type CandidatePoolInput = {
  /** Plain URLs are still accepted for callers with no provenance to pass. */
  scraped: CandidateImageInput[]
  jsonLdImages?: string[]
  googleImages: CandidateImageInput[]
}

function addCandidates(
  pool: CandidateImage[],
  seen: Set<string>,
  candidates: CandidateImageInput[],
  source: CandidateImageSource
): void {
  for (const candidate of candidates) {
    const normalized = typeof candidate === 'string'
      ? { url: candidate.trim(), source }
      : { ...candidate, url: candidate.url.trim(), source }
    if (!normalized.url || seen.has(normalized.url)) continue

    seen.add(normalized.url)
    pool.push(normalized)
  }
}

export function buildCandidatePool({
  scraped,
  jsonLdImages = [],
  googleImages,
}: CandidatePoolInput): CandidateImage[] {
  const seen = new Set<string>()
  const pool: CandidateImage[] = []

  addCandidates(pool, seen, scraped, 'scrape')
  addCandidates(pool, seen, jsonLdImages, 'json_ld')
  addCandidates(pool, seen, googleImages, 'google_image')

  return pool
}
