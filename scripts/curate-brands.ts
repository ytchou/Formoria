import type { Brand, SocialLinks } from '@/lib/types'
import type { ScrapedBrandData } from '@/lib/types/scraper'
import { getBrands, updateBrand } from '@/lib/services/brands'
import { scrapeBrandUrl } from '@/lib/services/scraper'
import { downloadAndStoreImages } from '@/lib/services/image-download'
import { createServiceClient } from '@/lib/supabase/server'

const TOP_N = 20
const SCRAPE_DELAY_MS = 2_000
const MAX_PRODUCT_PHOTOS = 5

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
// Commands
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function scoreAndScrape(dryRun: boolean): Promise<void> {
  console.log('Fetching all brands...')
  const { brands } = await getBrands({ limit: 1000 })
  console.log(`Found ${brands.length} brands`)

  // Score and rank
  const ranked = brands
    .map((brand) => ({ brand, ...scoreBrand(brand) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N)

  // Print ranked table
  console.log('\n  #  | Score | Slug                          | Website URL')
  console.log('-----|-------|-------------------------------|-----------------------------')
  ranked.forEach(({ brand, score, websiteUrl }, i) => {
    const idx = String(i + 1).padStart(3)
    const sc = String(score).padStart(5)
    const slug = brand.slug.padEnd(30).slice(0, 30)
    const url = websiteUrl ?? '(none)'
    console.log(`${idx}  | ${sc} | ${slug}| ${url}`)
  })

  if (dryRun) {
    console.log('\nDry run — no changes made.')
    return
  }

  console.log(`\nEnriching top ${ranked.length} brands...`)

  const summary: { slug: string; fields: string[]; images: number }[] = []

  for (const { brand, websiteUrl } of ranked) {
    if (!websiteUrl) {
      console.log(`  [SKIP] ${brand.slug} — no scrapeable URL`)
      summary.push({ slug: brand.slug, fields: [], images: 0 })
      continue
    }

    console.log(`  [SCRAPE] ${brand.slug} → ${websiteUrl}`)

    let scraped: ScrapedBrandData
    try {
      scraped = await scrapeBrandUrl(websiteUrl)
    } catch (err) {
      console.warn(`  [ERROR] Scrape failed for ${brand.slug}:`, err)
      summary.push({ slug: brand.slug, fields: ['scrape-error'], images: 0 })
      await sleep(SCRAPE_DELAY_MS)
      continue
    }

    // Build text patch
    const patch = buildEnrichPatch(brand, scraped)
    const enrichedFields = Object.keys(patch)

    // Handle images
    const imageUrls: string[] = []
    if (!brand.heroImageUrl && scraped.heroImageUrl) {
      imageUrls.push(scraped.heroImageUrl)
    }
    const currentPhotoCount = brand.productPhotos.length
    if (currentPhotoCount < 3 && scraped.galleryImageUrls.length > 0) {
      const slotsAvailable = MAX_PRODUCT_PHOTOS - currentPhotoCount
      // Skip the first gallery image if we're also using it as hero
      const galleryStart = imageUrls.length > 0 ? 0 : 0
      imageUrls.push(
        ...scraped.galleryImageUrls.slice(galleryStart, galleryStart + slotsAvailable)
      )
    }

    let downloadedImages: string[] = []
    if (imageUrls.length > 0) {
      try {
        downloadedImages = await downloadAndStoreImages(imageUrls, brand.id)
      } catch (err) {
        console.warn(`  [ERROR] Image download failed for ${brand.slug}:`, err)
      }
    }

    // Merge downloaded image URLs into patch
    let imageIdx = 0
    if (!brand.heroImageUrl && scraped.heroImageUrl && downloadedImages.length > 0) {
      patch.heroImageUrl = downloadedImages[imageIdx]
      imageIdx++
      enrichedFields.push('heroImageUrl')
    }

    const newPhotos = downloadedImages.slice(imageIdx)
    if (newPhotos.length > 0) {
      patch.productPhotos = [
        ...brand.productPhotos,
        ...newPhotos,
      ].slice(0, MAX_PRODUCT_PHOTOS)
      enrichedFields.push('productPhotos')
    }

    // Apply patch
    if (Object.keys(patch).length > 0) {
      try {
        await updateBrand(brand.id, patch)
        console.log(`  [OK] ${brand.slug} — enriched: ${enrichedFields.join(', ')}`)
      } catch (err) {
        console.warn(`  [ERROR] Update failed for ${brand.slug}:`, err)
      }
    } else {
      console.log(`  [OK] ${brand.slug} — no gaps to fill`)
    }

    summary.push({
      slug: brand.slug,
      fields: enrichedFields,
      images: downloadedImages.length,
    })

    await sleep(SCRAPE_DELAY_MS)
  }

  // Print summary
  console.log('\n--- Summary ---')
  console.log('Slug                          | Fields Enriched            | Images')
  console.log('------------------------------|----------------------------|-------')
  for (const { slug, fields, images } of summary) {
    const s = slug.padEnd(30).slice(0, 30)
    const f = (fields.length > 0 ? fields.join(', ') : '(none)').padEnd(27).slice(0, 27)
    console.log(`${s}| ${f}| ${images}`)
  }

  console.log(`\nDone. Enriched ${summary.filter((s) => s.fields.length > 0).length} of ${summary.length} brands.`)
}

// ---------------------------------------------------------------------------
// set-visibility
// ---------------------------------------------------------------------------

async function setVisibility(slugs: string[]): Promise<void> {
  if (slugs.length === 0) {
    console.log('Usage: pnpm curate set-visibility <slug1> <slug2> ...')
    console.log('Hides all brands, then approves only the listed slugs.')
    process.exit(1)
  }

  console.log(`Validating ${slugs.length} slug(s)...`)
  const { brands } = await getBrands({ limit: 1000 })
  const slugMap = new Map(brands.map((b) => [b.slug, b]))

  // Fail fast if any slug is missing
  const missing = slugs.filter((s) => !slugMap.has(s))
  if (missing.length > 0) {
    console.error(`Missing slugs: ${missing.join(', ')}`)
    process.exit(1)
  }

  // Bulk-hide all brands
  console.log('Hiding all brands...')
  const supabase = createServiceClient()
  const { count, error } = await supabase
    .from('brands')
    .update({ status: 'hidden' })
    .neq('status', 'hidden')

  if (error) throw error
  console.log(`  Hidden ${count ?? 0} brand(s)`)

  // Approve selected
  console.log(`Approving ${slugs.length} brand(s)...`)
  for (const slug of slugs) {
    const brand = slugMap.get(slug)!
    await updateBrand(brand.id, { status: 'approved' })
    console.log(`  [OK] ${slug}`)
  }

  console.log(`\nDone. ${slugs.length} brands are now visible.`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function printUsage(): void {
  console.log('Usage: pnpm curate <command>')
  console.log('Commands:')
  console.log('  score-and-scrape [--dry-run]  Score brands and scrape top 20')
  console.log('  set-visibility <slug1> ...    Hide all, approve selected')
}

async function main() {
  const command = process.argv[2]
  const args = process.argv.slice(3)

  switch (command) {
    case 'score-and-scrape': {
      const dryRun = args.includes('--dry-run')
      await scoreAndScrape(dryRun)
      break
    }
    case 'set-visibility': {
      await setVisibility(args)
      break
    }
    default:
      printUsage()
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
