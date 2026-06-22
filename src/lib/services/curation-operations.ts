import { cleanBrandName } from './brand-cleanup'
import { insertSlugRedirect } from './brands'
import type { BrandFlatLinkColumns } from '@/lib/types'
import type { ScrapedBrandData } from '@/lib/types/scraper'
import {
  buildImageEnrichPatch,
  buildLinkEnrichPatch,
  buildTextEnrichPatch,
  extractLinksFromUrls,
  hasLinkValue,
  LINK_FIELDS,
  linkColumnFor,
} from './link-enrichment'
import { downloadAndStoreImages } from './image-download'
import { rewriteBrandDescription } from './description-rewrite'
import {
  classifyProductTypeBatch,
  triageBrandsBatch,
  type BatchClassificationItem,
  type ClassificationResult,
  type TriageBatchItem,
  type TriageResult,
} from './product-type-classifier'
import { scrapeBrandUrls } from './scraper'
import { classifyByDomain } from './scraper/input-detector'
import { SEARCH_DELAY_MS, batchSearchBrandImages, batchSearchBrandsWithSnippets } from './scraper/search'

export interface CurationConfig {
  dryRun: boolean
  overwrite?: boolean
  slugs?: string[]
  status?: 'pending' | 'approved' | 'rejected' | 'hidden'
  limit?: number
  onProgress?: (msg: string) => void
}

export interface OperationResult {
  processed: number
  updated: number
  skipped: number
  errors: string[]
}

type CurationBrand = {
  id: string
  slug: string
  name?: string
  status?: string | null
  description?: string | null
  product_type?: string | null
  purchase_website?: string | null
  purchaseWebsite?: string | null
  is_non_brand?: boolean | null
  non_brand_reason?: string | null
  value_tags?: string[] | null
}

type AutoTagPatch = Partial<Pick<CurationBrand, 'product_type'>>
type SetVisibilityPatch = Partial<Pick<CurationBrand, 'status'>>
type TriagePatch = Partial<Pick<CurationBrand, 'slug' | 'product_type' | 'is_non_brand' | 'non_brand_reason' | 'value_tags'>>
type NamePatch = Partial<Pick<CurationBrand, 'name'>>
type CurationPatch = NamePatch & AutoTagPatch & SetVisibilityPatch & TriagePatch

type SetVisibilityBrand = Pick<CurationBrand, 'id'> &
  Partial<Pick<CurationBrand, 'status' | 'name' | 'purchase_website' | 'description'>>

type ProcessSetVisibilityResult = {
  visible: boolean
  changed: boolean
  patch?: Pick<SetVisibilityPatch, 'status'>
}

type SupabaseError = {
  message?: string
}

type SupabaseResult<T> = Promise<{
  data: T | null
  error: SupabaseError | null
}>

type BrandsSelectQuery = PromiseLike<{
  data: CurationBrand[] | null
  error: SupabaseError | null
}> & {
  in: (column: 'slug', values: string[]) => BrandsSelectQuery
  eq: (column: 'status', value: string) => BrandsSelectQuery
  is: (column: string, value: null) => BrandsSelectQuery
  or: (filter: string) => BrandsSelectQuery
  limit: (count: number) => BrandsSelectQuery
}

type BrandsUpdateQuery = {
  eq: (column: 'id', value: string) => SupabaseResult<unknown>
}

type BrandsTable = {
  select: (columns: string) => BrandsSelectQuery
  update: (patch: CurationPatch) => BrandsUpdateQuery
}

type SupabaseLike = {
  from: (table: 'brands') => BrandsTable
}

const LEGACY_DISPLAY_NAME_KEY = ['display', 'brand', 'name'].join('_')
const LEGACY_WEBSITE_URL_KEY = ['website', 'url'].join('_')

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

const SCRAPE_DELAY_MS = 1000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function brandName(brand: { name?: string | null }): string {
  const legacyName = (brand as Record<string, unknown>)[LEGACY_DISPLAY_NAME_KEY]
  return brand.name ?? (typeof legacyName === 'string' ? legacyName : '')
}

function purchaseWebsite(brand: { purchase_website?: string | null }): string | null {
  const legacyWebsite = (brand as Record<string, unknown>)[LEGACY_WEBSITE_URL_KEY]
  return brand.purchase_website ?? (typeof legacyWebsite === 'string' ? legacyWebsite : null)
}

export function processSetVisibilityBrand(
  brand: SetVisibilityBrand
): ProcessSetVisibilityResult {
  if (brand.status !== 'approved') {
    return {
      visible: false,
      changed: false,
    }
  }

  const visible =
    Boolean(purchaseWebsite(brand)?.trim()) &&
    Boolean(brand.description && brand.description.length >= 20) &&
    Boolean(brandName(brand).trim())

  if (visible) {
    return {
      visible,
      changed: false,
    }
  }

  return {
    visible,
    changed: true,
    patch: { status: 'hidden' },
  }
}

export async function runSetVisibility(
  config: CurationConfig,
  supabase: SupabaseLike
): Promise<OperationResult> {
  const result: OperationResult = {
    processed: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  }

  let query = supabase
    .from('brands')
    .select('id, slug, status, name, purchase_website, description')

  if (config.slugs && config.slugs.length > 0) {
    query = query.in('slug', config.slugs)
  }

  if (config.limit !== undefined) {
    query = query.limit(config.limit)
  }

  const { data, error } = await query

  if (error) {
    result.errors.push(error.message ?? 'Failed to fetch brands')
    return result
  }

  for (const brand of data ?? []) {
    result.processed += 1
    config.onProgress?.(`Processing ${brand.slug}`)

    try {
      const visibility = processSetVisibilityBrand(brand)

      if (!visibility.changed || !visibility.patch) {
        result.skipped += 1
        continue
      }

      const reasons: string[] = []
      if (!purchaseWebsite(brand)?.trim()) reasons.push('no website')
      if (!brand.description || brand.description.length < 20) reasons.push('no/short description')
      if (!brandName(brand).trim()) reasons.push('no name')
      config.onProgress?.(`  [HIDE] ${brand.slug}: ${reasons.join(', ')}`)

      if (!config.dryRun) {
        const { error: updateError } = await supabase
          .from('brands')
          .update(visibility.patch)
          .eq('id', brand.id)

        if (updateError) {
          result.errors.push(`${brand.slug}: ${updateError.message ?? 'Failed to update brand'}`)
          result.skipped += 1
          continue
        }
      }

      result.updated += 1
    } catch (err) {
      result.errors.push(`${brand.slug}: ${errorMessage(err)}`)
      result.skipped += 1
    }
  }

  return result
}

export const ENRICH_PHASES = [
  'clean',
  'detect',
  'slugs',
  'tags',
  'discover',
  'links',
  'images',
  'descriptions',
] as const

type EnrichPhase = 'clean' | 'links' | 'images' | 'descriptions' | 'tags'
type RunEnrichPhase = EnrichPhase | 'discover' | 'detect' | 'slugs'

type EnrichBrand = CurationBrand &
  Partial<BrandFlatLinkColumns> & {
    brand_highlights?: string | null
    hero_image_url?: string | null
    product_images?: string[] | null
    product_photos?: string[] | null
    heroImageUrl?: string | null
    productPhotos?: string[] | null
  }

type EnrichScrapedData = Partial<ScrapedBrandData> & Partial<BrandFlatLinkColumns> & {
  snippets?: string[]
}

type EnrichImagePatch = Partial<{
  hero_image_url: string | null
  product_photos: string[]
}>

type EnrichCleanPhase = {
  changed: boolean
  original?: string
  cleaned?: string
}

type EnrichDescriptionsPhase = {
  changed: boolean
}

type EnrichProcessPhases = {
  clean?: EnrichCleanPhase
  descriptions?: EnrichDescriptionsPhase
}

type EnrichPatches = {
  clean?: Partial<Pick<CurationBrand, 'name'>>
  links?: Partial<BrandFlatLinkColumns>
  images?: EnrichImagePatch
  descriptions?: Partial<Pick<EnrichBrand, 'description' | 'brand_highlights'>>
  tags?: Partial<Pick<CurationBrand, 'product_type'>>
}

type EnrichPatch = Partial<BrandFlatLinkColumns> &
  EnrichImagePatch &
  Partial<Pick<EnrichBrand, 'description' | 'brand_highlights' | 'product_type' | 'name'>>

type ProcessEnrichResult = {
  phases: EnrichProcessPhases
  patches: EnrichPatches
  patch: EnrichPatch
  hasChanges: boolean
}

function isRequestedPhase(phases: string[], phase: EnrichPhase): boolean {
  return phases.includes(phase)
}

function hasPatchValues(patch: object): boolean {
  return Object.keys(patch).length > 0
}

function uniqueUrls(urls: string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []

  for (const url of urls) {
    const normalized = url.trim()
    if (!normalized || seen.has(normalized)) {
      continue
    }

    seen.add(normalized)
    unique.push(normalized)
  }

  return unique
}

function displayBrandName(brand: EnrichBrand): string {
  return brandName(brand)
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }

  return chunks
}

function collectKnownUrls(brand: EnrichBrand): string[] {
  const linkUrls = LINK_FIELDS
    .map((field) => brand[linkColumnFor(field)])
    .filter((url): url is string => hasLinkValue(url))

  return uniqueUrls(linkUrls)
}

function deriveOfficialWebsite(urls: string[]): string | null {
  return urls.find((url) => classifyByDomain(url) === null) ?? null
}

function normalizeScrapedData(scrapedData: EnrichScrapedData): EnrichScrapedData {
  return {
    ...scrapedData,
    social_instagram: scrapedData.social_instagram ?? scrapedData.socialInstagram,
    social_threads: scrapedData.social_threads ?? scrapedData.socialThreads,
    social_facebook: scrapedData.social_facebook ?? scrapedData.socialFacebook,
    purchase_website: scrapedData.purchase_website ?? scrapedData.purchaseWebsite,
    purchase_pinkoi: scrapedData.purchase_pinkoi ?? scrapedData.purchasePinkoi,
    purchase_shopee: scrapedData.purchase_shopee ?? scrapedData.purchaseShopee,
  }
}

function normalizeImageBrand(brand: EnrichBrand): {
  heroImageUrl: string | null
  productPhotos: string[] | null
} {
  return {
    heroImageUrl: brand.heroImageUrl ?? brand.hero_image_url ?? null,
    productPhotos: brand.productPhotos ?? brand.product_photos ?? brand.product_images ?? [],
  }
}

function imagePatchToDbPatch(
  patch: Partial<{ heroImageUrl: string | null; productPhotos: string[] }>
): EnrichImagePatch {
  const dbPatch: EnrichImagePatch = {}

  if (patch.heroImageUrl !== undefined) {
    dbPatch.hero_image_url = patch.heroImageUrl
  }

  if (patch.productPhotos !== undefined) {
    dbPatch.product_photos = patch.productPhotos
  }

  return dbPatch
}

export function shouldSkipForNonBrand(triageResult: TriageResult | undefined): boolean {
  return Boolean(
    triageResult?.isNonBrand === true &&
    triageResult.confidence === 'high'
  )
}

function buildTriagePatch(
  brand: EnrichBrand,
  triageResult: TriageResult | undefined,
  phases: RunEnrichPhase[]
): TriagePatch {
  const patch: TriagePatch = {}

  if (!triageResult) {
    return patch
  }

  if (phases.includes('detect') && triageResult.isNonBrand) {
    patch.is_non_brand = true
    patch.non_brand_reason = triageResult.nonBrandReason
  }

  if (phases.includes('slugs') && triageResult.slugGenerated && triageResult.slugGenerated !== brand.slug) {
    patch.slug = triageResult.slugGenerated
  }

  if (phases.includes('tags') && triageResult.productType !== null) {
    patch.product_type = triageResult.productType
  }

  if (phases.includes('tags') && triageResult.valueTags.length > 0) {
    patch.value_tags = triageResult.valueTags
  }

  return patch
}

export function processEnrichBrand(
  brand: EnrichBrand,
  scrapedData: EnrichScrapedData,
  phases: string[]
): ProcessEnrichResult {
  const phaseResults: EnrichProcessPhases = {}
  const patches: EnrichPatches = {}
  const normalizedScrapedData = normalizeScrapedData(scrapedData)

  if (isRequestedPhase(phases, 'clean')) {
    const nameCleanup = cleanBrandName(brand.name ?? '')
    phaseResults.clean = nameCleanup.changed
      ? {
          changed: true,
          original: nameCleanup.originalName,
          cleaned: nameCleanup.cleanedName,
        }
      : { changed: false }

    if (nameCleanup.changed) {
      patches.clean = { name: nameCleanup.cleanedName }
    }
  }

  if (isRequestedPhase(phases, 'links')) {
    const links = buildLinkEnrichPatch(brand, normalizedScrapedData)
    if (hasPatchValues(links)) {
      patches.links = links
    }
  }

  if (isRequestedPhase(phases, 'descriptions')) {
    const descriptions = buildTextEnrichPatch(brand, normalizedScrapedData)
    phaseResults.descriptions = { changed: hasPatchValues(descriptions) }
    if (hasPatchValues(descriptions)) {
      patches.descriptions = descriptions
    }
  }

  const patch = mergeEnrichPatches(patches)

  return {
    phases: phaseResults,
    patches,
    patch,
    hasChanges: hasPatchValues(patch),
  }
}

export function mergeEnrichPatches(patches: EnrichPatches): EnrichPatch {
  return {
    ...patches.clean,
    ...patches.links,
    ...patches.images,
    ...patches.descriptions,
    ...patches.tags,
  }
}

export async function runEnrich(
  config: CurationConfig & { phases: string[] },
  supabase: SupabaseLike
): Promise<OperationResult> {
  const result: OperationResult = {
    processed: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  }

  const phases = config.phases as RunEnrichPhase[]
  const enrichDelayMs = phases.includes('discover') ? SEARCH_DELAY_MS : SCRAPE_DELAY_MS
  const includesDiscover = phases.includes('discover')
  let weakBrandCount = 0
  let query = supabase
    .from('brands')
    .select(
      'id, slug, name, status, description, product_type, brand_highlights, social_instagram, social_threads, social_facebook, purchase_website, purchase_pinkoi, purchase_shopee, hero_image_url, product_photos'
    )

  if (config.slugs && config.slugs.length > 0) {
    query = query.in('slug', config.slugs)
  }

  if (config.status) {
    query = query.eq('status', config.status)
  }

  if (!config.overwrite) {
    query = query.or('serp_enriched_at.is.null,images_enriched_at.is.null,tags_enriched_at.is.null')
  }

  if (config.limit !== undefined) {
    query = query.limit(config.limit)
  }

  const { data, error } = await query

  if (error) {
    result.errors.push(error.message ?? 'Failed to fetch brands')
    return result
  }

  const allBrands = (data ?? []) as EnrichBrand[]
  const totalBrands = allBrands.length
  config.onProgress?.(`[ENRICH] ${totalBrands} brands to process in ${Math.ceil(totalBrands / 20)} batches`)
  const brandChunks = chunkItems(allBrands, 20)

  for (let chunkIndex = 0; chunkIndex < brandChunks.length; chunkIndex += 1) {
    if (chunkIndex > 0) {
      await delay(enrichDelayMs)
    }

    const chunk = brandChunks[chunkIndex]
    const hasTriagePhases = phases.includes('detect') || phases.includes('slugs') || phases.includes('tags')
    const activeSteps = [
      phases.includes('discover') && 'SERP',
      phases.includes('images') && 'images',
      hasTriagePhases && 'triage',
      phases.includes('tags') && !phases.includes('descriptions') && 'tags',
      phases.includes('descriptions') && phases.includes('tags') && 'descriptions+tags',
      phases.includes('descriptions') && !phases.includes('tags') && 'descriptions',
    ].filter(Boolean)
    config.onProgress?.(`\n[BATCH ${chunkIndex + 1}/${brandChunks.length}] ${chunk.length} brands — fetching ${activeSteps.join(' + ')}...`)

    let searchResults = new Map<string, { urls: string[], snippets: string[] }>()
    let imageSearchResults = new Map<string, string[]>()
    let batchClassifications = new Map<string, ClassificationResult>()
    let searchError: string | null = null
    let triageResults = new Map<string, TriageResult>()

    const chunkBrandNames = chunk.map(displayBrandName)

    if (phases.includes('discover') && chunk.length > 0) {
      try {
        searchResults = await batchSearchBrandsWithSnippets(chunkBrandNames)
        config.onProgress?.(`  [SERP] OK — ${searchResults.size} results`)
      } catch (err) {
        searchError = errorMessage(err)
        config.onProgress?.(`  [SERP] FAILED — ${searchError}`)
      }
    }

    if (phases.includes('images') && chunk.length > 0) {
      imageSearchResults = await batchSearchBrandImages(chunkBrandNames, 5)
      const totalImages = [...imageSearchResults.values()].reduce((sum, urls) => sum + urls.length, 0)
      config.onProgress?.(`  [IMAGES] OK — ${totalImages} images across ${imageSearchResults.size} brands`)
    }

    if (hasTriagePhases) {
      const triageItems: TriageBatchItem[] = chunk.map((brand) => ({
        slug: brand.slug,
        name: displayBrandName(brand),
        description: brand.description ?? null,
        website: brand.purchase_website ?? null,
        snippets: searchResults.get(displayBrandName(brand))?.snippets ?? [],
      }))
      triageResults = await triageBrandsBatch(triageItems)
      const nonBrandCount = [...triageResults.values()].filter((result) => result.isNonBrand).length
      console.log(`Triage: ${triageResults.size} brands processed, ${nonBrandCount} non-brands detected`)
      config.onProgress?.(`  [TRIAGE] OK — ${triageResults.size} results, ${nonBrandCount} non-brands`)
    }

    const enrichmentChunk = chunk.filter((brand) => !shouldSkipForNonBrand(triageResults.get(brand.slug)))

    if (phases.includes('tags') && !phases.includes('descriptions') && !hasTriagePhases && enrichmentChunk.length > 0) {
      const classifyItems: BatchClassificationItem[] = enrichmentChunk.map((brand) => ({
        slug: brand.slug,
        name: displayBrandName(brand),
        description: brand.description ?? null,
      }))
      batchClassifications = await classifyProductTypeBatch(classifyItems)
      config.onProgress?.(`  [TAGS] OK — ${batchClassifications.size} classifications`)
    }

    for (const brand of chunk) {
      result.processed += 1
      config.onProgress?.(`Processing ${brand.slug} (${result.processed}/${totalBrands})`)

      try {
        const triageResult = triageResults.get(brand.slug)
        const triagePatch = buildTriagePatch(brand, triageResult, phases)
        const triageSlug = triagePatch.slug

        if (shouldSkipForNonBrand(triageResult)) {
          config.onProgress?.(`  [NON-BRAND] ${brand.slug}: ${triageResult?.nonBrandReason ?? 'non-brand'} (${triageResult?.confidence})`)

          if (hasPatchValues(triagePatch)) {
            if (!config.dryRun) {
              const { error: updateError } = await supabase
                .from('brands')
                .update(triagePatch)
                .eq('id', brand.id)

              if (updateError) {
                result.errors.push(`${brand.slug}: ${updateError.message ?? 'Failed to update brand'}`)
                result.skipped += 1
                continue
              }

              if (triageSlug) {
                await insertSlugRedirect(brand.slug, triageSlug)
              }
            }

            result.updated += 1
          }

          result.skipped += 1
          continue
        }

        if (searchError) {
          throw new Error(searchError)
        }

        const knownUrls = collectKnownUrls(brand)
        let discoveredUrls: string[] = []
        let serpSnippets: string[] = []

        if (phases.includes('discover')) {
          const searchResult = searchResults.get(displayBrandName(brand)) ?? { urls: [], snippets: [] }
          discoveredUrls = uniqueUrls(
            searchResult.urls.filter((url) => !knownUrls.includes(url))
          )
          serpSnippets = searchResult.snippets
        }

        const urls = uniqueUrls([...knownUrls, ...discoveredUrls])
        const urlExtracted = extractLinksFromUrls(discoveredUrls)
        let imageSearchUrls: string[] = []
        if (phases.includes('images')) {
          imageSearchUrls = imageSearchResults.get(displayBrandName(brand)) ?? []
          config.onProgress?.(`  [IMAGE-SEARCH] ${imageSearchUrls.length} images found`)
        }

        if (
          !phases.includes('tags') &&
          urls.length === 0 &&
          !hasPatchValues(urlExtracted) &&
          imageSearchUrls.length === 0
        ) {
          if (includesDiscover && discoveredUrls.length <= 1) {
            weakBrandCount += 1
            config.onProgress?.(`  [WEAK-BRAND] ${brand.slug}: no useful data found (${discoveredUrls.length} search results, nothing to scrape)`)
          }
          result.skipped += 1
          continue
        }

        const { data: scraped } = urls.length > 0
          ? await scrapeBrandUrls(urls)
          : { data: {} as EnrichScrapedData }
        const derivedWebsite = scraped.purchaseWebsite ?? deriveOfficialWebsite(urls)
        const enrichedScraped: EnrichScrapedData = {
          ...scraped,
          ...urlExtracted,
          purchaseWebsite: derivedWebsite,
        }

        let imageStoredUrls: Array<string | null> = []
        if (imageSearchUrls.length > 0) {
          imageStoredUrls = config.dryRun
            ? imageSearchUrls
            : await downloadAndStoreImages(imageSearchUrls, brand.id)
        }

        const enrich = processEnrichBrand(brand, enrichedScraped, config.phases)
        const imagePatch = imageStoredUrls.filter(hasLinkValue).length > 0
          ? imagePatchToDbPatch(buildImageEnrichPatch(normalizeImageBrand(brand), imageStoredUrls))
          : {}

        let descriptionRewrite: string | null = null
        let classification: ClassificationResult | null = null
        if (phases.includes('descriptions') && serpSnippets.length > 0) {
          descriptionRewrite = await rewriteBrandDescription(displayBrandName(brand), brand.description ?? null, serpSnippets)
        } else if (phases.includes('tags')) {
          classification = batchClassifications.get(brand.slug) ?? null
        }

        if (classification && classification.productType !== brand.product_type) {
          enrich.patches.tags = { product_type: classification.productType }
          config.onProgress?.(`  [TAG] ${brand.slug}: ${brand.product_type ?? 'null'} → ${classification.productType} (${classification.confidence})`)
        } else if (classification) {
          config.onProgress?.(`  [TAG] ${brand.slug}: ${brand.product_type} (unchanged)`)
        }

        if (descriptionRewrite) {
          config.onProgress?.(`  [REWRITE] description: ${descriptionRewrite}`)
        }

        const patch = {
          ...triagePatch,
          ...mergeEnrichPatches(enrich.patches),
          ...imagePatch,
          ...(descriptionRewrite ? { description: descriptionRewrite } : {}),
        }

        if (includesDiscover) {
          config.onProgress?.(`  [DISCOVER] ${discoveredUrls.length} new URLs found`)
        }
        const patchKeys = Object.keys(patch)
        if (patchKeys.length > 0) {
          for (const key of patchKeys) {
            const val = (patch as Record<string, unknown>)[key]
            const display = Array.isArray(val) ? `[${val.length} items]` : typeof val === 'string' && val.length > 60 ? `${val.slice(0, 60)}…` : val
            config.onProgress?.(`  [ENRICH] ${key}: ${display}`)
          }
        }

        const hasCompletedTagClassification = phases.includes('tags') && classification !== null

        if (!hasPatchValues(patch) && !hasCompletedTagClassification) {
          if (includesDiscover && discoveredUrls.length <= 1) {
            weakBrandCount += 1
            config.onProgress?.(`  [WEAK-BRAND] ${brand.slug}: no useful data found (${discoveredUrls.length} search results, no enrichment changes)`)
          }
          result.skipped += 1
          continue
        }

        if (!config.dryRun) {
          const now = new Date().toISOString()
          const timestamps: Record<string, string> = {}
          if (phases.includes('discover') || phases.includes('links') || phases.includes('descriptions')) {
            timestamps.serp_enriched_at = now
          }
          if (phases.includes('images')) {
            timestamps.images_enriched_at = now
          }
          if (phases.includes('tags')) {
            timestamps.tags_enriched_at = now
          }
          const { error: updateError } = await supabase
            .from('brands')
            .update({ ...patch, ...timestamps } as unknown as CurationPatch)
            .eq('id', brand.id)

          if (updateError) {
            result.errors.push(`${brand.slug}: ${updateError.message ?? 'Failed to update brand'}`)
            result.skipped += 1
            continue
          }

          if (triageSlug) {
            await insertSlugRedirect(brand.slug, triageSlug)
          }
        }

        result.updated += 1
      } catch (err) {
        result.errors.push(`${brand.slug}: ${errorMessage(err)}`)
        result.skipped += 1
      }
    }

    config.onProgress?.(`[PROGRESS] ${result.processed}/${totalBrands} processed | ${result.updated} updated | ${result.skipped} skipped | ${result.errors.length} errors`)
  }

  if (weakBrandCount > 0) {
    config.onProgress?.(`\n[WEAK-BRAND SUMMARY] ${weakBrandCount} brand(s) had no useful search results — review for potential non-brands`)
  }

  return result
}
