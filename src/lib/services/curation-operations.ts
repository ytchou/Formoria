import type { SupabaseClient } from '@supabase/supabase-js'
import { cleanBrandName } from './brand-cleanup'
import { insertSlugRedirect } from './brands'
import type { BrandFlatLinkColumns } from '@/lib/types'
import type { ScrapedBrandData } from '@/lib/types/scraper'
import { ENRICH_PHASES } from '@/lib/constants/enrich-phases'
import {
  buildLinkEnrichPatch,
  buildTextEnrichPatch,
  extractLinksFromUrls,
  hasLinkValue,
  LINK_FIELDS,
  linkColumnFor,
} from './link-enrichment'
import {
  triageBrandsBatch,
  type ClassificationResult,
  type TriageResult,
} from './product-type-classifier'
import { SEARCH_DELAY_MS, batchSearchBrandImages, batchSearchBrandsWithSnippets } from './scraper/search'
import { insertTriageResult, insertDescriptionResult } from './ai-results'
import { createServiceClient } from '@/lib/supabase/server'
import type { BrandOutcome, CurationConfig, OperationResult, PhaseResult } from '@/lib/types/curation'
import {
  applyTriageResult,
  buildPhaseResult,
  loadCachedSearchResults,
  runBrandImagePhase,
  runCleanPhase,
  runDescriptionsPhase,
  runDiscoverPhase,
  runImageSearchPhase,
  runLinksPhase,
  runStandaloneClassification,
  runTriagePhase,
  type BrandEnrichState,
  type SearchPhaseResult,
} from './enrich-phases'

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

function changedFieldsFromPhaseResults(phaseResults: PhaseResult[]): string[] {
  return [...new Set(phaseResults.flatMap((phaseResult) => phaseResult.changedFields))]
}

function appendPatch(state: BrandEnrichState, patch: Record<string, unknown>): void {
  Object.assign(state.patches, patch)
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
  const linksResult = await runLinksPhase({
    brand,
    phases,
    discoveredUrls,
    knownUrls,
    supabase: null,
  })
  const imageResult = await runBrandImagePhase({
    brand,
    phases,
    imageSearchUrls,
    supabase: null,
    dryRun,
    imageStorageId,
  })
  const descriptionsResult = await runDescriptionsPhase({
    brand,
    phases,
    scrapedData: linksResult.scrapedData,
    serpSnippets,
  })
  const patches: EnrichPatches = {
    links: linksResult.patch as Partial<BrandFlatLinkColumns>,
    images: imageResult.patch as EnrichImagePatch,
    descriptions: descriptionsResult.patch as Partial<Pick<EnrichBrand, 'description' | 'brand_highlights'>>,
  }

  if (classification && classification.productType !== brand.product_type) {
    patches.tags = { product_type: classification.productType }
    onProgress?.(`  [TAG] ${brand.slug}: ${brand.product_type ?? 'null'} → ${classification.productType} (${classification.confidence})`)
  } else if (classification) {
    onProgress?.(`  [TAG] ${brand.slug}: ${brand.product_type} (unchanged)`)
  }

  if (descriptionsResult.descriptionRewrite) {
    onProgress?.(`  [REWRITE] description: ${descriptionsResult.descriptionRewrite}`)
  }

  return {
    patch: mergeEnrichPatches(patches),
    hasCompletedTagClassification: phases.includes('tags') && classification !== null,
    descriptionRewrite: descriptionsResult.descriptionRewrite,
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

    const chunkBrandNames = chunk.map(displayBrandName)
    const batchContext = {
      chunk,
      chunkBrandNames,
      phases,
      dryRun: config.dryRun,
      onProgress: config.onProgress,
      supabase: supabase as unknown as SupabaseClient,
    }

    const discoverResult = await runDiscoverPhase(batchContext)
    let searchResults = discoverResult.searchResults
    const searchError = discoverResult.searchError

    const imageSearchResult = await runImageSearchPhase(batchContext)
    const imageSearchResults = imageSearchResult.imageSearchResults

    if (!phases.includes('discover') && hasTriagePhases) {
      const cached = await loadCachedSearchResults(
        chunk.map((brand) => brand.id),
        supabase as unknown as SupabaseClient
      )
      const cachedByName = new Map<string, SearchPhaseResult>()
      for (const brand of chunk) {
        const row = cached.get(brand.id)
        if (row) {
          cachedByName.set(displayBrandName(brand), row)
        }
      }
      searchResults = cachedByName
      const cachedCount = [...searchResults.values()].filter(r => r.snippets.length > 0).length
      if (cachedCount > 0) {
        config.onProgress?.(`  [SERP-CACHE] Loaded ${cachedCount} cached snippet sets`)
      }
    }

    const triagePhaseResult = await runTriagePhase(batchContext, searchResults)
    const triageResults = triagePhaseResult.triageResults
    const standaloneClassificationResult = await runStandaloneClassification(batchContext, hasTriagePhases)
    const batchClassifications = standaloneClassificationResult.batchClassifications

    for (const brand of chunk) {
      result.processed += 1
      config.onProgress?.(`Processing ${brand.slug} (${result.processed}/${totalBrands})`)
      let outcomePhaseResults: PhaseResult[] = []

      try {
        const triageResult = triageResults.get(brand.slug)
        const state: BrandEnrichState = {
          patches: {},
          phaseResults: [],
          knownUrls: collectKnownUrls(brand),
          discoveredUrls: [],
          serpSnippets: [],
          scrapedData: {},
        }
        outcomePhaseResults = state.phaseResults
        const triageApplication = applyTriageResult(triageResult, brand, phases)
        if (hasTriagePhases) {
          state.phaseResults.push(triageApplication.phaseResult)
        }
        appendPatch(state, triageApplication.patch)

        let triageSlug = state.patches.slug

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
            delete state.patches.slug
            triageApplication.phaseResult.changedFields = triageApplication.phaseResult.changedFields.filter(
              (field) => field !== 'slug'
            )
            triageSlug = undefined
          }
        }

        if (triageApplication.isNonBrand) {
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

          result.brandOutcomes.push({
            slug: brand.slug,
            name: brandName(brand),
            status: 'skipped',
            changedFields: changedFieldsFromPhaseResults(state.phaseResults),
            phaseResults: state.phaseResults,
          })
          result.skipped += 1
          continue
        }

        if (searchError) {
          throw new Error(searchError)
        }

        if (phases.includes('discover')) {
          const searchResult = searchResults.get(displayBrandName(brand)) ?? { urls: [], snippets: [] }
          state.discoveredUrls = uniqueUrls(
            searchResult.urls.filter((url) => !state.knownUrls.includes(url))
          )
          state.serpSnippets = searchResult.snippets
        }

        const urlExtracted = extractLinksFromUrls(state.discoveredUrls)
        let imageSearchUrls: string[] = []
        if (phases.includes('images')) {
          imageSearchUrls = imageSearchResults.get(displayBrandName(brand)) ?? []
          config.onProgress?.(`  [IMAGE-SEARCH] ${imageSearchUrls.length} images found`)
        }

        if (
          !phases.includes('tags') &&
          uniqueUrls([...state.knownUrls, ...state.discoveredUrls]).length === 0 &&
          !hasPatchValues(urlExtracted) &&
          imageSearchUrls.length === 0
        ) {
          if (includesDiscover && state.discoveredUrls.length <= 1) {
            weakBrandCount += 1
            config.onProgress?.(`  [WEAK-BRAND] ${brand.slug}: no useful data found (${state.discoveredUrls.length} search results, nothing to scrape)`)
          }
          result.brandOutcomes.push({
            slug: brand.slug,
            name: brandName(brand),
            status: 'skipped',
            changedFields: changedFieldsFromPhaseResults(state.phaseResults),
            phaseResults: state.phaseResults,
          })
          result.skipped += 1
          continue
        }

        const cleanResult = await runCleanPhase(brand, phases)
        state.phaseResults.push(cleanResult.phaseResult)
        appendPatch(state, cleanResult.patch)

        const linksResult = await runLinksPhase({
          brand,
          phases,
          discoveredUrls: state.discoveredUrls,
          knownUrls: state.knownUrls,
          supabase: supabase as unknown as SupabaseClient,
        })
        state.phaseResults.push(linksResult.phaseResult)
        state.scrapedData = linksResult.scrapedData ?? {}
        appendPatch(state, linksResult.patch)

        const brandImageResult = await runBrandImagePhase({
          brand,
          phases,
          imageSearchUrls,
          supabase: supabase as unknown as SupabaseClient,
          dryRun: config.dryRun,
          imageStorageId: brand.id,
        })
        state.phaseResults.push(brandImageResult.phaseResult)
        appendPatch(state, brandImageResult.patch)

        const descriptionsResult = await runDescriptionsPhase({
          brand,
          phases,
          scrapedData: state.scrapedData,
          serpSnippets: state.serpSnippets,
        })
        state.phaseResults.push(descriptionsResult.phaseResult)
        appendPatch(state, descriptionsResult.patch)

        let classification: ClassificationResult | null = null
        let hasCompletedTagClassification = false
        if (!(phases.includes('descriptions') && state.serpSnippets.length > 0) && phases.includes('tags')) {
          classification = batchClassifications.get(brand.slug) ?? null
        }

        if (classification) {
          hasCompletedTagClassification = true
          if (classification.productType !== brand.product_type) {
            appendPatch(state, { product_type: classification.productType })
            state.phaseResults.push(buildPhaseResult('tags', 'succeeded', ['product_type'], 0))
            config.onProgress?.(`  [TAG] ${brand.slug}: ${brand.product_type ?? 'null'} → ${classification.productType} (${classification.confidence})`)
          } else {
            state.phaseResults.push(buildPhaseResult('tags', 'succeeded', [], 0))
            config.onProgress?.(`  [TAG] ${brand.slug}: ${brand.product_type} (unchanged)`)
          }
        }

        const patch = state.patches
        if (includesDiscover) {
          config.onProgress?.(`  [DISCOVER] ${state.discoveredUrls.length} new URLs found`)
        }
        const patchKeys = Object.keys(patch)
        if (patchKeys.length > 0) {
          for (const key of patchKeys) {
            const val = (patch as Record<string, unknown>)[key]
            const display = Array.isArray(val) ? `[${val.length} items]` : typeof val === 'string' && val.length > 60 ? `${val.slice(0, 60)}…` : val
            config.onProgress?.(`  [ENRICH] ${key}: ${display}`)
          }
        }

        const changedFields = changedFieldsFromPhaseResults(state.phaseResults)

        if (!hasPatchValues(patch) && !hasCompletedTagClassification) {
          if (includesDiscover && state.discoveredUrls.length <= 1) {
            weakBrandCount += 1
            config.onProgress?.(`  [WEAK-BRAND] ${brand.slug}: no useful data found (${state.discoveredUrls.length} search results, no enrichment changes)`)
          }
          result.brandOutcomes.push({
            slug: brand.slug,
            name: brandName(brand),
            status: 'skipped',
            changedFields,
            phaseResults: state.phaseResults,
          })
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
          if (descriptionsResult.descriptionRewrite) {
            await insertDescriptionResult({
              brandId: brand.id,
              description: descriptionsResult.descriptionRewrite,
              rawResponse: { description: descriptionsResult.descriptionRewrite },
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
            result.brandOutcomes.push({
              slug: brand.slug,
              name: brandName(brand),
              status: 'failed',
              changedFields: changedFieldsFromPhaseResults(outcomePhaseResults),
              phaseResults: outcomePhaseResults,
              error: errMsg,
            })
            result.skipped += 1
            continue
          }

          if (triageSlug) {
            await insertSlugRedirect(brand.slug, triageSlug)
          }
        }

        result.brandOutcomes.push({
          slug: brand.slug,
          name: brandName(brand),
          status: 'succeeded',
          changedFields,
          phaseResults: state.phaseResults,
        })
        result.updated += 1
      } catch (err) {
        const errMsg = errorMessage(err)
        result.errors.push(`${brand.slug}: ${errMsg}`)
        result.brandOutcomes.push({
          slug: brand.slug,
          name: brandName(brand),
          status: 'failed',
          changedFields: changedFieldsFromPhaseResults(outcomePhaseResults),
          phaseResults: outcomePhaseResults,
          error: errMsg,
        })
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
