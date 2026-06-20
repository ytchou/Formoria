import type { Brand } from '@/lib/types'
import type { ScrapedBrandData } from '@/lib/types/scraper'
import { writeFile } from 'node:fs/promises'
import { getBrands, hideVisibleBrands, insertSlugRedirect, updateBrand } from '@/lib/services/brands'
import { addTagToBrandIgnoringDuplicates, getTags } from '@/lib/services/taxonomy'
import { scrapeBrandUrl, scrapeBrandUrls } from '@/lib/services/scraper'
import { downloadAndStoreImages } from '@/lib/services/image-download'
import { cleanBrandName, detectNonBrand, matchCategory, normalizeSlug } from '@/lib/services/brand-cleanup'

export { matchCategory }

const TOP_N = 30
const SCRAPE_DELAY_MS = 2_000
const MAX_PRODUCT_PHOTOS = 5
const BRAND_FETCH_LIMIT = 10_000

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
  const hasSocial = brand.socialInstagram || brand.socialThreads || brand.socialFacebook
  if (hasSocial) {
    score += 10
  }

  // officialWebsite: 10 pts — has scrapeable URL
  const websiteUrl =
    brand.purchaseWebsite ||
    brand.purchasePinkoi ||
    brand.purchaseShopee ||
    null

  if (brand.purchaseWebsite) {
    score += 10
  }

  // purchaseLinks: 10 pts — length >= 1
  const hasPurchaseLink = brand.purchaseWebsite || brand.purchasePinkoi || brand.purchaseShopee
  if (hasPurchaseLink) {
    score += 10
  }

  // brandHighlights: 10 pts — has text
  if (brand.brandHighlights != null && brand.brandHighlights.length > 0) {
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

  // Fill description when brand has none or it's too short (< 20 chars)
  if ((!brand.description || brand.description.length < 20) && scraped.description && scraped.description.length >= 20) {
    patch.description = scraped.description
  }

  if (!brand.socialInstagram && scraped.socialInstagram) {
    patch.socialInstagram = scraped.socialInstagram
  }
  if (!brand.socialThreads && scraped.socialThreads) {
    patch.socialThreads = scraped.socialThreads
  }
  if (!brand.socialFacebook && scraped.socialFacebook) {
    patch.socialFacebook = scraped.socialFacebook
  }

  // Fill brandHighlights from scraped story if brand has none
  if (!brand.brandHighlights && scraped.story) {
    patch.brandHighlights = scraped.story
  }

  return patch
}

// ---------------------------------------------------------------------------
// Cleanup helpers
// ---------------------------------------------------------------------------

export function cleanNames(brands: Brand[]): Array<{
  slug: string
  originalName: string
  cleanedName: string
  patternsMatched: ReturnType<typeof cleanBrandName>['patternsMatched']
  confidence: ReturnType<typeof cleanBrandName>['confidence']
}> {
  return brands
    .map((brand) => ({ brand, cleanup: cleanBrandName(brand.name) }))
    .filter(({ cleanup }) => cleanup.changed)
    .map(({ brand, cleanup }) => ({
      slug: brand.slug,
      originalName: cleanup.originalName,
      cleanedName: cleanup.cleanedName,
      patternsMatched: cleanup.patternsMatched,
      confidence: cleanup.confidence,
    }))
}

export function detectNonBrands(brands: Brand[]): Array<{
  slug: string
  name: string
  reason: string | null
  confidence: ReturnType<typeof detectNonBrand>['confidence']
}> {
  return brands
    .map((brand) => ({ brand, detection: detectNonBrand(brand) }))
    .filter(({ detection }) => detection.isNonBrand)
    .map(({ brand, detection }) => ({
      slug: brand.slug,
      name: brand.name,
      reason: detection.reason,
      confidence: detection.confidence,
    }))
}

export function findBrandsNeedingEnrichment(brands: Brand[]): Brand[] {
  return brands.filter((brand) => {
    const description = brand.description

    return (
      description === null ||
      description.trim() === '' ||
      description.length < 20 ||
      description === brand.name
    )
  })
}

export function findSlugsNeedingNormalization(brands: Brand[]): Array<{
  slug: string
  newSlug: string
  name: string
  source: ReturnType<typeof normalizeSlug>['source']
}> {
  const existingSlugs = new Set(brands.map((brand) => brand.slug))
  const assignedSlugs = new Set<string>()
  const results: Array<{
    slug: string
    newSlug: string
    name: string
    source: ReturnType<typeof normalizeSlug>['source']
  }> = []

  for (const brand of brands) {
    const result = normalizeSlug(brand.slug, brand.name)

    if (result.newSlug && !existingSlugs.has(result.newSlug) && !assignedSlugs.has(result.newSlug)) {
      results.push({
        slug: brand.slug,
        newSlug: result.newSlug,
        name: brand.name,
        source: result.source,
      })
      assignedSlugs.add(result.newSlug)
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isShowcaseReady(brand: Brand): boolean {
  return Boolean(
    brand.description && brand.description.length > 20 &&
    brand.heroImageUrl &&
    brand.category &&
    (brand.socialInstagram || brand.socialThreads || brand.socialFacebook) &&
    brand.productPhotos.length >= 2
  )
}

async function scoreAndScrape(dryRun: boolean, targetSlugs?: string[], stopAfter?: number): Promise<void> {
  console.log('Fetching all brands...')
  const { brands } = await getBrands({ limit: BRAND_FETCH_LIMIT })
  console.log(`Found ${brands.length} brands`)

  // Score and rank — optionally filter to target slugs
  const scored = brands.map((brand) => ({ brand, ...scoreBrand(brand) }))
  const ranked = targetSlugs
    ? scored.filter(({ brand }) => targetSlugs.includes(brand.slug))
    : scored.sort((a, b) => b.score - a.score).slice(0, TOP_N)

  if (targetSlugs) {
    const found = ranked.map(({ brand }) => brand.slug)
    const missing = targetSlugs.filter((s) => !found.includes(s))
    if (missing.length > 0) {
      console.error(`Missing slugs: ${missing.join(', ')}`)
      process.exit(1)
    }
  }

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
  if (stopAfter) console.log(`  (will stop after ${stopAfter} showcase-ready brands)\n`)

  const summary: { slug: string; fields: string[]; images: number; showcaseReady: boolean }[] = []
  let goodCount = 0

  for (const { brand, websiteUrl } of ranked) {
    if (!websiteUrl) {
      console.log(`  [SKIP] ${brand.slug} — no scrapeable URL`)
      summary.push({ slug: brand.slug, fields: [], images: 0, showcaseReady: false })
      continue
    }

    console.log(`  [SCRAPE] ${brand.slug} → ${websiteUrl}`)

    let scraped: ScrapedBrandData
    try {
      scraped = await scrapeBrandUrl(websiteUrl)
    } catch (err) {
      console.warn(`  [ERROR] Scrape failed for ${brand.slug}:`, err)
      summary.push({ slug: brand.slug, fields: ['scrape-error'], images: 0, showcaseReady: false })
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
      const galleryStart = imageUrls.length > 0 ? 1 : 0
      imageUrls.push(
        ...scraped.galleryImageUrls.slice(galleryStart, galleryStart + slotsAvailable)
      )
    }

    let downloadedImages: string[] = []
    if (imageUrls.length > 0) {
      try {
        downloadedImages = (await downloadAndStoreImages(imageUrls, brand.id))
          .filter((url): url is string => url !== null)
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

    const updatedBrand = { ...brand, ...patch }
    const ready = isShowcaseReady(updatedBrand)
    if (ready) {
      goodCount++
      console.log(`  [SHOWCASE] ${brand.slug} is showcase-ready (${goodCount}${stopAfter ? `/${stopAfter}` : ''})`)
    }

    summary.push({
      slug: brand.slug,
      fields: enrichedFields,
      images: downloadedImages.length,
      showcaseReady: ready,
    })

    if (stopAfter && goodCount >= stopAfter) {
      console.log(`\nReached ${stopAfter} showcase-ready brands — stopping early.`)
      break
    }

    await sleep(SCRAPE_DELAY_MS)
  }

  // Print summary
  console.log('\n--- Summary ---')
  console.log('Slug                          | Fields Enriched            | Images | Ready')
  console.log('------------------------------|----------------------------|--------|------')
  for (const { slug, fields, images, showcaseReady } of summary) {
    const s = slug.padEnd(30).slice(0, 30)
    const f = (fields.length > 0 ? fields.join(', ') : '(none)').padEnd(27).slice(0, 27)
    const r = showcaseReady ? 'YES' : ' - '
    console.log(`${s}| ${f}| ${String(images).padStart(6)} | ${r}`)
  }

  console.log(`\nDone. Enriched ${summary.filter((s) => s.fields.length > 0).length} of ${summary.length} brands.`)
}

// ---------------------------------------------------------------------------
// clean-names
// ---------------------------------------------------------------------------

async function cleanNamesCommand(dryRun: boolean): Promise<void> {
  console.log('Fetching approved brands...')
  const { brands } = await getBrands({ limit: BRAND_FETCH_LIMIT, status: 'approved' })
  console.log(`Found ${brands.length} approved brands`)

  const results = cleanNames(brands)
  console.log(`Found ${results.length} name(s) to clean\n`)

  console.log('Slug                          | Original                       | Cleaned                        | Patterns                  | Confidence')
  console.log('------------------------------|--------------------------------|--------------------------------|---------------------------|-----------')
  for (const result of results) {
    const slug = result.slug.padEnd(30).slice(0, 30)
    const original = result.originalName.padEnd(31).slice(0, 31)
    const cleaned = result.cleanedName.padEnd(31).slice(0, 31)
    const patterns = result.patternsMatched.join(', ').padEnd(26).slice(0, 26)
    const confidence = result.confidence.padStart(10)
    console.log(`${slug}| ${original}| ${cleaned}| ${patterns}| ${confidence}`)
  }

  if (dryRun) {
    console.log('\nDry run — no changes made. Re-run with --apply to write these name changes.')
    return
  }

  const brandBySlug = new Map(brands.map((brand) => [brand.slug, brand]))
  let updated = 0

  for (const result of results) {
    const brand = brandBySlug.get(result.slug)

    if (!brand) continue

    await updateBrand(brand.id, { name: result.cleanedName })
    updated++
    console.log(`  [OK] ${result.slug} → ${result.cleanedName}`)
  }

  console.log(`\nDone. Cleaned ${updated} brand name(s).`)
}

// ---------------------------------------------------------------------------
// detect-non-brands
// ---------------------------------------------------------------------------

async function detectNonBrandsCommand(dryRun: boolean, outputFile?: string): Promise<void> {
  console.log('Fetching approved brands...')
  const { brands } = await getBrands({ limit: BRAND_FETCH_LIMIT, status: 'approved' })
  console.log(`Found ${brands.length} approved brands`)

  const results = detectNonBrands(brands)
  console.log(`Found ${results.length} potential non-brand entr${results.length === 1 ? 'y' : 'ies'}\n`)

  console.log('Slug                          | Name                           | Reason                    | Confidence')
  console.log('------------------------------|--------------------------------|---------------------------|-----------')
  for (const result of results) {
    const slug = result.slug.padEnd(30).slice(0, 30)
    const name = result.name.padEnd(31).slice(0, 31)
    const reason = (result.reason ?? '(unknown)').padEnd(26).slice(0, 26)
    const confidence = result.confidence.padStart(10)
    console.log(`${slug}| ${name}| ${reason}| ${confidence}`)
  }

  if (outputFile) {
    await writeFile(outputFile, `${results.map((result) => result.slug).join('\n')}${results.length > 0 ? '\n' : ''}`)
    console.log(`\nWrote ${results.length} slug(s) to ${outputFile}`)
  }

  if (dryRun) {
    console.log('\nDry run — no changes made.')
    return
  }

  if (outputFile) {
    console.log(`\nReview the output, then run: pnpm remove-brand --file=${outputFile}`)
  } else {
    console.log('\nNo brands were deleted. Re-run with --output-file=<path>, review the file, then run pnpm remove-brand --file=<output>.')
  }
}

// ---------------------------------------------------------------------------
// enrich-descriptions
// ---------------------------------------------------------------------------

async function enrichDescriptions(dryRun: boolean, stopAfter?: number): Promise<void> {
  console.log('Fetching approved brands...')
  const { brands } = await getBrands({ limit: BRAND_FETCH_LIMIT, status: 'approved' })
  console.log(`Found ${brands.length} approved brands`)

  const needingEnrichment = findBrandsNeedingEnrichment(brands)
  const ranked = needingEnrichment
    .map((brand) => ({ brand, ...scoreBrand(brand) }))
    .filter(({ brand }) => brand.purchaseWebsite)
    .sort((a, b) => b.score - a.score)
    .slice(0, stopAfter)

  console.log(`Found ${needingEnrichment.length} brand(s) needing description enrichment`)
  console.log(`Found ${ranked.length} brand(s) with scrapeable URLs\n`)

  console.log('  #  | Score | Slug                          | Website URL')
  console.log('-----|-------|-------------------------------|-----------------------------')
  ranked.forEach(({ brand, score }, i) => {
    const idx = String(i + 1).padStart(3)
    const sc = String(score).padStart(5)
    const slug = brand.slug.padEnd(30).slice(0, 30)
    const url = brand.purchaseWebsite ?? '(none)'
    console.log(`${idx}  | ${sc} | ${slug}| ${url}`)
  })

  if (dryRun) {
    console.log('\nDry run — no changes made.')
    return
  }

  let updated = 0

  for (const { brand } of ranked) {
    const urls = [
      brand.purchaseWebsite,
      brand.purchasePinkoi,
      brand.purchaseShopee,
    ].filter((url): url is string => Boolean(url))

    console.log(`  [SCRAPE] ${brand.slug} → ${urls.join(', ')}`)

    try {
      const { data: scraped } = await scrapeBrandUrls(urls)
      const patch = buildEnrichPatch(brand, scraped)

      if (!patch.description) {
        console.log(`  [OK] ${brand.slug} — no description found`)
        await sleep(SCRAPE_DELAY_MS)
        continue
      }

      await updateBrand(brand.id, { description: patch.description })
      updated++
      console.log(`  [OK] ${brand.slug} — enriched: description`)
    } catch (err) {
      console.warn(`  [ERROR] ${brand.slug}:`, err)
    }

    await sleep(SCRAPE_DELAY_MS)
  }

  console.log(`\nDone. Enriched ${updated} brand description(s).`)
}

// ---------------------------------------------------------------------------
// normalize-slugs
// ---------------------------------------------------------------------------

async function normalizeSlugs(dryRun: boolean, scrapeFirst: boolean, stopAfter?: number): Promise<void> {
  console.log('Fetching approved brands...')
  const { brands } = await getBrands({ limit: BRAND_FETCH_LIMIT, status: 'approved' })
  console.log(`Found ${brands.length} approved brands`)

  let workingBrands = brands

  if (scrapeFirst) {
    const existingSlugs = new Set(brands.map((brand) => brand.slug))
    const scrapedBrands: Brand[] = []

    for (const brand of brands) {
      if (!brand.purchaseWebsite) {
        scrapedBrands.push(brand)
        continue
      }

      try {
        console.log(`  [SCRAPE] ${brand.slug} → ${brand.purchaseWebsite}`)
        const { data: scraped } = await scrapeBrandUrls([brand.purchaseWebsite])
        const scrapedName = scraped.brandName ?? brand.name
        const result = normalizeSlug(brand.slug, scrapedName)
        const normalizedName = result.newSlug && !existingSlugs.has(result.newSlug)
          ? scrapedName
          : brand.name

        scrapedBrands.push({ ...brand, name: normalizedName })
      } catch (err) {
        console.warn(`  [ERROR] Scrape failed for ${brand.slug}:`, err)
        scrapedBrands.push(brand)
      }

      await sleep(SCRAPE_DELAY_MS)
    }

    workingBrands = scrapedBrands
  }

  const results = findSlugsNeedingNormalization(workingBrands).slice(0, stopAfter)
  console.log(`\nFound ${results.length} slug(s) to normalize\n`)
  if (results.length === 0) {
    console.warn('No slugs need normalization. If brands have CJK names, try running with --scrape to use English names for slug generation.')
  }

  console.log('Slug                          | New Slug                      | Name                           | Source')
  console.log('------------------------------|-------------------------------|--------------------------------|--------------------------')
  for (const result of results) {
    const slug = result.slug.padEnd(30).slice(0, 30)
    const newSlug = result.newSlug.padEnd(30).slice(0, 30)
    const name = result.name.padEnd(31).slice(0, 31)
    console.log(`${slug}| ${newSlug}| ${name}| ${result.source}`)
  }

  if (dryRun) {
    console.log('\nDry run — no changes made.')
    return
  }

  const brandBySlug = new Map(brands.map((brand) => [brand.slug, brand]))
  let updated = 0

  for (const result of results) {
    const brand = brandBySlug.get(result.slug)

    if (!brand) continue

    await updateBrand(brand.id, { slug: result.newSlug })
    await insertSlugRedirect(result.slug, result.newSlug)
    updated++
    console.log(`  [OK] ${result.slug} → ${result.newSlug}`)
  }

  console.log(`\nDone. Normalized ${updated} slug(s).`)
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
  const { brands } = await getBrands({ limit: BRAND_FETCH_LIMIT })
  const slugMap = new Map(brands.map((b) => [b.slug, b]))

  // Fail fast if any slug is missing
  const missing = slugs.filter((s) => !slugMap.has(s))
  if (missing.length > 0) {
    console.error(`Missing slugs: ${missing.join(', ')}`)
    process.exit(1)
  }

  // Bulk-hide all brands
  console.log('Hiding all brands...')
  const count = await hideVisibleBrands()
  console.log(`  Hidden ${count} brand(s)`)

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
// auto-tag
// ---------------------------------------------------------------------------

async function autoTag(dryRun: boolean, targetSlugs?: string[]): Promise<void> {
  console.log('Fetching all brands...')
  const { brands } = await getBrands({ limit: BRAND_FETCH_LIMIT })
  console.log(`Found ${brands.length} brands`)

  console.log('Fetching product_type tags...')
  const tags = await getTags('product_type')
  const tagBySlug = new Map(tags.map((t) => [t.slug, t]))
  console.log(`Found ${tags.length} product_type tags\n`)

  let untagged = brands.filter((b) => b.category === null)
  if (targetSlugs) {
    untagged = untagged.filter((b) => targetSlugs.includes(b.slug))
    console.log(`Filtering to ${untagged.length} of ${targetSlugs.length} requested slugs (others already tagged or not found)\n`)
  } else {
    console.log(`Brands without category: ${untagged.length} (skipping ${brands.length - untagged.length} already tagged)\n`)
  }

  const tally: Record<string, number> = {}
  const unmatched: string[] = []

  for (const brand of untagged) {
    const text = `${brand.name} ${brand.description ?? ''}`
    const matched = matchCategory(text)

    if (!matched) {
      unmatched.push(brand.slug)
      console.log(`  [NO MATCH] ${brand.slug}`)
      continue
    }

    const tag = tagBySlug.get(matched)
    const categoryLabel = tag?.nameZh ?? tag?.name ?? matched

    if (dryRun) {
      console.log(`  [DRY RUN] ${brand.slug} → ${matched} (${categoryLabel})`)
    } else {
      try {
        await updateBrand(brand.id, { category: categoryLabel })

        if (tag) {
          await addTagToBrandIgnoringDuplicates(brand.id, tag.id)
        }

        console.log(`  [OK] ${brand.slug} → ${matched} (${categoryLabel})`)
      } catch (err) {
        console.warn(`  [ERROR] ${brand.slug}:`, err)
      }
    }

    tally[matched] = (tally[matched] ?? 0) + 1
  }

  console.log('\n--- Summary ---')
  console.log(`Brands processed: ${untagged.length}`)
  console.log(`Matched: ${untagged.length - unmatched.length}`)
  console.log(`Unmatched: ${unmatched.length}`)

  if (Object.keys(tally).length > 0) {
    console.log('\nCategories assigned:')
    for (const [slug, count] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${slug.padEnd(16)} ${count}`)
    }
  }

  if (unmatched.length > 0) {
    console.log('\nUnmatched brands:')
    for (const slug of unmatched) {
      console.log(`  ${slug}`)
    }
  }

  if (dryRun) {
    console.log('\nDry run — no changes made.')
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function printUsage(): void {
  console.log('Usage: pnpm curate <command>')
  console.log('Commands:')
  console.log('  score-and-scrape [--dry-run] [--slugs=a,b,c] [--stop-after=N]  Score and scrape')
  console.log('  set-visibility <slug1> ...                     Hide all, approve selected')
  console.log('  auto-tag [--dry-run]                           Assign product_type categories via keyword matching')
  console.log('  clean-names [--apply]                          Clean noisy brand names (dry-run by default)')
  console.log('  detect-non-brands [--dry-run] [--output-file=path]  Detect likely non-brand entries')
  console.log('  enrich-descriptions [--dry-run] [--stop-after=N]  Fill missing or weak descriptions from scraped URLs')
  console.log('  normalize-slugs [--dry-run] [--scrape] [--stop-after=N]  Normalize CJK slugs from English names')
}

async function main() {
  const command = process.argv[2]
  const args = process.argv.slice(3)

  switch (command) {
    case 'score-and-scrape': {
      const dryRun = args.includes('--dry-run')
      const slugsArg = args.find((a) => a.startsWith('--slugs='))
      const targetSlugs = slugsArg ? slugsArg.replace('--slugs=', '').split(',') : undefined
      const stopArg = args.find((a) => a.startsWith('--stop-after='))
      const stopAfter = stopArg ? parseInt(stopArg.replace('--stop-after=', ''), 10) : undefined
      await scoreAndScrape(dryRun, targetSlugs, stopAfter)
      break
    }
    case 'set-visibility': {
      await setVisibility(args)
      break
    }
    case 'auto-tag': {
      const dryRun = args.includes('--dry-run')
      const slugsArg = args.find((a) => a.startsWith('--slugs='))
      const targetSlugs = slugsArg ? slugsArg.replace('--slugs=', '').split(',') : undefined
      await autoTag(dryRun, targetSlugs)
      break
    }
    case 'clean-names': {
      const dryRun = !args.includes('--apply')
      await cleanNamesCommand(dryRun)
      break
    }
    case 'detect-non-brands': {
      const dryRun = args.includes('--dry-run')
      const outputArg = args.find((a) => a.startsWith('--output-file='))
      const outputFile = outputArg ? outputArg.replace('--output-file=', '') : undefined
      await detectNonBrandsCommand(dryRun, outputFile)
      break
    }
    case 'enrich-descriptions': {
      const dryRun = args.includes('--dry-run')
      const stopArg = args.find((a) => a.startsWith('--stop-after='))
      const stopAfter = stopArg ? parseInt(stopArg.replace('--stop-after=', ''), 10) : undefined
      await enrichDescriptions(dryRun, stopAfter)
      break
    }
    case 'normalize-slugs': {
      const dryRun = args.includes('--dry-run')
      const scrapeFirst = args.includes('--scrape')
      const stopArg = args.find((a) => a.startsWith('--stop-after='))
      const stopAfter = stopArg ? parseInt(stopArg.replace('--stop-after=', ''), 10) : undefined
      await normalizeSlugs(dryRun, scrapeFirst, stopAfter)
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
