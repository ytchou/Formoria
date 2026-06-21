import { cleanBrandName, detectNonBrand, matchCategory, normalizeSlug } from './brand-cleanup'
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
import { scrapeBrandUrls } from './scraper'
import { classifyByDomain } from './scraper/input-detector'
import { searchBrandUrls } from './scraper/search'

export interface CurationConfig {
  dryRun: boolean
  slugs?: string[]
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
  display_brand_name: string
  status?: string | null
  description?: string | null
  product_type?: string | null
  website_url?: string | null
  is_visible?: boolean | null
  purchase_website?: string | null
  purchaseWebsite?: string | null
}

type CleanupPatch = Partial<Pick<CurationBrand, 'display_brand_name' | 'slug'>>
type AutoTagPatch = Partial<Pick<CurationBrand, 'product_type'>>
type SetVisibilityPatch = Partial<Pick<CurationBrand, 'is_visible'>>
type CurationPatch = CleanupPatch & AutoTagPatch & SetVisibilityPatch

type CleanNamesPhase = {
  changed: boolean
  patch: Pick<CleanupPatch, 'display_brand_name'>
}

type NormalizeSlugsPhase = {
  changed: boolean
  patch: Pick<CleanupPatch, 'slug'>
}

type DetectNonBrandsPhase = {
  isNonBrand: boolean
  reason: string | null
  confidence: 'high' | 'medium' | 'low'
}

type CleanupPhases = {
  cleanNames: CleanNamesPhase
  normalizeSlugs: NormalizeSlugsPhase
  detectNonBrands: DetectNonBrandsPhase
}

type ProcessCleanupOptions = {
  scrapedName?: string | null
}

type ProcessCleanupResult = {
  phases: CleanupPhases
  hasChanges: boolean
  patch: CleanupPatch
}

type AutoTagBrand = Pick<CurationBrand, 'id'> &
  Partial<Pick<CurationBrand, 'display_brand_name' | 'description' | 'product_type'>>

type ProcessAutoTagResult = {
  changed: boolean
  category: string | null
  patch?: Pick<AutoTagPatch, 'product_type'>
}

type SetVisibilityBrand = Pick<CurationBrand, 'id'> &
  Partial<
    Pick<
      CurationBrand,
      'status' | 'display_brand_name' | 'website_url' | 'description' | 'is_visible'
    >
  >

type ProcessSetVisibilityResult = {
  visible: boolean
  changed: boolean
  patch?: Pick<SetVisibilityPatch, 'is_visible'>
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

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

export function processCleanupBrand(
  brand: CurationBrand,
  opts: ProcessCleanupOptions = {}
): ProcessCleanupResult {
  const patch: CleanupPatch = {}
  const nameCleanup = cleanBrandName(brand.display_brand_name)
  const slugCleanup = normalizeSlug(brand.slug, opts.scrapedName ?? null)
  const nonBrandDetection = detectNonBrand({
    name: brand.display_brand_name,
    description: brand.description,
    purchaseWebsite: brand.purchaseWebsite ?? brand.purchase_website,
  })

  const cleanNames: CleanNamesPhase = {
    changed: nameCleanup.changed,
    patch: {},
  }

  if (nameCleanup.changed) {
    cleanNames.patch.display_brand_name = nameCleanup.cleanedName
    patch.display_brand_name = nameCleanup.cleanedName
  }

  const normalizeSlugs: NormalizeSlugsPhase = {
    changed: slugCleanup.newSlug !== null && slugCleanup.newSlug !== brand.slug,
    patch: {},
  }

  if (normalizeSlugs.changed && slugCleanup.newSlug) {
    normalizeSlugs.patch.slug = slugCleanup.newSlug
    patch.slug = slugCleanup.newSlug
  }

  return {
    phases: {
      cleanNames,
      normalizeSlugs,
      detectNonBrands: nonBrandDetection,
    },
    hasChanges: Object.keys(patch).length > 0,
    patch,
  }
}

export function processAutoTagBrand(brand: AutoTagBrand): ProcessAutoTagResult {
  if (brand.product_type) {
    return {
      changed: false,
      category: brand.product_type,
    }
  }

  const text = `${brand.display_brand_name ?? ''} ${brand.description ?? ''}`
  const category = matchCategory(text)

  if (!category) {
    return {
      changed: false,
      category: null,
    }
  }

  return {
    changed: true,
    category,
    patch: { product_type: category },
  }
}

export function processSetVisibilityBrand(
  brand: SetVisibilityBrand
): ProcessSetVisibilityResult {
  const visible =
    brand.status === 'approved' &&
    Boolean(brand.website_url?.trim()) &&
    Boolean(brand.description && brand.description.length >= 20) &&
    Boolean(brand.display_brand_name?.trim())

  if (brand.is_visible === visible) {
    return {
      visible,
      changed: false,
    }
  }

  return {
    visible,
    changed: true,
    patch: { is_visible: visible },
  }
}

export async function runCleanup(
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
    .select('id, slug, display_brand_name, status, description, purchase_website')

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
      const cleanup = processCleanupBrand(brand)

      if (!cleanup.hasChanges) {
        result.skipped += 1
        continue
      }

      if (!config.dryRun) {
        const { error: updateError } = await supabase
          .from('brands')
          .update(cleanup.patch)
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

export async function runAutoTag(
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
    .select('id, slug, display_brand_name, description, product_type')

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
      const autoTag = processAutoTagBrand(brand)

      if (!autoTag.changed || !autoTag.patch) {
        result.skipped += 1
        continue
      }

      if (!config.dryRun) {
        const { error: updateError } = await supabase
          .from('brands')
          .update(autoTag.patch)
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
    .select('id, slug, status, display_brand_name, website_url, description, is_visible')

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

type EnrichPhase = 'links' | 'images' | 'descriptions'
type RunEnrichPhase = EnrichPhase | 'discover'

type EnrichBrand = CurationBrand &
  Partial<BrandFlatLinkColumns> & {
    brand_highlights?: string | null
    hero_image_url?: string | null
    product_images?: string[] | null
    product_photos?: string[] | null
    heroImageUrl?: string | null
    productPhotos?: string[] | null
  }

type EnrichScrapedData = Partial<ScrapedBrandData> & Partial<BrandFlatLinkColumns>

type EnrichImagePatch = Partial<{
  hero_image_url: string | null
  product_photos: string[]
}>

type EnrichPatches = {
  links?: Partial<BrandFlatLinkColumns>
  images?: EnrichImagePatch
  descriptions?: Partial<Pick<EnrichBrand, 'description' | 'brand_highlights'>>
}

type EnrichPatch = Partial<BrandFlatLinkColumns> &
  EnrichImagePatch &
  Partial<Pick<EnrichBrand, 'description' | 'brand_highlights'>>

type ProcessEnrichResult = {
  patches: EnrichPatches
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
  return brand.display_brand_name
}

function collectKnownUrls(brand: EnrichBrand): string[] {
  const linkUrls = LINK_FIELDS
    .map((field) => brand[linkColumnFor(field)])
    .filter((url): url is string => hasLinkValue(url))

  return uniqueUrls([
    ...linkUrls,
    brand.website_url,
  ].filter((url): url is string => hasLinkValue(url)))
}

function deriveOfficialWebsite(urls: string[]): string | null {
  return urls.find((url) => classifyByDomain(url) === null) ?? null
}

function isImageableUrl(url: string): boolean {
  return classifyByDomain(url) !== 'social'
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

function imageScrapedData(scrapedData: EnrichScrapedData): Pick<ScrapedBrandData, 'heroImageUrl' | 'galleryImageUrls'> {
  return {
    heroImageUrl: scrapedData.heroImageUrl ?? null,
    galleryImageUrls: scrapedData.galleryImageUrls ?? [],
  }
}

function imageUrlsFromScraped(scrapedData: Pick<ScrapedBrandData, 'heroImageUrl' | 'galleryImageUrls'>): string[] {
  return [
    scrapedData.heroImageUrl,
    ...scrapedData.galleryImageUrls,
  ].filter((url): url is string => hasLinkValue(url))
}

function storedImageScrapedData(
  scrapedData: EnrichScrapedData,
  storedUrls: Array<string | null>
): EnrichScrapedData {
  return {
    ...scrapedData,
    heroImageUrl: storedUrls[0] ?? null,
    galleryImageUrls: storedUrls.slice(1).filter(hasLinkValue),
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

export function processEnrichBrand(
  brand: EnrichBrand,
  scrapedData: EnrichScrapedData,
  phases: string[]
): ProcessEnrichResult {
  const patches: EnrichPatches = {}
  const normalizedScrapedData = normalizeScrapedData(scrapedData)

  if (isRequestedPhase(phases, 'links')) {
    const links = buildLinkEnrichPatch(brand, normalizedScrapedData)
    if (hasPatchValues(links)) {
      patches.links = links
    }
  }

  if (isRequestedPhase(phases, 'images')) {
    const scrapedImages = imageScrapedData(normalizedScrapedData)
    const imagePatch = buildImageEnrichPatch(
      normalizeImageBrand(brand),
      scrapedImages,
      imageUrlsFromScraped(scrapedImages)
    )
    const images = imagePatchToDbPatch(imagePatch)

    if (hasPatchValues(images)) {
      patches.images = images
    }
  }

  if (isRequestedPhase(phases, 'descriptions')) {
    const descriptions = buildTextEnrichPatch(brand, normalizedScrapedData)
    if (hasPatchValues(descriptions)) {
      patches.descriptions = descriptions
    }
  }

  return {
    patches,
    hasChanges: Object.values(patches).some((patch) => patch && hasPatchValues(patch)),
  }
}

export function mergeEnrichPatches(patches: EnrichPatches): EnrichPatch {
  return {
    ...patches.links,
    ...patches.images,
    ...patches.descriptions,
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
  let query = supabase
    .from('brands')
    .select(
      'id, slug, display_brand_name, status, description, brand_highlights, social_instagram, social_threads, social_facebook, purchase_website, purchase_pinkoi, purchase_shopee, website_url, hero_image_url, product_photos'
    )

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

  for (const brand of (data ?? []) as EnrichBrand[]) {
    result.processed += 1
    config.onProgress?.(`Processing ${brand.slug}`)

    try {
      const knownUrls = collectKnownUrls(brand)
      let discoveredUrls: string[] = []

      if (phases.includes('discover')) {
        discoveredUrls = uniqueUrls(
          (await searchBrandUrls(displayBrandName(brand))).filter((url) => !knownUrls.includes(url))
        )
      }

      const urls = uniqueUrls([...knownUrls, ...discoveredUrls])
      const scrapeUrls = phases.includes('images')
        ? urls.filter(isImageableUrl)
        : urls

      if (scrapeUrls.length === 0) {
        result.skipped += 1
        continue
      }

      const { data: scraped } = await scrapeBrandUrls(scrapeUrls)
      const urlExtracted = extractLinksFromUrls(discoveredUrls)
      const derivedWebsite = scraped.purchaseWebsite ?? deriveOfficialWebsite(urls)
      let enrichedScraped: EnrichScrapedData = {
        ...scraped,
        ...urlExtracted,
        purchaseWebsite: derivedWebsite,
      }

      if (phases.includes('images')) {
        const scrapedImages = imageScrapedData(enrichedScraped)
        const imageUrls = imageUrlsFromScraped(scrapedImages)

        if (imageUrls.length > 0 && !config.dryRun) {
          enrichedScraped = storedImageScrapedData(
            enrichedScraped,
            await downloadAndStoreImages(imageUrls, brand.id)
          )
        }
      }

      const enrich = processEnrichBrand(brand, enrichedScraped, config.phases)
      const patch = mergeEnrichPatches(enrich.patches)

      if (!enrich.hasChanges || !hasPatchValues(patch)) {
        result.skipped += 1
        continue
      }

      if (!config.dryRun) {
        const { error: updateError } = await supabase
          .from('brands')
          .update(patch as CurationPatch)
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
