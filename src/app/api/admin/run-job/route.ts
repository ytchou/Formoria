import { revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'
import { isAdmin } from '@/lib/auth/admin'
import { cleanBrandName, detectNonBrand, matchCategory, normalizeSlug } from '@/lib/services/brand-cleanup'
import { getBrands, hideVisibleBrands, insertSlugRedirect, updateBrand } from '@/lib/services/brands'
import { downloadAndStoreImages } from '@/lib/services/image-download'
import {
  buildImageEnrichPatch,
  buildLinkEnrichPatch,
  hasLinkValue,
  LINK_FIELDS,
  linkColumnFor,
  type LinkColumn,
} from '@/lib/services/link-enrichment'
import { scrapeBrandUrl, scrapeBrandUrls } from '@/lib/services/scraper'
import { classifyByDomain } from '@/lib/services/scraper/input-detector'
import { searchBrandWebsite, SEARCH_DELAY_MS } from '@/lib/services/scraper/search'
import { addTagToBrandIgnoringDuplicates, getTags } from '@/lib/services/taxonomy'
import { createServiceClient } from '@/lib/supabase/server'
import type { Json } from '@/lib/supabase/database.types'
import type { Brand, BrandFlatLinkColumns } from '@/lib/types'
import type { ScrapedBrandData } from '@/lib/types/scraper'

const BRAND_FETCH_LIMIT = 10_000
const MAX_PRODUCT_PHOTOS = 5
const SCRAPE_DELAY_MS = 1_000
const TOP_N = 30
const STALE_JOB_MINUTES = 30
const VALIDATE_LINK_READ_LIMIT_BYTES = 50 * 1024

type Supabase = ReturnType<typeof createServiceClient>
type CurationJobStatus = 'pending' | 'running' | 'completed' | 'failed'
type CurationJob = {
  id: string
  operation: string
  status: CurationJobStatus
  params: Json | null
  dry_run: boolean
  progress: Json | null
  result: Json | null
  started_by: string
  created_at: string | null
  started_at: string | null
  completed_at: string | null
}
type CurationJobUpdate = Partial<Pick<CurationJob, 'status' | 'progress' | 'result' | 'started_at' | 'completed_at'>>
type JobParams = {
  slugs?: string[]
  stopAfter?: number
  validate?: boolean
  scrape?: boolean
}
type Progress = {
  processed: number
  total: number
  skipped: number
  failed: number
}
type OperationResult = Progress & {
  changed: number
  changes: Array<Record<string, unknown>>
  errors: Array<{ slug: string; error: string }>
}
type BrandWithLinkColumns = Brand & BrandFlatLinkColumns
type CurationJobsTable = {
  select: (columns: string) => {
    eq: (column: string, value: string) => {
      single: () => Promise<{ data: CurationJob | null; error: { message: string } | null }>
    }
  }
  update: (patch: CurationJobUpdate) => {
    eq: (column: string, value: string) => {
      neq: (column: string, value: string) => {
        lt: (column: string, value: string) => Promise<{ error: { message: string } | null }>
      }
    } & PromiseLike<{ error: { message: string } | null }>
  }
}
type RevalidateTagOneArg = (tag: string) => void
type CurationJobsFrom = (table: 'curation_jobs') => CurationJobsTable

export async function POST(request: Request) {
  let jobId: unknown

  try {
    const body = await request.json()
    jobId = body?.jobId
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (typeof jobId !== 'string' || jobId.trim() === '') {
    return NextResponse.json({ error: 'Missing jobId' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data: job, error } = await curationJobs(supabase)
    .select('*')
    .eq('id', jobId)
    .single()

  if (error || !job) {
    return NextResponse.json({ error: error?.message ?? 'Job not found' }, { status: 404 })
  }

  if (!isAdmin(job.started_by)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  runJob(job).catch((err) => {
    console.error('[admin:run-job]', err)
  })

  return NextResponse.json({ jobId: job.id, status: 'accepted' }, { status: 202 })
}

async function runJob(job: CurationJob): Promise<void> {
  const supabase = createServiceClient()

  try {
    await recoverStaleJobs(supabase, job.id)
    await updateJob(supabase, job.id, {
      status: 'running',
      started_at: new Date().toISOString(),
      progress: progressJson({ processed: 0, total: 0, skipped: 0, failed: 0 }),
    })

    const result = await runOperation(supabase, job)
    await updateJob(supabase, job.id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      progress: progressJson(result),
      result: result as unknown as Json,
    })
    const revalidateTagOneArg = revalidateTag as RevalidateTagOneArg
    revalidateTagOneArg('quality-metrics')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await updateJob(supabase, job.id, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      result: { error: message } as Json,
    })
  }
}

async function runOperation(supabase: Supabase, job: CurationJob): Promise<OperationResult> {
  const params = parseParams(job.params)

  switch (job.operation) {
    case 'clean-names':
      return runCleanNames(supabase, job.id, job.dry_run, params)
    case 'detect-non-brands':
      return runDetectNonBrands(supabase, job.id, job.dry_run, params)
    case 'normalize-slugs':
      return runNormalizeSlugs(supabase, job.id, job.dry_run, params)
    case 'enrich-descriptions':
      return runEnrichDescriptions(supabase, job.id, job.dry_run, params)
    case 'auto-tag':
      return runAutoTag(supabase, job.id, job.dry_run, params)
    case 'enrich-links':
      return runEnrichLinks(supabase, job.id, job.dry_run, params)
    case 'enrich-images':
      return runEnrichImages(supabase, job.id, job.dry_run, params)
    case 'score-and-scrape':
      return runScoreAndScrape(supabase, job.id, job.dry_run, params)
    case 'set-visibility':
      return runSetVisibility(supabase, job.id, job.dry_run, params)
    default:
      throw new Error(`Unsupported operation: ${job.operation}`)
  }
}

async function runCleanNames(supabase: Supabase, jobId: string, dryRun: boolean, params: JobParams): Promise<OperationResult> {
  const brands = limitBrands(await fetchBrands(params, 'approved'), params)
  const result = makeResult(brands.length)

  for (const brand of brands) {
    await processBrand(supabase, jobId, result, brand.slug, async () => {
      const cleanup = cleanBrandName(brand.name)

      if (!cleanup.changed) {
        result.skipped++
        return null
      }

      const change = {
        slug: brand.slug,
        originalName: cleanup.originalName,
        cleanedName: cleanup.cleanedName,
        patternsMatched: cleanup.patternsMatched,
        confidence: cleanup.confidence,
      }

      if (!dryRun) {
        await updateBrand(brand.id, { name: cleanup.cleanedName })
      }

      result.changed++
      return change
    })
  }

  return result
}

async function runDetectNonBrands(supabase: Supabase, jobId: string, dryRun: boolean, params: JobParams): Promise<OperationResult> {
  const brands = limitBrands(await fetchBrands(params, 'approved'), params)
  const result = makeResult(brands.length)

  for (const brand of brands) {
    await processBrand(supabase, jobId, result, brand.slug, async () => {
      const detection = detectNonBrand(brand)

      if (!detection.isNonBrand) {
        result.skipped++
        return null
      }

      const change = {
        slug: brand.slug,
        name: brand.name,
        reason: detection.reason,
        confidence: detection.confidence,
        action: 'hide',
      }

      if (!dryRun) {
        await updateBrand(brand.id, { status: 'hidden' })
      }

      result.changed++
      return change
    })
  }

  return result
}

async function runNormalizeSlugs(supabase: Supabase, jobId: string, dryRun: boolean, params: JobParams): Promise<OperationResult> {
  const allBrands = await fetchBrands(params, 'approved')
  const brands = limitBrands(allBrands, params)
  const existingSlugs = new Set(allBrands.map((brand) => brand.slug))
  const assignedSlugs = new Set<string>()
  const result = makeResult(brands.length)

  for (const brand of brands) {
    await processBrand(supabase, jobId, result, brand.slug, async () => {
      let sourceName: string | null = brand.name

      if (params.scrape && brand.purchaseWebsite) {
        try {
          const { data: scraped } = await scrapeBrandUrls([brand.purchaseWebsite])
          sourceName = scraped.brandName ?? brand.name
        } catch {
          sourceName = brand.name
        }

        await sleep(SCRAPE_DELAY_MS)
      }

      const normalized = normalizeSlug(brand.slug, sourceName)
      if (!normalized.newSlug || existingSlugs.has(normalized.newSlug) || assignedSlugs.has(normalized.newSlug)) {
        result.skipped++
        return null
      }

      assignedSlugs.add(normalized.newSlug)
      const change = {
        slug: brand.slug,
        newSlug: normalized.newSlug,
        name: sourceName,
        source: normalized.source,
      }

      if (!dryRun) {
        await updateBrand(brand.id, { slug: normalized.newSlug })
        await insertSlugRedirect(brand.slug, normalized.newSlug)
      }

      result.changed++
      return change
    })
  }

  return result
}

async function runEnrichDescriptions(supabase: Supabase, jobId: string, dryRun: boolean, params: JobParams): Promise<OperationResult> {
  const brands = limitBrands(
    (await fetchBrands(params, 'approved')).filter((brand) =>
      !brand.description || brand.description.trim() === '' || brand.description.length < 20 || brand.description === brand.name
    ),
    params
  )
  const result = makeResult(brands.length)

  for (const brand of brands) {
    await processBrand(supabase, jobId, result, brand.slug, async () => {
      const urls = collectPurchaseLinks(brand)
      if (urls.length === 0) {
        result.skipped++
        return null
      }

      const { data: scraped } = await scrapeBrandUrls(urls)
      const patch = buildTextEnrichPatch(brand, scraped)
      await sleep(SCRAPE_DELAY_MS)

      if (!patch.description) {
        result.skipped++
        return null
      }

      if (!dryRun) {
        await updateBrand(brand.id, { description: patch.description })
      }

      result.changed++
      return { slug: brand.slug, fields: ['description'], description: patch.description }
    })
  }

  return result
}

async function runAutoTag(supabase: Supabase, jobId: string, dryRun: boolean, params: JobParams): Promise<OperationResult> {
  const brands = limitBrands(
    (await fetchBrands(params)).filter((brand) => !brand.category),
    params
  )
  const tags = await getTags('product_type')
  const tagBySlug = new Map(tags.map((tag) => [tag.slug, tag]))
  const result = makeResult(brands.length)

  for (const brand of brands) {
    await processBrand(supabase, jobId, result, brand.slug, async () => {
      const matched = matchCategory(`${brand.name} ${brand.description ?? ''} ${brand.brandHighlights ?? ''}`)

      if (!matched) {
        result.skipped++
        return null
      }

      const tag = tagBySlug.get(matched)
      const category = tag?.nameZh ?? tag?.name ?? matched

      if (!dryRun) {
        await updateBrand(brand.id, { category })
        if (tag) {
          await addTagToBrandIgnoringDuplicates(brand.id, tag.id)
        }
      }

      result.changed++
      return { slug: brand.slug, matched, category }
    })
  }

  return result
}

async function runEnrichLinks(supabase: Supabase, jobId: string, dryRun: boolean, params: JobParams): Promise<OperationResult> {
  const brands = limitBrands(
    (await fetchBrands(params, 'approved'))
      .map(withFlatLinkColumns)
      .filter((brand) => LINK_FIELDS.some((field) => !hasLinkValue(brand[linkColumnFor(field)]))),
    params
  )
  const result = makeResult(brands.length)

  for (const brand of brands) {
    await processBrand(supabase, jobId, result, brand.slug, async () => {
      let urls = collectKnownUrls(brand)

      if (urls.length === 0) {
        const foundUrl = await searchBrandWebsite(displayBrandName(brand))
        await sleep(SEARCH_DELAY_MS)
        urls = foundUrl ? [foundUrl] : []
      }

      if (urls.length === 0) {
        result.skipped++
        return null
      }

      const { data: scraped } = await scrapeBrandUrls(urls)
      const patch = buildLinkEnrichPatch(brand, {
        ...scraped,
        purchaseWebsite: scraped.purchaseWebsite ?? deriveOfficialWebsite(urls),
      })

      if (params.validate) {
        await removeInvalidLinks(patch, displayBrandName(brand))
      }

      const fields = Object.keys(patch)
      await sleep(SCRAPE_DELAY_MS)

      if (fields.length === 0) {
        result.skipped++
        return null
      }

      if (!dryRun) {
        await updateBrand(brand.id, linkPatchToBrandPatch(patch))
      }

      result.changed++
      return { slug: brand.slug, fields, patch }
    })
  }

  return result
}

async function runEnrichImages(supabase: Supabase, jobId: string, dryRun: boolean, params: JobParams): Promise<OperationResult> {
  const brands = limitBrands(
    (await fetchBrands(params, 'approved')).filter((brand) => !brand.heroImageUrl || brand.productPhotos.length < 2),
    params
  )
  const result = makeResult(brands.length)

  for (const brand of brands) {
    await processBrand(supabase, jobId, result, brand.slug, async () => {
      const urls = collectPurchaseLinks(brand)
      if (urls.length === 0) {
        result.skipped++
        return null
      }

      const { data: scraped } = await scrapeBrandUrls(urls)
      const imageUrls = [scraped.heroImageUrl, ...scraped.galleryImageUrls].filter(hasLinkValue)

      if (imageUrls.length === 0) {
        await sleep(SCRAPE_DELAY_MS)
        result.skipped++
        return null
      }

      const storedUrls = dryRun ? imageUrls : await downloadAndStoreImages(imageUrls, brand.id)
      const patch = buildImageEnrichPatch(brand, scraped, storedUrls)
      const fields = Object.keys(patch)
      await sleep(SCRAPE_DELAY_MS)

      if (fields.length === 0) {
        result.skipped++
        return null
      }

      if (!dryRun) {
        await updateBrand(brand.id, patch)
      }

      result.changed++
      return { slug: brand.slug, fields, patch }
    })
  }

  return result
}

async function runScoreAndScrape(supabase: Supabase, jobId: string, dryRun: boolean, params: JobParams): Promise<OperationResult> {
  const brands = await fetchBrands(params)
  const scored = brands.map((brand) => ({ brand, ...scoreBrand(brand) }))
  const ranked = params.slugs
    ? scored.filter(({ brand }) => params.slugs?.includes(brand.slug))
    : scored.sort((a, b) => b.score - a.score).slice(0, TOP_N)
  const limited = limitBrands(ranked, params)
  const result = makeResult(limited.length)

  for (const { brand, score, websiteUrl } of limited) {
    await processBrand(supabase, jobId, result, brand.slug, async () => {
      if (!websiteUrl) {
        result.skipped++
        return null
      }

      const scraped = await scrapeBrandUrl(websiteUrl)
      const textPatch = buildTextEnrichPatch(brand, scraped)
      const imageUrls = collectImageUrlsForBrand(brand, scraped)
      const storedUrls = dryRun || imageUrls.length === 0 ? imageUrls : await downloadAndStoreImages(imageUrls, brand.id)
      const imagePatch = buildImageEnrichPatch(brand, storedUrls)
      const patch = { ...textPatch, ...imagePatch }
      const fields = Object.keys(patch)
      await sleep(SCRAPE_DELAY_MS)

      if (fields.length === 0) {
        result.skipped++
        return null
      }

      if (!dryRun) {
        await updateBrand(brand.id, patch)
      }

      result.changed++
      return {
        slug: brand.slug,
        score,
        fields,
        patch,
        showcaseReady: isShowcaseReady({ ...brand, ...patch }),
      }
    })
  }

  return result
}

async function runSetVisibility(supabase: Supabase, jobId: string, dryRun: boolean, params: JobParams): Promise<OperationResult> {
  const slugs = params.slugs ?? []

  if (slugs.length === 0) {
    throw new Error('set-visibility requires params.slugs')
  }

  const brands = await fetchBrands({})
  const slugMap = new Map(brands.map((brand) => [brand.slug, brand]))
  const missing = slugs.filter((slug) => !slugMap.has(slug))

  if (missing.length > 0) {
    throw new Error(`Missing slugs: ${missing.join(', ')}`)
  }

  const result = makeResult(brands.length)

  if (!dryRun) {
    const hidden = await hideVisibleBrands()
    result.changed += hidden
  } else {
    result.changed += brands.filter((brand) => brand.status !== 'hidden').length
  }

  result.processed = brands.length
  await updateProgress(supabase, jobId, result)

  for (const slug of slugs) {
    await processBrand(supabase, jobId, result, slug, async () => {
      const brand = slugMap.get(slug)

      if (!brand) {
        result.skipped++
        return null
      }

      if (!dryRun) {
        await updateBrand(brand.id, { status: 'approved' })
      }

      result.changed++
      return { slug, status: 'approved', mitVerified: brand.mitVerified ?? false }
    })
  }

  return result
}

async function processBrand(
  supabase: Supabase,
  jobId: string,
  result: OperationResult,
  slug: string,
  fn: () => Promise<Record<string, unknown> | null>
): Promise<void> {
  try {
    const change = await fn()
    if (change) {
      result.changes.push(change)
    }
  } catch (error) {
    result.failed++
    result.errors.push({
      slug,
      error: error instanceof Error ? error.message : String(error),
    })
  } finally {
    result.processed++
    await updateProgress(supabase, jobId, result)
  }
}

async function fetchBrands(params: JobParams, status?: Brand['status']): Promise<Brand[]> {
  const { brands } = await getBrands({ limit: BRAND_FETCH_LIMIT, status, includeTestBrands: true })

  if (!params.slugs || params.slugs.length === 0) {
    return brands
  }

  return brands.filter((brand) => params.slugs?.includes(brand.slug))
}

function parseParams(params: Json | null): JobParams {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return {}
  }

  const raw = params as Record<string, unknown>
  const slugs = Array.isArray(raw.slugs)
    ? raw.slugs.filter((slug): slug is string => typeof slug === 'string' && slug.trim() !== '')
    : undefined
  const stopAfter = typeof raw.stopAfter === 'number' && Number.isFinite(raw.stopAfter) && raw.stopAfter > 0
    ? Math.floor(raw.stopAfter)
    : undefined

  return {
    slugs,
    stopAfter,
    validate: raw.validate === true,
    scrape: raw.scrape === true,
  }
}

function limitBrands<T>(items: T[], params: JobParams): T[] {
  return params.stopAfter ? items.slice(0, params.stopAfter) : items
}

function makeResult(total: number): OperationResult {
  return {
    processed: 0,
    total,
    skipped: 0,
    failed: 0,
    changed: 0,
    changes: [],
    errors: [],
  }
}

function progressJson(progress: Progress): Json {
  return {
    processed: progress.processed,
    total: progress.total,
    skipped: progress.skipped,
    failed: progress.failed,
  } as Json
}

async function updateProgress(supabase: Supabase, jobId: string, progress: Progress): Promise<void> {
  await updateJob(supabase, jobId, { progress: progressJson(progress) })
}

async function updateJob(supabase: Supabase, jobId: string, patch: CurationJobUpdate): Promise<void> {
  const { error } = await curationJobs(supabase)
    .update(patch)
    .eq('id', jobId)

  if (error) {
    throw error
  }
}

async function recoverStaleJobs(supabase: Supabase, currentJobId: string): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_JOB_MINUTES * 60 * 1000).toISOString()
  const { error } = await curationJobs(supabase)
    .update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      result: { error: 'Job timed out (stale recovery)' } as Json,
    })
    .eq('status', 'running')
    .neq('id', currentJobId)
    .lt('started_at', staleBefore)

  if (error) {
    throw error
  }
}

function curationJobs(supabase: Supabase): CurationJobsTable {
  const from = supabase.from.bind(supabase) as unknown
  const fromCurationJobs = from as CurationJobsFrom
  return fromCurationJobs('curation_jobs')
}

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
  return LINK_FIELDS
    .map((field) => brand[linkColumnFor(field)])
    .filter(hasLinkValue)
}

function collectPurchaseLinks(brand: Brand): string[] {
  return [brand.purchaseWebsite, brand.purchasePinkoi, brand.purchaseShopee].filter(hasLinkValue)
}

function deriveOfficialWebsite(urls: string[]): string | null {
  return urls.find((url) => classifyByDomain(url) === null) ?? null
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

async function removeInvalidLinks(patch: Partial<BrandFlatLinkColumns>, brandName: string): Promise<void> {
  for (const [column, url] of Object.entries(patch) as Array<[LinkColumn, string | null | undefined]>) {
    if (url && !(await validateLink(url, brandName))) {
      delete patch[column]
    }
  }
}

async function validateLink(url: string, brandName: string): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)

  try {
    const response = await fetch(url, { signal: controller.signal })
    const contentType = response.headers.get('content-type')
    if (!contentType?.startsWith('text/')) return false

    const contentLength = response.headers.get('content-length')
    if (contentLength != null && Number(contentLength) > 1_000_000) return false

    const html = await readResponseText(response, VALIDATE_LINK_READ_LIMIT_BYTES)
    const normalizedHtml = html.toLowerCase().replace(/\s+/g, ' ')
    const normalizedName = brandName.toLowerCase().replace(/\s+/g, ' ')

    return normalizedHtml.includes(normalizedName)
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

async function readResponseText(response: Response, byteLimit: number): Promise<string> {
  if (!response.body) {
    return ''
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytesRead = 0
  let text = ''

  try {
    while (bytesRead < byteLimit) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      const chunk = value.subarray(0, Math.max(byteLimit - bytesRead, 0))
      bytesRead += chunk.byteLength
      text += decoder.decode(chunk, { stream: bytesRead < byteLimit })
    }

    text += decoder.decode()
    return text
  } finally {
    reader.cancel().catch(() => undefined)
  }
}

function scoreBrand(brand: Brand): { score: number; websiteUrl: string | null } {
  let score = 0

  if (brand.description && brand.description.length > 20) score += 15
  if (brand.heroImageUrl) score += 15
  if (brand.productPhotos.length >= 2) score += 15
  if (brand.socialInstagram || brand.socialThreads || brand.socialFacebook) score += 10
  if (brand.purchaseWebsite) score += 10
  if (brand.purchaseWebsite || brand.purchasePinkoi || brand.purchaseShopee) score += 10
  if (brand.brandHighlights != null && brand.brandHighlights.length > 0) score += 10
  if (brand.category) score += 5

  const websiteUrl = brand.purchaseWebsite || brand.purchasePinkoi || brand.purchaseShopee || null
  if (!websiteUrl) score -= 50

  return { score, websiteUrl }
}

function buildTextEnrichPatch(brand: Brand, scraped: ScrapedBrandData): Partial<Brand> {
  const patch: Partial<Brand> = {}

  if ((!brand.description || brand.description.length < 20) && scraped.description && scraped.description.length >= 20) {
    patch.description = scraped.description
  }

  if (!brand.socialInstagram && scraped.socialInstagram) patch.socialInstagram = scraped.socialInstagram
  if (!brand.socialThreads && scraped.socialThreads) patch.socialThreads = scraped.socialThreads
  if (!brand.socialFacebook && scraped.socialFacebook) patch.socialFacebook = scraped.socialFacebook
  if (!brand.brandHighlights && scraped.story) patch.brandHighlights = scraped.story

  return patch
}

function collectImageUrlsForBrand(brand: Brand, scraped: ScrapedBrandData): string[] {
  const imageUrls: string[] = []

  if (!brand.heroImageUrl && scraped.heroImageUrl) {
    imageUrls.push(scraped.heroImageUrl)
  }

  const currentPhotoCount = brand.productPhotos.length
  if (currentPhotoCount < 3 && scraped.galleryImageUrls.length > 0) {
    const slotsAvailable = MAX_PRODUCT_PHOTOS - currentPhotoCount
    const galleryStart = imageUrls.length > 0 ? 1 : 0
    imageUrls.push(...scraped.galleryImageUrls.slice(galleryStart, galleryStart + slotsAvailable))
  }

  return imageUrls
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
