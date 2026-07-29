import { z } from 'zod'
import { IMAGE_CLASSIFY_SYSTEM_PROMPT } from '@/lib/prompts'
import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'
import { buildEnrichmentConfig } from '@/lib/constants/enrichment-config'
import { parseJson, type OpenAIChatResult } from '../openai-client'
import { createAuditedOpenAIClient } from '../llm-audit'
import { syncHeroDenormalized, type BrandImageRow } from '../brand-images'
import { brandImageRenderUrl, deleteStoredImagePaths } from '../image-upload'
import { localizeToTW } from '../taiwan-localization'
import { createServiceClient } from '@/lib/supabase/server'
import type { PhaseResult } from '@/lib/types/curation'
import {
  brandTarget,
  targetImageStorage,
  type EnrichmentTarget,
} from '../enrichment-target'
import { buildPhaseResult, timePhase, type EnrichBrand, type EnrichPhase } from './types'

const BATCH_SIZE = 20

const IMAGE_TAGS = [
  'product',
  'lifestyle',
  'packaging',
  'logo',
  'promo',
  'text_banner',
  'irrelevant',
] as const

const VALID_TAGS = new Set<string>(IMAGE_TAGS)
export const JUNK_TAGS = new Set(['promo', 'text_banner', 'irrelevant'])

/**
 * Hero ordering is rank-major, score-minor — rank MUST beat score.
 * The model scores logos higher than photography (measured p50: logo 90 vs
 * product/lifestyle/packaging 85), so a pure score sort would make a logo the hero
 * on most brand pages and turn the directory into a wall of logos. A logo is a valid
 * image (hence not junk), just a worse hero than a real photo.
 *
 * Typed as a total Record so adding a tag to `ImageClassificationTag` is a compile
 * error until it is given a rank. Junk tags never reach `ordered` (they are filtered
 * out first); their entries exist only to keep the Record exhaustive.
 */
const TAG_RANK: Record<ImageClassificationTag, number> = {
  product: 0,
  lifestyle: 0,
  packaging: 0,
  logo: 1,
  promo: 2,
  text_banner: 2,
  irrelevant: 2,
}

/** Images a human picked. The classifier must never retag, reorder away, or delete these. */
const EXEMPT_SOURCES = new Set(['owner', 'admin'])

/** Width sent to the vision model — `detail: 'low'` downsamples to 512px anyway. */
const CLASSIFY_RENDER_WIDTH = 512

/** One retry per chunk, and only after dropping an image OpenAI could not download. */
const MAX_CHUNK_RETRIES = 1

type ImageClassificationTag = (typeof IMAGE_TAGS)[number]

type ParsedImageClassification = {
  tag: ImageClassificationTag
  score: number
  altZh: string
  altEn: string
}

type ClassifiedImage = {
  id: string
  tag: ImageClassificationTag
  score: number
  storage_path?: string | null
}

function toStrictJsonSchema(shape: z.ZodType): Record<string, unknown> {
  const schema = z.toJSONSchema(shape, { target: 'draft-7' }) as Record<string, unknown>
  // OpenAI strict mode rejects the `$schema` keyword; every object already carries
  // `additionalProperties: false` and a fully populated `required`, as strict mode demands.
  return Object.fromEntries(Object.entries(schema).filter(([key]) => key !== '$schema'))
}

const IMAGE_CLASSIFICATION_SCHEMA = {
  name: 'image_classifications',
  schema: toStrictJsonSchema(
    z.object({
      classifications: z.array(
        z.object({
          id: z.string(),
          tag: z.enum(IMAGE_TAGS),
          score: z.number(),
          alt_zh: z.string(),
          alt_en: z.string(),
        })
      ),
    })
  ),
}

type ClassifyImagesPhaseOptions = {
  brand: EnrichBrand
  phases: EnrichPhase[]
  dryRun?: boolean
  overwrite?: boolean
  target?: EnrichmentTarget
  jobId?: string
}

type ClassifyImagesPhaseOutput = {
  phaseResult: PhaseResult
  patch: Record<string, unknown>
}

type BrandImageForClassification = BrandImageRow & {
  id: string
  alt_zh?: string | null
  alt_en?: string | null
}

type BrandImagesSelectQuery = {
  eq: (column: string, value: string) => BrandImagesSelectQuery
  neq: (column: string, value: string) => BrandImagesSelectQuery
  is: (column: string, value: null) => BrandImagesSelectQuery
  order: (
    column: string,
    options: { ascending: boolean }
  ) => Promise<{ data: BrandImageForClassification[] | null; error: unknown }>
}

type BrandImagesUpdateQuery = {
  eq: (column: string, value: string) => BrandImagesUpdateQuery
  neq: (column: string, value: string) => BrandImagesUpdateQuery
  not: (column: string, operator: string, value: unknown) => BrandImagesUpdateQuery
  select: (columns: string) => Promise<{ data: Array<{ id: string }> | null; error: unknown }>
  then: Promise<{ error: unknown }>['then']
}

type BrandImagesTable = {
  select: (columns: string) => BrandImagesSelectQuery
  update: (row: Record<string, unknown>) => BrandImagesUpdateQuery
}

type ClassifyImagesClient = {
  from(table: 'brand_images' | 'submission_images'): BrandImagesTable
}

function isImageClassificationTag(value: unknown): value is ImageClassificationTag {
  return typeof value === 'string' && VALID_TAGS.has(value)
}

function scoreValue(value: BrandImageRow['score']): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value)
  return 0
}

function isExemptSource(source: BrandImageRow['source']): boolean {
  return typeof source === 'string' && EXEMPT_SOURCES.has(source)
}

function classifiedImageFromRow(row: BrandImageForClassification): ClassifiedImage | null {
  if (isExemptSource(row.source)) return null

  const tag = row.tags?.find(isImageClassificationTag)
  if (!tag) return null

  return {
    id: row.id,
    tag,
    score: scoreValue(row.score),
    storage_path: row.storage_path,
  }
}

function extractArray(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    const values = Object.values(obj)
    const arr = values.find(Array.isArray)
    if (arr) return arr
    if ('tag' in obj) return [raw]
  }
  return null
}

/**
 * Verdicts keyed by the ordinal the model was told to echo back in `id`.
 * Positional zipping is deliberately NOT used: a short or reordered array would
 * otherwise hand every later image the previous image's verdict.
 */
function parseClassificationBatch(responseText: string): Map<string, ParsedImageClassification> {
  type RawClassification = {
    id?: unknown
    tag?: unknown
    score?: unknown
    alt_zh?: unknown
    alt_en?: unknown
  }

  const verdicts = new Map<string, ParsedImageClassification>()
  const raw = parseJson<unknown>(responseText)
  const items = extractArray(raw) as RawClassification[] | null
  if (!items) return verdicts

  for (const item of items) {
    if (!item || typeof item !== 'object') continue

    const id =
      typeof item.id === 'string'
        ? item.id.trim()
        : typeof item.id === 'number' && Number.isFinite(item.id)
          ? String(item.id)
          : ''
    if (!id || verdicts.has(id)) continue
    if (!isImageClassificationTag(item.tag)) continue

    const score = typeof item.score === 'number' ? item.score : Number(item.score)
    if (!Number.isFinite(score)) continue

    verdicts.set(id, {
      tag: item.tag,
      score: Math.max(0, Math.min(100, Math.round(score))),
      altZh: typeof item.alt_zh === 'string' ? localizeToTW(item.alt_zh).text : '',
      altEn: typeof item.alt_en === 'string' ? item.alt_en : '',
    })
  }

  return verdicts
}

export function applyClassifications(images: ClassifiedImage[]): {
  rejectedIds: string[]
  rejectedUpdates: Array<{
    id: string
    row: { status: 'rejected'; storage_path: null }
  }>
  pathsToDelete: string[]
  ordered: ClassifiedImage[]
} {
  const rejected = images.filter((image) => JUNK_TAGS.has(image.tag))
  const rejectedIds = rejected.map((image) => image.id)
  const rejectedUpdates = rejected.map((image) => ({
    id: image.id,
    row: { status: 'rejected' as const, storage_path: null },
  }))
  const pathsToDelete = rejected.flatMap((image) =>
    image.storage_path ? [image.storage_path] : []
  )
  const ordered = images
    .filter((image) => !JUNK_TAGS.has(image.tag))
    .toSorted(
      (left, right) => TAG_RANK[left.tag] - TAG_RANK[right.tag] || right.score - left.score
    )

  return { rejectedIds, rejectedUpdates, pathsToDelete, ordered }
}

function classifyImagesClient(supabase: unknown): ClassifyImagesClient {
  return supabase as ClassifyImagesClient
}

async function getUnclassifiedImages(
  supabase: unknown,
  target: EnrichmentTarget
): Promise<BrandImageForClassification[]> {
  const storage = targetImageStorage(target)
  const { data, error } = await classifyImagesClient(supabase)
    .from(storage.table)
    .select('id, url, source, status, tags, score, sort_order, storage_path')
    .eq(storage.foreignKey, target.id)
    .eq('status', 'active')
    .neq('source', 'owner')
    .neq('source', 'admin')
    .is('tags', null)
    .order('sort_order', { ascending: true })

  if (error) throw error
  return data ?? []
}

async function getActiveImages(
  supabase: unknown,
  target: EnrichmentTarget
): Promise<BrandImageForClassification[]> {
  const storage = targetImageStorage(target)
  const { data, error } = await classifyImagesClient(supabase)
    .from(storage.table)
    .select('id, url, source, status, tags, score, sort_order, storage_path')
    .eq(storage.foreignKey, target.id)
    .eq('status', 'active')
    .order('sort_order', { ascending: true })

  if (error) throw error
  return data ?? []
}

async function updateImage(
  supabase: unknown,
  target: EnrichmentTarget,
  imageId: string,
  row: Record<string, unknown>
): Promise<void> {
  const storage = targetImageStorage(target)
  const { error } = await classifyImagesClient(supabase)
    .from(storage.table)
    .update(row)
    .eq('id', imageId)

  if (error) throw error
}

async function resetImageTags(
  supabase: unknown,
  target: EnrichmentTarget
): Promise<number> {
  const storage = targetImageStorage(target)
  const { data, error } = await classifyImagesClient(supabase)
    .from(storage.table)
    .update({ tags: null, score: null, alt_zh: null, alt_en: null })
    .eq(storage.foreignKey, target.id)
    .eq('status', 'active')
    .neq('source', 'owner')
    .neq('source', 'admin')
    .not('tags', 'is', null)
    .select('id')
  if (error) throw error
  return data?.length ?? 0
}

/**
 * Any reason the response cannot be trusted to describe the images we sent.
 * A non-null reason means the batch is abandoned untouched — never converted into
 * verdicts, because a null verdict used to be indistinguishable from a junk verdict
 * and deleted live images on transient API errors.
 */
function failureReason(response: OpenAIChatResult): string | null {
  if (!response.ok) return `request failed (HTTP ${response.status})`
  if (response.refusal) return `model refused: ${response.refusal}`
  if (response.finishReason === 'length') return 'response truncated (finish_reason=length)'
  if (!response.content || response.content.trim().length === 0) return 'empty response content'
  return null
}

function invalidImageUrlFromError(errorBody: unknown): string | null {
  if (!errorBody || typeof errorBody !== 'object') return null
  const { error } = errorBody as { error?: unknown }
  if (!error || typeof error !== 'object') return null

  const { code, message } = error as { code?: unknown; message?: unknown }
  if (code !== 'invalid_image_url' || typeof message !== 'string') return null

  const match = message.match(/https?:\/\/[^\s"']{1,2048}/)
  return match?.[0] ?? null
}

type ChunkOutcome = {
  /** Verdicts keyed by brand_images.id, only for images the model actually judged. */
  verdictsByImageId: Map<string, ParsedImageClassification>
  /** Non-null when the whole batch must be abandoned without touching any row. */
  failure: string | null
  /** Images OpenAI could not download — rejected, but their storage object is kept. */
  brokenImageIds: string[]
}

async function classifyChunk(
  client: ReturnType<typeof createAuditedOpenAIClient>,
  brandContext: string,
  chunk: BrandImageForClassification[]
): Promise<ChunkOutcome> {
  const brokenImageIds: string[] = []
  let remaining = chunk
  let retries = 0

  while (remaining.length > 0) {
    const imageByOrdinal = new Map(
      remaining.map((image, index): [string, BrandImageForClassification] => [String(index + 1), image])
    )
    const imageBySentUrl = new Map<string, BrandImageForClassification>()
    const sentUrls = remaining.map((image) => {
      const url = brandImageRenderUrl(
        { storagePath: image.storage_path, url: image.url },
        { width: CLASSIFY_RENDER_WIDTH }
      )
      imageBySentUrl.set(url, image)
      return url
    })
    const ordinals = [...imageByOrdinal.keys()]

    const response = await client.chat({
      system: IMAGE_CLASSIFY_SYSTEM_PROMPT,
      user: `${brandContext}請分類以下 ${remaining.length} 張品牌圖片，依序編號為 ${ordinals.join('、')}。回傳 JSON object，包含 "classifications" 陣列，每個物件的 "id" 必須是對應圖片的編號字串。無法判斷的圖片請省略，不要猜測。`,
      images: sentUrls,
      json: true,
      schema: IMAGE_CLASSIFICATION_SCHEMA,
      maxTokens: 250 * remaining.length,
      temperature: 0,
      meta: {
        imageIds: remaining.map((image) => image.id),
        imageUrls: sentUrls,
      },
    })

    const failure = failureReason(response)
    if (!failure) {
      const parsed = parseClassificationBatch(response.content ?? '')
      const verdictsByImageId = new Map<string, ParsedImageClassification>()
      for (const [ordinal, image] of imageByOrdinal) {
        const verdict = parsed.get(ordinal)
        if (verdict) verdictsByImageId.set(image.id, verdict)
      }
      return { verdictsByImageId, failure: null, brokenImageIds }
    }

    if (retries >= MAX_CHUNK_RETRIES) {
      return { verdictsByImageId: new Map(), failure, brokenImageIds }
    }

    const candidate = invalidImageUrlFromError(response.errorBody)
    // The message may append punctuation, so match on the URL we actually sent.
    const brokenUrl = candidate
      ? sentUrls.find((url) => candidate === url || candidate.startsWith(url))
      : undefined
    const broken = brokenUrl ? imageBySentUrl.get(brokenUrl) : undefined
    if (!broken) {
      return { verdictsByImageId: new Map(), failure, brokenImageIds }
    }

    brokenImageIds.push(broken.id)
    remaining = remaining.filter((image) => image.id !== broken.id)
    retries += 1
  }

  return { verdictsByImageId: new Map(), failure: null, brokenImageIds }
}

export async function runClassifyImagesPhase({
  brand,
  phases,
  dryRun = false,
  overwrite = false,
  target: requestedTarget,
  jobId,
}: ClassifyImagesPhaseOptions): Promise<ClassifyImagesPhaseOutput> {
  const target = requestedTarget ?? brandTarget(brand.id)
  if (!phases.includes('classify_images')) {
    return {
      phaseResult: buildPhaseResult(
        'classify_images',
        'skipped',
        [],
        0,
        undefined,
        'classify_images phase not requested'
      ),
      patch: {},
    }
  }

  if (dryRun) {
    return {
      phaseResult: buildPhaseResult('classify_images', 'skipped', [], 0, undefined, 'dry run'),
      patch: {},
    }
  }

  const supabase = createServiceClient()

  if (overwrite) {
    const resetCount = await resetImageTags(supabase, target)
    if (resetCount > 0) {
      console.log(`  [CLASSIFY] Reset tags on ${resetCount} images for reclassification`)
    }
  }

  const images = await getUnclassifiedImages(supabase, target)
  if (images.length === 0) {
    return {
      phaseResult: buildPhaseResult(
        'classify_images',
        'skipped',
        [],
        0,
        undefined,
        'no unclassified images'
      ),
      patch: {},
    }
  }

  const config = buildEnrichmentConfig('classify_images', IMAGE_CLASSIFY_SYSTEM_PROMPT, {
    model: 'gpt-4o-mini',
    batchSize: BATCH_SIZE,
    detail: 'low',
    temperature: 0,
  })
  const client = createAuditedOpenAIClient({
    target,
    phase: 'classify_images',
    ...(jobId ? { jobId } : {}),
    config,
  })
  const { result, durationMs } = await timePhase(async () => {
    const classifications: ClassifiedImage[] = []
    const pathsToDelete: string[] = []
    const failedBatches: string[] = []
    let unjudgedCount = 0
    let brokenCount = 0

    const productTypeZh = brand.product_type
      ? PRODUCT_TYPE_CATEGORIES.find((c) => c.slug === brand.product_type)?.nameZh
      : undefined
    const brandContext = productTypeZh
      ? `品牌：${brand.name ?? brand.slug}（${productTypeZh}）。`
      : `品牌：${brand.name ?? brand.slug}。`

    for (let i = 0; i < images.length; i += BATCH_SIZE) {
      const chunk = images.slice(i, i + BATCH_SIZE)
      const outcome = await classifyChunk(client, brandContext, chunk)
      const brokenIds = new Set(outcome.brokenImageIds)

      for (const brokenId of brokenIds) {
        // Undownloadable or dangling: reject the row but keep the storage object —
        // scripts/repair-brand-images.ts owns real cleanup.
        brokenCount += 1
        await updateImage(supabase, target, brokenId, { status: 'rejected' })
      }

      if (outcome.failure) {
        // Leave every remaining row untouched (tags stay null, status stays active)
        // so the next run retries them instead of destroying them.
        failedBatches.push(outcome.failure)
        console.error(
          `  [CLASSIFY] Batch of ${chunk.length} images skipped for ${target.type} ${target.id}: ${outcome.failure}`
        )
        continue
      }

      for (const image of chunk) {
        if (brokenIds.has(image.id)) continue

        const classification = outcome.verdictsByImageId.get(image.id)
        if (!classification) {
          // No verdict echoed for this image — leave the row alone, never reject it.
          unjudgedCount += 1
          continue
        }

        const classifiedImage = {
          id: image.id,
          tag: classification.tag,
          score: classification.score,
          storage_path: image.storage_path,
        }
        classifications.push(classifiedImage)
        const classificationResult = applyClassifications([classifiedImage])
        const rejectedUpdate = classificationResult.rejectedUpdates.at(0)
        pathsToDelete.push(...classificationResult.pathsToDelete)
        await updateImage(supabase, target, image.id, {
          tags: [classification.tag],
          score: classification.score,
          alt_zh: classification.altZh,
          alt_en: classification.altEn,
          ...(rejectedUpdate?.row ?? { status: 'active' }),
        })
      }
    }

    const activeImages = await getActiveImages(supabase, target)
    const { rejectedIds, rejectedUpdates, pathsToDelete: existingPathsToDelete, ordered } = applyClassifications(
      activeImages
        .map(classifiedImageFromRow)
        .filter((image): image is ClassifiedImage => image !== null)
    )

    for (const update of rejectedUpdates) {
      await updateImage(supabase, target, update.id, update.row)
    }
    pathsToDelete.push(...existingPathsToDelete)

    try {
      await deleteStoredImagePaths(pathsToDelete)
    } catch (storageError) {
      console.error(
        `[CLASSIFY] Failed to delete rejected images for ${target.type} ${target.id}:`,
        storageError
      )
    }

    // Human-chosen images are excluded from `ordered`, so reindexing from 0 would hand
    // sort_order 0 (the hero) to a classifier-managed image and steal it from an admin pick.
    const reservedSortOrders = new Set(
      activeImages
        .filter((row) => isExemptSource(row.source))
        .flatMap((row) => (typeof row.sort_order === 'number' ? [row.sort_order] : []))
    )

    let sortOrder = 0
    for (const image of ordered) {
      while (reservedSortOrders.has(sortOrder)) sortOrder += 1
      await updateImage(supabase, target, image.id, { sort_order: sortOrder })
      sortOrder += 1
    }

    if (target.type === 'brand') {
      await syncHeroDenormalized(supabase, target.id)
    }

    const finalActiveImages = target.type === 'submission'
      ? await getActiveImages(supabase, target)
      : []

    return {
      classifiedCount: classifications.length,
      rejectedCount: rejectedIds.length,
      unjudgedCount,
      brokenCount,
      failedBatches,
      heroImageUrl: finalActiveImages.at(0)?.url ?? null,
    }
  })

  const changedFields = result.classifiedCount > 0
    ? [target.type === 'brand' ? 'brand_images' : 'submission_images']
    : []
  const patch = target.type === 'submission' && result.classifiedCount > 0
    ? { hero_image_url: result.heroImageUrl }
    : {}

  const detail = [
    `${result.classifiedCount} classified`,
    `${result.rejectedCount} rejected`,
    ...(result.unjudgedCount > 0 ? [`${result.unjudgedCount} left unjudged`] : []),
    ...(result.brokenCount > 0 ? [`${result.brokenCount} undownloadable`] : []),
    ...(result.failedBatches.length > 0
      ? [`${result.failedBatches.length} batch(es) skipped: ${result.failedBatches.join('; ')}`]
      : []),
  ].join(', ')

  return {
    phaseResult: buildPhaseResult(
      'classify_images',
      'succeeded',
      changedFields,
      durationMs,
      undefined,
      detail
    ),
    patch,
  }
}
