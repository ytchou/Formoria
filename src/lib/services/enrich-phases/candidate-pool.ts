export type CandidateImageSource = 'scrape' | 'json_ld' | 'google_image'

export type CandidateImage = {
  url: string
  source: CandidateImageSource
}

type CandidatePoolInput = {
  scraped: string[]
  jsonLdImages?: string[]
  googleImages: string[]
}

function addCandidates(
  pool: CandidateImage[],
  seen: Set<string>,
  urls: string[],
  source: CandidateImageSource
): void {
  for (const url of urls) {
    const normalized = url.trim()
    if (!normalized || seen.has(normalized)) continue

    seen.add(normalized)
    pool.push({ url: normalized, source })
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
