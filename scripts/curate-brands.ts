import type { Brand, SocialLinks } from '@/lib/types'
import type { ScrapedBrandData } from '@/lib/types/scraper'

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export function scoreBrand(brand: Brand): {
  score: number
  websiteUrl: string | null
} {
  let score = 0

  // description: 15 pts — non-null, > 20 chars
  if (brand.description && brand.description.length > 20) {
    score += 15
  }

  // heroImageUrl: 15 pts — non-null
  if (brand.heroImageUrl) {
    score += 15
  }

  // productPhotos: 15 pts — length >= 2
  if (brand.productPhotos.length >= 2) {
    score += 15
  }

  // socialLinks: 10 pts — >= 1 link
  const socialValues = Object.values(brand.socialLinks).filter(Boolean)
  if (socialValues.length >= 1) {
    score += 10
  }

  // officialWebsite: 10 pts — has scrapeable URL
  const websiteUrl =
    brand.socialLinks.officialWebsite ||
    (brand.purchaseLinks.length > 0 ? brand.purchaseLinks[0].url : null) ||
    null

  if (brand.socialLinks.officialWebsite) {
    score += 10
  }

  // purchaseLinks: 10 pts — length >= 1
  if (brand.purchaseLinks.length >= 1) {
    score += 10
  }

  // founder: 10 pts — has name
  if (brand.founder?.name) {
    score += 10
  }

  // productHighlights: 10 pts — length >= 1
  if (brand.productHighlights.length >= 1) {
    score += 10
  }

  // category: 5 pts — non-null
  if (brand.category) {
    score += 5
  }

  // Penalty: -50 if no scrapeable URL
  if (!websiteUrl) {
    score -= 50
  }

  return { score, websiteUrl }
}

// ---------------------------------------------------------------------------
// Merge strategy (fill-gaps-only)
// ---------------------------------------------------------------------------

export function buildEnrichPatch(
  brand: Brand,
  scraped: ScrapedBrandData
): Partial<Brand> {
  const patch: Partial<Brand> = {}

  // Fill description only if brand has none
  if (!brand.description && scraped.description) {
    patch.description = scraped.description
  }

  // Merge social links: preserve existing, fill missing
  const existingLinks = brand.socialLinks
  const scrapedLinks = scraped.socialLinks
  const mergedLinks: SocialLinks = { ...existingLinks }
  let hasNewLink = false

  const linkKeys = ['instagram', 'threads', 'facebook'] as const
  for (const key of linkKeys) {
    if (!existingLinks[key] && scrapedLinks[key]) {
      mergedLinks[key] = scrapedLinks[key]!
      hasNewLink = true
    }
  }

  if (hasNewLink) {
    patch.socialLinks = mergedLinks
  }

  return patch
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const command = process.argv[2]
  if (!command) {
    console.log('Usage: pnpm curate <command>')
    console.log('Commands:')
    console.log('  score-and-scrape [--dry-run]  Score brands and scrape top 20')
    console.log('  set-visibility <slug1> ...    Hide all, approve selected')
    process.exit(1)
  }
}

// Only run main when executed directly (not imported by tests)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
