import type { Brand, BrandFlatLinkColumns } from '@/lib/types'
import type { ScrapedBrandData } from '@/lib/types/scraper'
import type { LinkColumn } from '@/lib/services/link-enrichment'
import { writeFile } from 'node:fs/promises'
import { getBrands, hideVisibleBrands, insertSlugRedirect, updateBrand } from '@/lib/services/brands'
import { addTagToBrandIgnoringDuplicates, getTags } from '@/lib/services/taxonomy'
import { scrapeBrandUrls } from '@/lib/services/scraper'
import { SEARCH_DELAY_MS, searchBrandUrls } from '../src/lib/services/scraper/search'
import { classifyByDomain } from '@/lib/services/scraper/input-detector'
import { downloadAndStoreImages } from '@/lib/services/image-download'
import { cleanBrandName, detectNonBrand, matchCategory, normalizeSlug } from '@/lib/services/brand-cleanup'
import {
  buildImageEnrichPatch,
  buildLinkEnrichPatch,
  hasLinkValue,
  LINK_FIELDS,
  linkColumnFor,
} from '@/lib/services/link-enrichment'

export { buildImageEnrichPatch, buildLinkEnrichPatch, matchCategory }

const SCRAPE_DELAY_MS = 1_000
const BRAND_FETCH_LIMIT = 10_000

type BrandWithLinkColumns = Brand & BrandFlatLinkColumns

function withFlatLinkColumns(brand: Brand): BrandWithLinkColumns {
  return {
    ...brand,
    social_instagram: brand.socialInstagram,
    social_threads: brand.socialThreads,
    social_facebook: brand.socialFacebook,
    purchase_website: brand.purchaseWebsite,
    purchase_pinkoi: brand.purchasePinkoi,
    purchase_shopee: brand.purchaseShopee,
    other_urls: brand.otherUrls,
  }
}

function collectKnownUrls(brand: BrandWithLinkColumns): string[] {
  const linkUrls = LINK_FIELDS
    .map((field) => brand[linkColumnFor(field)])
    .filter((url): url is string => hasLinkValue(url))
  const otherUrls = Array.isArray(brand.otherUrls)
    ? brand.otherUrls
        .map((entry) => entry.url)
        .filter((url): url is string => hasLinkValue(url))
    : []

  return uniqueUrls([...linkUrls, ...otherUrls])
}

function getMissingLinkFields(brand: BrandWithLinkColumns): LinkColumn[] {
  return LINK_FIELDS
    .map((field) => linkColumnFor(field))
    .filter((column) => !hasLinkValue(brand[column]))
}

function getAverageLinkCoverage(brands: BrandWithLinkColumns[]): number {
  if (brands.length === 0) return 0

  const filled = brands.reduce((sum, brand) => {
    return sum + LINK_FIELDS.filter((field) => hasLinkValue(brand[linkColumnFor(field)])).length
  }, 0)

  return filled / (brands.length * LINK_FIELDS.length)
}

function deriveOfficialWebsite(urls: string[]): string | null {
  return urls.find((url) => classifyByDomain(url) === null) ?? null
}

function uniqueUrls(urls: string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []

  for (const url of urls) {
    const normalized = url.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    unique.push(normalized)
  }

  return unique
}

function isImageableUrl(url: string): boolean {
  return classifyByDomain(url) !== 'social'
}

function displayBrandName(brand: Brand): string {
  return (brand as Brand & { name_en?: string | null }).name_en || brand.name
}

function linkPatchToBrandPatch(patch: Partial<BrandFlatLinkColumns>): Partial<Brand> {
  const brandPatch: Partial<Brand> = {}

  if (patch.social_instagram !== undefined) brandPatch.socialInstagram = patch.social_instagram
  if (patch.social_threads !== undefined) brandPatch.socialThreads = patch.social_threads
  if (patch.social_facebook !== undefined) brandPatch.socialFacebook = patch.social_facebook
  if (patch.purchase_website !== undefined) brandPatch.purchaseWebsite = patch.purchase_website
  if (patch.purchase_pinkoi !== undefined) brandPatch.purchasePinkoi = patch.purchase_pinkoi
  if (patch.purchase_shopee !== undefined) brandPatch.purchaseShopee = patch.purchase_shopee

  return brandPatch
}

export async function validateLink(url: string, brandName: string): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)

  try {
    const response = await fetch(url, { signal: controller.signal })
    const contentType = response.headers.get('content-type')
    if (!contentType?.startsWith('text/')) return false

    const contentLength = response.headers.get('content-length')
    if (contentLength != null && Number(contentLength) > 1_000_000) return false

    const html = await response.text()
    const normalizedHtml = html.toLowerCase().replace(/\s+/g, ' ')
    const normalizedName = brandName.toLowerCase().replace(/\s+/g, ' ')

    return normalizedHtml.includes(normalizedName)
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

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

export function findBrandsNeedingLinks(brands: BrandWithLinkColumns[]): BrandWithLinkColumns[] {
  return brands.filter((brand) => {
    if (brand.status !== 'approved') {
      return false
    }

    const filledLinkCount = LINK_FIELDS.filter((field) => hasLinkValue(brand[linkColumnFor(field)])).length

    return filledLinkCount < LINK_FIELDS.length
  })
}

export function findBrandsNeedingImages(brands: Brand[]): Brand[] {
  return brands.filter((brand) => {
    if (brand.status !== 'approved') {
      return false
    }

    const productPhotos = Array.isArray(brand.productPhotos) ? brand.productPhotos : []

    return !brand.heroImageUrl || productPhotos.length < 2
  })
}

export function collectPurchaseLinks(brand: Brand): string[] {
  return [
    brand.purchasePinkoi,
    brand.purchaseShopee,
    brand.purchaseWebsite,
  ].filter((url): url is string => Boolean(url))
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
// enrich
// ---------------------------------------------------------------------------

type EnrichOptions = {
  dryRun: boolean
  limit?: number
  targetSlugs?: string[]
  skipSearch: boolean
  validate: boolean
}

async function validateDiscoveredUrls(urls: string[], brandName: string): Promise<string[]> {
  const validUrls: string[] = []

  for (const url of urls) {
    if (await validateLink(url, brandName)) {
      validUrls.push(url)
    }
  }

  return validUrls
}

async function enrich(options: EnrichOptions): Promise<void> {
  console.log('Fetching approved brands...')
  const { brands } = await getBrands({ limit: BRAND_FETCH_LIMIT, status: 'approved' })
  console.log(`Found ${brands.length} approved brands`)

  const brandsWithLinks = brands.map(withFlatLinkColumns)
  const needingLinks = findBrandsNeedingLinks(brandsWithLinks)
  const needingImages = new Set(findBrandsNeedingImages(brands).map((brand) => brand.slug))
  const candidates = brandsWithLinks.filter((brand) => {
    return needingLinks.some((linkBrand) => linkBrand.slug === brand.slug) || needingImages.has(brand.slug)
  })
  const filtered = options.targetSlugs
    ? brandsWithLinks.filter((brand) => options.targetSlugs?.includes(brand.slug))
    : candidates

  if (options.targetSlugs) {
    const found = filtered.map((brand) => brand.slug)
    const missing = options.targetSlugs.filter((s) => !found.includes(s))
    if (missing.length > 0) {
      console.error(`Missing slugs: ${missing.join(', ')}`)
      process.exit(1)
    }
  }

  const ranked = options.limit ? filtered.slice(0, options.limit) : filtered

  const averageCoverage = getAverageLinkCoverage(needingLinks)
  console.log(`Found ${needingLinks.length} brand(s) needing link enrichment`)
  console.log(`Found ${needingImages.size} brand(s) needing image enrichment`)
  console.log(`Average link coverage: ${(averageCoverage * 100).toFixed(1)}%`)
  console.log(`Processing ${ranked.length} brand(s)\n`)

  console.log('Slug                          | Missing Links                 | Known URLs')
  console.log('------------------------------|-------------------------------|-----------')
  for (const brand of ranked) {
    const slug = brand.slug.padEnd(30).slice(0, 30)
    const missing = getMissingLinkFields(brand).join(', ').padEnd(30).slice(0, 30)
    const urlCount = String(collectKnownUrls(brand).length).padStart(9)
    console.log(`${slug}| ${missing}| ${urlCount}`)
  }

  const summary = {
    processed: 0,
    discovered: 0,
    filledByType: Object.fromEntries(LINK_FIELDS.map((field) => [linkColumnFor(field), 0])) as Record<LinkColumn, number>,
    heroesFilled: 0,
    photosAdded: 0,
    skipped: 0,
    errors: [] as Array<{ slug: string; message: string }>,
  }

  for (const brand of ranked) {
    summary.processed++
    const brandName = displayBrandName(brand)
    const knownUrls = collectKnownUrls(brand)
    let discoveredUrls: string[] = []

    if (!options.skipSearch && getMissingLinkFields(brand).length > 0) {
      console.log(`  [DISCOVER] ${brand.slug} → ${brandName}`)
      try {
        const searchUrls = await searchBrandUrls(brandName)
        const newUrls = uniqueUrls(searchUrls.filter((url) => !knownUrls.includes(url)))
        discoveredUrls = options.validate
          ? await validateDiscoveredUrls(newUrls, brandName)
          : newUrls
        summary.discovered += discoveredUrls.length
        console.log(`  [DISCOVER] ${brand.slug}: ${discoveredUrls.length} new URL(s)`)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        summary.errors.push({ slug: brand.slug, message: `discover: ${message}` })
        console.warn(`  [ERROR] ${brand.slug}: discover failed: ${message}`)
      }
      await sleep(SEARCH_DELAY_MS)
    }

    const urls = uniqueUrls([...knownUrls, ...discoveredUrls])

    if (urls.length === 0) {
      console.log(`  [SKIP] ${brand.slug}: no known URLs`)
      summary.skipped++
      await sleep(SCRAPE_DELAY_MS)
      continue
    }

    console.log(`  [LINKS] ${brand.slug} → ${urls.join(', ')}`)

    try {
      const result = await scrapeBrandUrls(urls)
      const scraped = result.data
      const derivedWebsite = scraped.purchaseWebsite ?? deriveOfficialWebsite(urls)
      const enrichedScraped = {
        ...scraped,
        purchaseWebsite: derivedWebsite,
      }
      const patch = buildLinkEnrichPatch(brand, enrichedScraped)

      if (options.validate) {
        for (const [column, url] of Object.entries(patch) as Array<[LinkColumn, string | null | undefined]>) {
          if (url && !(await validateLink(url, brandName))) {
            delete patch[column]
          }
        }
      }

      const enrichedFields = Object.keys(patch) as LinkColumn[]

      if (enrichedFields.length === 0) {
        console.log(`  [LINKS] ${brand.slug}: no new links`)
      } else if (options.dryRun) {
        console.log(`  [DRY RUN] ${brand.slug}: would fill ${enrichedFields.join(', ')}`)
        for (const field of enrichedFields) {
          summary.filledByType[field]++
        }
      } else {
        await updateBrand(brand.id, linkPatchToBrandPatch(patch))

        for (const field of enrichedFields) {
          summary.filledByType[field]++
        }

        console.log(`  [OK] ${brand.slug}: filled ${enrichedFields.length} link field(s)`)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      summary.errors.push({ slug: brand.slug, message: `links: ${message}` })
      console.warn(`  [ERROR] ${brand.slug}: links failed: ${message}`)
    }

    const imageableUrls = urls.filter(isImageableUrl)
    if (imageableUrls.length === 0) {
      console.log(`  [IMAGES] ${brand.slug}: no scrapeable image URLs`)
      summary.skipped++
      await sleep(SCRAPE_DELAY_MS)
      continue
    }

    console.log(`  [IMAGES] ${brand.slug} → ${imageableUrls.join(', ')}`)

    try {
      const { data: scraped } = await scrapeBrandUrls(imageableUrls)
      const imageUrls = [
        scraped.heroImageUrl,
        ...scraped.galleryImageUrls,
      ].filter((url): url is string => Boolean(url))

      if (imageUrls.length === 0) {
        summary.skipped++
        console.log(`  [SKIP] ${brand.slug}: no images found`)
        await sleep(SCRAPE_DELAY_MS)
        continue
      }

      const storedUrls = options.dryRun
        ? imageUrls
        : await downloadAndStoreImages(imageUrls, brand.id)
      const patch = buildImageEnrichPatch(brand, scraped, storedUrls)
      const enrichedFields = Object.keys(patch)

      if (enrichedFields.length === 0) {
        summary.skipped++
        console.log(`  [SKIP] ${brand.slug}: no image gaps to fill`)
        await sleep(SCRAPE_DELAY_MS)
        continue
      }

      const existingProductPhotos = Array.isArray(brand.productPhotos) ? brand.productPhotos : []
      if (options.dryRun) {
        console.log(`  [DRY RUN] ${brand.slug}: would enrich ${enrichedFields.join(', ')}`)
      } else {
        await updateBrand(brand.id, patch)
        console.log(`  [OK] ${brand.slug}: enriched ${enrichedFields.join(', ')}`)
      }

      if (patch.heroImageUrl) {
        summary.heroesFilled++
      }
      if (patch.productPhotos) {
        summary.photosAdded += Math.max(0, patch.productPhotos.length - existingProductPhotos.length)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      summary.errors.push({ slug: brand.slug, message: `images: ${message}` })
      console.warn(`  [ERROR] ${brand.slug}: images failed: ${message}`)
    }

    await sleep(SCRAPE_DELAY_MS)
  }

  console.log('\n--- Summary ---')
  console.log(`Brands processed: ${summary.processed}`)
  console.log(`Discovered URLs: ${summary.discovered}`)
  console.log('Links filled by type:')
  for (const field of LINK_FIELDS) {
    const column = linkColumnFor(field)
    console.log(`  ${column.padEnd(18)} ${summary.filledByType[column]}`)
  }
  console.log(`Heroes filled: ${summary.heroesFilled}`)
  console.log(`Product photos added: ${summary.photosAdded}`)
  console.log(`Skipped: ${summary.skipped}`)
  console.log(`Errors: ${summary.errors.length}`)
  for (const error of summary.errors) {
    console.log(`  ${error.slug}: ${error.message}`)
  }

  if (options.dryRun) {
    console.log('\nDry run — no changes made.')
  }
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
  console.log('  enrich [--dry-run] [--limit N] [--slugs=a,b,c] [--skip-search] [--validate]  Discover links, enrich links, and fill images')
  console.log('  set-visibility <slug1> ...                     Hide all, approve selected')
  console.log('  auto-tag [--dry-run]                           Assign product_type categories via keyword matching')
  console.log('  clean-names [--apply]                          Clean noisy brand names (dry-run by default)')
  console.log('  detect-non-brands [--dry-run] [--output-file=path]  Detect likely non-brand entries')
  console.log('  enrich-descriptions [--dry-run] [--stop-after=N]  Fill missing or weak descriptions from scraped URLs')
  console.log('  normalize-slugs [--dry-run] [--scrape] [--stop-after=N]  Normalize CJK slugs from English names')
}

function parseNumberFlag(args: string[], name: string): number | undefined {
  const equalsArg = args.find((arg) => arg.startsWith(`--${name}=`))
  const flagIndex = args.indexOf(`--${name}`)
  const rawValue = equalsArg
    ? equalsArg.replace(`--${name}=`, '')
    : flagIndex >= 0
      ? args[flagIndex + 1]
      : undefined

  if (!rawValue || rawValue.startsWith('--')) {
    return undefined
  }

  const value = Number.parseInt(rawValue, 10)
  return Number.isNaN(value) ? undefined : value
}

async function main() {
  const command = process.argv[2]
  const args = process.argv.slice(3)

  switch (command) {
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
    case 'enrich': {
      const dryRun = args.includes('--dry-run')
      const slugsArg = args.find((a) => a.startsWith('--slugs='))
      const targetSlugs = slugsArg ? slugsArg.replace('--slugs=', '').split(',') : undefined
      const limit = parseNumberFlag(args, 'limit')
      const validate = args.includes('--validate')
      const skipSearch = args.includes('--skip-search')
      await enrich({ dryRun, limit, targetSlugs, skipSearch, validate })
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
