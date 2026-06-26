import type { SupabaseClient } from '@supabase/supabase-js'
import { cleanBrandName } from './brand-cleanup'
import { insertSlugRedirect } from './brands'
import type { BrandFlatLinkColumns } from '@/lib/types'
import type { ScrapedBrandData } from '@/lib/types/scraper'
import { ENRICH_PHASES } from '@/lib/constants/enrich-phases'
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
import { insertSearchResult, getLatestSearchResults } from './search-results'
import { insertTriageResult, insertDescriptionResult } from './ai-results'
import { createServiceClient } from '@/lib/supabase/server'
import type { BrandOutcome, CurationConfig, OperationResult } from '@/lib/types/curation'

export type { BrandOutcome, CurationConfig, OperationResult }

type CurationBrand = {
  id: string
  slug: string
  name?: string
  status?: string | null
  description?: string | null
  product_type?: string | null
  purchase_website?: string | null
  purchaseWebsite?: string | null
  tag_slugs?: string[] | null
}

type AutoTagPatch = Partial<Pick<CurationBrand, 'product_type'>>
type TriagePatch = Partial<Pick<CurationBrand, 'slug' | 'product_type' | 'tag_slugs'>>
type NamePatch = Partial<Pick<CurationBrand, 'name'>>
type CurationPatch = NamePatch & AutoTagPatch & TriagePatch

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

type JsonObject = Record<string, unknown>

const LEGACY_DISPLAY_NAME_KEY = ['display', 'brand', 'name'].join('_')

type SubmissionEnrichmentMergeClient = SupabaseClient & {
  rpc: (
    fn: 'merge_brand_submission_enriched_data',
    args: { p_submission_id: string; p_patch: JsonObject }
  ) => SupabaseResult<unknown>
}

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

export { ENRICH_PHASES }

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

type SubmissionEnrichmentRow = {
  id: string
  brand_name: string
  description: string | null
  website_url: string | null
  social_instagram: string | null
  social_threads: string | null
  social_facebook: string | null
  purchase_website: string | null
  purchase_pinkoi: string | null
  purchase_shopee: string | null
  other_urls: unknown
  enriched_data: unknown
  status: string
  brand_id: string | null
}

type BuildEnrichmentPatchOptions = {
  brand: EnrichBrand
  phases: RunEnrichPhase[]
  knownUrls?: string[]
  discoveredUrls?: string[]
  serpSnippets?: string[]
  imageSearchUrls?: string[]
  classification?: ClassificationResult | null
  dryRun: boolean
  imageStorageId: string
  onProgress?: (message: string) => void
}

function isRequestedPhase(phases: string[], phase: EnrichPhase): boolean {
  return phases.includes(phase)
}

function hasPatchValues(patch: object): boolean {
  return Object.keys(patch).length > 0
}

function isPlainObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function mergeProductPhotos(existing: unknown[], incoming: unknown[]): unknown[] {
  const merged: unknown[] = []
  const seenUrls = new Set<string>()

  for (const photo of [...existing, ...incoming]) {
    if (!isPlainObject(photo) || typeof photo.url !== 'string') {
      merged.push(photo)
      continue
    }

    if (seenUrls.has(photo.url)) {
      continue
    }

    seenUrls.add(photo.url)
    merged.push(photo)
  }

  return merged
}

function deepMergeJsonObjects(base: JsonObject, patch: JsonObject): JsonObject {
  const merged: JsonObject = { ...base }

  for (const [key, value] of Object.entries(patch)) {
    const existing = merged[key]
    if (Array.isArray(existing) && Array.isArray(value)) {
      merged[key] = key === 'product_photos'
        ? mergeProductPhotos(existing, value)
        : [...new Set([...existing, ...value])]
      continue
    }

    merged[key] = isPlainObject(existing) && isPlainObject(value)
      ? deepMergeJsonObjects(existing, value)
      : value
  }

  return merged
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

function collectOtherUrls(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((entry) => isPlainObject(entry) ? entry.url : null)
    .filter((url): url is string => typeof url === 'string' && url.trim() !== '')
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

  const KEBAB_CASE_RE = /^[a-z0-9]+(-[a-z0-9]+)+$/
  if (
    phases.includes('slugs') &&
    triageResult.slugGenerated &&
    triageResult.slugGenerated !== brand.slug &&
    KEBAB_CASE_RE.test(triageResult.slugGenerated)
  ) {
    patch.slug = triageResult.slugGenerated
  }

  if (phases.includes('tags') && triageResult.productType !== null) {
    patch.product_type = triageResult.productType
  }

  if (phases.includes('tags') && triageResult.valueTags.length > 0) {
    patch.tag_slugs = triageResult.valueTags
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

async function buildEnrichmentPatchFromBrandInput({
  brand,
  phases,
  knownUrls = collectKnownUrls(brand),
  discoveredUrls = [],
  serpSnippets = [],
  imageSearchUrls = [],
  classification = null,
  dryRun,
  imageStorageId,
  onProgress,
}: BuildEnrichmentPatchOptions): Promise<{
  patch: EnrichPatch
  hasCompletedTagClassification: boolean
  descriptionRewrite: string | null
}> {
  const urls = uniqueUrls([...knownUrls, ...discoveredUrls])
  const urlExtracted = extractLinksFromUrls(discoveredUrls)
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
    imageStoredUrls = dryRun
      ? imageSearchUrls
      : await downloadAndStoreImages(imageSearchUrls, imageStorageId)
  }

  const enrich = processEnrichBrand(brand, enrichedScraped, phases)
  const imagePatch = imageStoredUrls.filter(hasLinkValue).length > 0
    ? imagePatchToDbPatch(buildImageEnrichPatch(normalizeImageBrand(brand), imageStoredUrls))
    : {}

  let descriptionRewrite: string | null = null
  if (phases.includes('descriptions') && serpSnippets.length > 0) {
    descriptionRewrite = await rewriteBrandDescription(displayBrandName(brand), brand.description ?? null, serpSnippets)
  }

  if (classification && classification.productType !== brand.product_type) {
    enrich.patches.tags = { product_type: classification.productType }
    onProgress?.(`  [TAG] ${brand.slug}: ${brand.product_type ?? 'null'} → ${classification.productType} (${classification.confidence})`)
  } else if (classification) {
    onProgress?.(`  [TAG] ${brand.slug}: ${brand.product_type} (unchanged)`)
  }

  if (descriptionRewrite) {
    onProgress?.(`  [REWRITE] description: ${descriptionRewrite}`)
  }

  return {
    patch: {
      ...mergeEnrichPatches(enrich.patches),
      ...imagePatch,
      ...(descriptionRewrite ? { description: descriptionRewrite } : {}),
    },
    hasCompletedTagClassification: phases.includes('tags') && classification !== null,
    descriptionRewrite,
  }
}

async function persistSubmissionEnrichmentResults(
  supabase: SupabaseClient,
  submissionId: string,
  patch: JsonObject
): Promise<void> {
  const normalizedPatch = deepMergeJsonObjects({}, patch)
  const { error: updateError } = await (supabase as SubmissionEnrichmentMergeClient).rpc(
    'merge_brand_submission_enriched_data',
    {
      p_submission_id: submissionId,
      p_patch: normalizedPatch,
    }
  )

  if (updateError) {
    throw new Error(updateError.message ?? 'Failed to update brand submission enrichment')
  }
}

function submissionToEnrichBrand(submission: SubmissionEnrichmentRow): EnrichBrand {
  const existing = isPlainObject(submission.enriched_data) ? submission.enriched_data : {}

  return {
    id: submission.id,
    slug: `submission-${submission.id}`,
    name: typeof existing.name === 'string' ? existing.name : submission.brand_name,
    status: submission.status,
    description: typeof existing.description === 'string' ? existing.description : submission.description,
    product_type: typeof existing.product_type === 'string' ? existing.product_type : null,
    brand_highlights: typeof existing.brand_highlights === 'string' ? existing.brand_highlights : null,
    social_instagram: typeof existing.social_instagram === 'string' ? existing.social_instagram : submission.social_instagram,
    social_threads: typeof existing.social_threads === 'string' ? existing.social_threads : submission.social_threads,
    social_facebook: typeof existing.social_facebook === 'string' ? existing.social_facebook : submission.social_facebook,
    purchase_website: typeof existing.purchase_website === 'string'
      ? existing.purchase_website
      : submission.purchase_website ?? submission.website_url,
    purchase_pinkoi: typeof existing.purchase_pinkoi === 'string' ? existing.purchase_pinkoi : submission.purchase_pinkoi,
    purchase_shopee: typeof existing.purchase_shopee === 'string' ? existing.purchase_shopee : submission.purchase_shopee,
    hero_image_url: typeof existing.hero_image_url === 'string' ? existing.hero_image_url : null,
    product_photos: Array.isArray(existing.product_photos)
      ? existing.product_photos.filter((url): url is string => typeof url === 'string')
      : [],
  }
}

export async function enrichSubmission(
  supabase: SupabaseClient,
  submissionId: string
): Promise<void> {
  const { data, error } = await supabase
    .from('brand_submissions')
    .select(
      'id, brand_id, brand_name, status, description, website_url, social_instagram, social_threads, social_facebook, purchase_website, purchase_pinkoi, purchase_shopee, other_urls, enriched_data'
    )
    .eq('id', submissionId)
    .single()

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to fetch brand submission')
  }

  const submission = data as SubmissionEnrichmentRow
  if (submission.status !== 'pending') {
    throw new Error('Cannot enrich non-pending submission')
  }

  const phases = [...ENRICH_PHASES] as RunEnrichPhase[]
  const brand = submissionToEnrichBrand(submission)
  const brandDisplayName = displayBrandName(brand)
  const searchResults = await batchSearchBrandsWithSnippets([brandDisplayName])
  const searchResult = searchResults.get(brandDisplayName) ?? { urls: [], snippets: [] }
  const imageSearchResults = await batchSearchBrandImages([brandDisplayName], 5)
  const triageResults = await triageBrandsBatch([{
    slug: brand.slug,
    name: brandDisplayName,
    description: brand.description ?? null,
    website: brand.purchase_website ?? null,
    snippets: searchResult.snippets,
  }])
  const triageResult = triageResults.get(brand.slug)

  if (shouldSkipForNonBrand(triageResult)) {
    await persistSubmissionEnrichmentResults(supabase, submissionId, {
      name: brandDisplayName,
      tag_slugs: triageResult?.valueTags ?? [],
    })
    return
  }

  const knownUrls = uniqueUrls([
    ...collectKnownUrls(brand),
    ...collectOtherUrls(submission.other_urls),
    ...(hasLinkValue(submission.website_url) ? [submission.website_url] : []),
  ])
  const discoveredUrls = uniqueUrls(searchResult.urls.filter((url) => !knownUrls.includes(url)))
  const classification = triageResult?.productType
    ? {
        productType: triageResult.productType,
        confidence: triageResult.confidence,
      } as ClassificationResult
    : null
  const { patch } = await buildEnrichmentPatchFromBrandInput({
    brand,
    phases,
    knownUrls,
    discoveredUrls,
    serpSnippets: searchResult.snippets,
    imageSearchUrls: imageSearchResults.get(brandDisplayName) ?? [],
    classification,
    dryRun: false,
    imageStorageId: submissionId,
  })
  const triagePatch = buildTriagePatch(brand, triageResult, phases)
  const submissionPatch = {
    name: brandDisplayName,
    ...patch,
    ...(triagePatch.product_type ? { product_type: triagePatch.product_type } : {}),
    ...(triagePatch.tag_slugs ? { tag_slugs: triagePatch.tag_slugs } : {}),
  }

  await persistSubmissionEnrichmentResults(
    supabase,
    submissionId,
    submissionPatch
  )
}

export async function persistEnrichmentResults(
  supabase: SupabaseClient,
  brandId: string,
  patch: JsonObject
): Promise<void> {
  const { error: updateError } = await supabase
    .from('brands')
    .update({
      ...patch,
      brand_enriched_at: new Date().toISOString(),
    } as never)
    .eq('id', brandId)

  if (updateError) {
    throw new Error(updateError.message ?? 'Failed to update brand')
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
    brandOutcomes: [],
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
    query = query.or('serp_enriched_at.is.null,images_enriched_at.is.null,brand_enriched_at.is.null')
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

    let searchResults = new Map<string, { urls: string[], snippets: string[], rawEntries?: unknown[] }>()
    let imageSearchResults = new Map<string, string[]>()
    let batchClassifications = new Map<string, ClassificationResult>()
    let searchError: string | null = null
    let triageResults = new Map<string, TriageResult>()

    const chunkBrandNames = chunk.map(displayBrandName)

    if (phases.includes('discover') && chunk.length > 0) {
      try {
        searchResults = await batchSearchBrandsWithSnippets(chunkBrandNames)
        const serpHits = [...searchResults.values()].filter(r => r.snippets.length > 0 || r.urls.length > 0).length
        const serpMisses = searchResults.size - serpHits
        config.onProgress?.(`  [SERP] OK — ${serpHits}/${searchResults.size} brands with results${serpMisses > 0 ? ` (${serpMisses} empty)` : ''}`)
        if (!config.dryRun) {
          const serpBrandIds: string[] = []
          for (const brand of chunk) {
            const brandName = displayBrandName(brand)
            const result = searchResults.get(brandName)
            if (result && (result.urls.length > 0 || result.snippets.length > 0)) {
              await insertSearchResult(brand.id, 'serp', `${brandName} 台灣`, result.urls, result.snippets, result.rawEntries)
              serpBrandIds.push(brand.id)
            }
          }
          const serpNow = new Date().toISOString()
          for (const id of serpBrandIds) {
            await supabase.from('brands').update({ serp_enriched_at: serpNow } as never).eq('id', id)
          }
        }
      } catch (err) {
        searchError = errorMessage(err)
        config.onProgress?.(`  [SERP] FAILED — ${searchError}`)
      }
    }

    if (phases.includes('images') && chunk.length > 0) {
      imageSearchResults = await batchSearchBrandImages(chunkBrandNames, 5)
      const totalImages = [...imageSearchResults.values()].reduce((sum, urls) => sum + urls.length, 0)
      config.onProgress?.(`  [IMAGES] OK — ${totalImages} images across ${imageSearchResults.size} brands`)
      if (!config.dryRun) {
        const imageBrandIds: string[] = []
        for (const brand of chunk) {
          const brandName = displayBrandName(brand)
          const images = imageSearchResults.get(brandName)
          if (images && images.length > 0) {
            await insertSearchResult(brand.id, 'image', `${brandName} 台灣`, images, [])
            imageBrandIds.push(brand.id)
          }
        }
        const imgNow = new Date().toISOString()
        for (const id of imageBrandIds) {
          await supabase.from('brands').update({ images_enriched_at: imgNow } as never).eq('id', id)
        }
      }
    }

    if (!phases.includes('discover') && hasTriagePhases) {
      const brandIds = chunk.map(b => b.id)
      const cached = await getLatestSearchResults(brandIds, 'serp')
      for (const brand of chunk) {
        const row = cached.get(brand.id)
        if (row) {
          searchResults.set(displayBrandName(brand), { urls: row.urls, snippets: row.snippets })
        }
      }
      const cachedCount = [...searchResults.values()].filter(r => r.snippets.length > 0).length
      if (cachedCount > 0) {
        config.onProgress?.(`  [SERP-CACHE] Loaded ${cachedCount} cached snippet sets`)
      }
    }

    if (hasTriagePhases) {
      const triageItems: TriageBatchItem[] = chunk.map((brand, index) => ({
        slug: brand.slug,
        name: chunkBrandNames[index],
        description: brand.description ?? null,
        website: brand.purchase_website ?? null,
        snippets: searchResults.get(chunkBrandNames[index])?.snippets ?? [],
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
        let triageSlug = triagePatch.slug

        if (triageSlug && !config.dryRun) {
          const svc = createServiceClient()
          const { data: slugOwner } = await svc
            .from('brands')
            .select('id')
            .eq('slug', triageSlug)
            .neq('id', brand.id)
            .maybeSingle()
          if (slugOwner) {
            config.onProgress?.(`  [SLUG-CONFLICT] "${triageSlug}" already taken — keeping original slug`)
            delete triagePatch.slug
            triageSlug = undefined
          }
        }

        if (shouldSkipForNonBrand(triageResult)) {
          config.onProgress?.(`  [NON-BRAND] ${brand.slug}: ${triageResult?.nonBrandReason ?? 'non-brand'} (${triageResult?.confidence})`)

          if (!config.dryRun) {
            await insertTriageResult({
              brandId: brand.id,
              isNonBrand: true,
              nonBrandReason: triageResult?.nonBrandReason ?? null,
              slugGenerated: triageResult?.slugGenerated ?? null,
              productType: triageResult?.productType ?? null,
              confidence: triageResult?.confidence ?? 'high',
              valueTags: triageResult?.valueTags ?? [],
              rawResponse: triageResult,
            })
            await supabase.from('brands').update({
              status: 'hidden',
              brand_enriched_at: new Date().toISOString(),
            } as never).eq('id', brand.id)
          }

          result.brandOutcomes.push({ slug: brand.slug, name: brandName(brand), status: 'skipped', changedFields: [] })
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

        const urlExtracted = extractLinksFromUrls(discoveredUrls)
        let imageSearchUrls: string[] = []
        if (phases.includes('images')) {
          imageSearchUrls = imageSearchResults.get(displayBrandName(brand)) ?? []
          config.onProgress?.(`  [IMAGE-SEARCH] ${imageSearchUrls.length} images found`)
        }

        if (
          !phases.includes('tags') &&
          uniqueUrls([...knownUrls, ...discoveredUrls]).length === 0 &&
          !hasPatchValues(urlExtracted) &&
          imageSearchUrls.length === 0
        ) {
          if (includesDiscover && discoveredUrls.length <= 1) {
            weakBrandCount += 1
            config.onProgress?.(`  [WEAK-BRAND] ${brand.slug}: no useful data found (${discoveredUrls.length} search results, nothing to scrape)`)
          }
          result.brandOutcomes.push({ slug: brand.slug, name: brandName(brand), status: 'skipped', changedFields: [] })
          result.skipped += 1
          continue
        }

        let classification: ClassificationResult | null = null
        if (!(phases.includes('descriptions') && serpSnippets.length > 0) && phases.includes('tags')) {
          classification = batchClassifications.get(brand.slug) ?? null
        }

        const enrichment = await buildEnrichmentPatchFromBrandInput({
          brand,
          phases,
          knownUrls,
          discoveredUrls,
          serpSnippets,
          imageSearchUrls,
          classification,
          dryRun: config.dryRun,
          imageStorageId: brand.id,
          onProgress: config.onProgress,
        })
        const patch = {
          ...triagePatch,
          ...enrichment.patch,
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

        if (!hasPatchValues(patch) && !enrichment.hasCompletedTagClassification) {
          if (includesDiscover && discoveredUrls.length <= 1) {
            weakBrandCount += 1
            config.onProgress?.(`  [WEAK-BRAND] ${brand.slug}: no useful data found (${discoveredUrls.length} search results, no enrichment changes)`)
          }
          result.brandOutcomes.push({ slug: brand.slug, name: brandName(brand), status: 'skipped', changedFields: [] })
          result.skipped += 1
          continue
        }

        if (!config.dryRun) {
          if (triageResult) {
            await insertTriageResult({
              brandId: brand.id,
              isNonBrand: false,
              nonBrandReason: null,
              slugGenerated: triageResult.slugGenerated,
              productType: triageResult.productType,
              confidence: triageResult.confidence,
              valueTags: triageResult.valueTags,
              rawResponse: triageResult,
            })
          }
          if (enrichment.descriptionRewrite) {
            await insertDescriptionResult({
              brandId: brand.id,
              description: enrichment.descriptionRewrite,
              rawResponse: { description: enrichment.descriptionRewrite },
            })
          }
          try {
            await persistEnrichmentResults(
              supabase as unknown as SupabaseClient,
              brand.id,
              patch as JsonObject
            )
          } catch (err) {
            const errMsg = errorMessage(err)
            result.errors.push(`${brand.slug}: ${errMsg}`)
            result.brandOutcomes.push({ slug: brand.slug, name: brandName(brand), status: 'failed', changedFields: [], error: errMsg })
            result.skipped += 1
            continue
          }

          if (triageSlug) {
            await insertSlugRedirect(brand.slug, triageSlug)
          }
        }

        result.brandOutcomes.push({ slug: brand.slug, name: brandName(brand), status: 'succeeded', changedFields: patchKeys })
        result.updated += 1
      } catch (err) {
        const errMsg = errorMessage(err)
        result.errors.push(`${brand.slug}: ${errMsg}`)
        result.brandOutcomes.push({ slug: brand.slug, name: brandName(brand), status: 'failed', changedFields: [], error: errMsg })
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
