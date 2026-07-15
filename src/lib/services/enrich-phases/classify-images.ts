import { IMAGE_CLASSIFY_SYSTEM_PROMPT } from '@/lib/prompts'
import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'
import { buildEnrichmentConfig } from '@/lib/constants/enrichment-config'
import { parseJson } from '../openai-client'
import { createAuditedOpenAIClient } from '../llm-audit'
import { syncHeroDenormalized, type BrandImageRow } from '../brand-images'
import { deleteStoredImagePaths } from '../image-upload'
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

const VALID_TAGS = new Set([
  'product',
  'lifestyle',
  'packaging',
  'logo',
  'promo',
  'text_banner',
  'irrelevant',
])
const JUNK_TAGS = new Set(['promo', 'text_banner', 'irrelevant', 'logo'])
const MIN_HERO_SCORE = 50

type ImageClassificationTag =
  | 'product'
  | 'lifestyle'
  | 'packaging'
  | 'logo'
  | 'promo'
  | 'text_banner'
  | 'irrelevant'

export type ParsedImageClassification = {
  tag: ImageClassificationTag
  score: number
  altZh: string
  altEn: string
}

export type ClassifiedImage = {
  id: string
  tag: ImageClassificationTag
  score: number
  storage_path?: string | null
}

type ImageClassificationInput = ClassifiedImage | {
  id: string
  tag: null
  score: 0
  storage_path?: string | null
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

function normalizeLooseJson(content: string): string | null {
  const trimmed = content.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null

  const entries = trimmed.slice(1, -1).split(',')
  const normalized = entries.map((entry) => {
    const separator = entry.indexOf(':')
    if (separator === -1) return null

    const key = entry.slice(0, separator).trim()
    const value = entry.slice(separator + 1).trim()
    if (!key || !value) return null

    const jsonKey = JSON.stringify(key.replace(/^["']|["']$/g, ''))
    const numericValue = Number(value)
    const jsonValue = Number.isFinite(numericValue)
      ? String(numericValue)
      : JSON.stringify(value.replace(/^["']|["']$/g, ''))

    return `${jsonKey}:${jsonValue}`
  })

  if (normalized.some((entry) => entry === null)) return null

  return `{${normalized.join(',')}}`
}

function isImageClassificationTag(value: unknown): value is ImageClassificationTag {
  return typeof value === 'string' && VALID_TAGS.has(value)
}

function scoreValue(value: BrandImageRow['score']): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value)
  return 0
}

function classifiedImageFromRow(row: BrandImageForClassification): ClassifiedImage | null {
  if (row.source === 'owner') return null

  const tag = row.tags?.find(isImageClassificationTag)
  if (!tag) return null

  return {
    id: row.id,
    tag,
    score: scoreValue(row.score),
    storage_path: row.storage_path,
  }
}

export function parseClassification(responseText: string): ParsedImageClassification | null {
  type RawClassification = {
    tag?: unknown
    score?: unknown
    alt_zh?: unknown
    alt_en?: unknown
  }

  const normalized = normalizeLooseJson(responseText)
  const raw = parseJson<RawClassification>(responseText)
    ?? (normalized ? parseJson<RawClassification>(normalized) : null)

  if (!raw || !isImageClassificationTag(raw.tag)) return null

  const score = typeof raw.score === 'number' ? raw.score : Number(raw.score)
  if (!Number.isFinite(score)) return null

  return {
    tag: raw.tag,
    score: Math.max(0, Math.min(100, Math.round(score))),
    altZh: typeof raw.alt_zh === 'string' ? localizeToTW(raw.alt_zh).text : '',
    altEn: typeof raw.alt_en === 'string' ? raw.alt_en : '',
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

export function parseClassificationBatch(
  responseText: string,
  count: number
): (ParsedImageClassification | null)[] {
  type RawClassification = {
    tag?: unknown
    score?: unknown
    alt_zh?: unknown
    alt_en?: unknown
  }

  const raw = parseJson<unknown>(responseText)
  const items = extractArray(raw) as RawClassification[] | null
  if (!items) return Array<null>(count).fill(null)

  return items.map((item) => {
    if (!item || !isImageClassificationTag(item.tag)) return null
    const score = typeof item.score === 'number' ? item.score : Number(item.score)
    if (!Number.isFinite(score)) return null
    return {
      tag: item.tag,
      score: Math.max(0, Math.min(100, Math.round(score))),
      altZh: typeof item.alt_zh === 'string' ? localizeToTW(item.alt_zh).text : '',
      altEn: typeof item.alt_en === 'string' ? item.alt_en : '',
    }
  })
}

export function applyClassifications(images: ImageClassificationInput[]): {
  rejectedIds: string[]
  rejectedUpdates: Array<{
    id: string
    row: { status: 'rejected'; storage_path: null }
  }>
  pathsToDelete: string[]
  ordered: ClassifiedImage[]
} {
  const rejected = images.filter(
    (image) => image.tag === null || JUNK_TAGS.has(image.tag)
  )
  const rejectedIds = rejected.map((image) => image.id)
  const rejectedUpdates = rejected.map((image) => ({
    id: image.id,
    row: { status: 'rejected' as const, storage_path: null },
  }))
  const pathsToDelete = rejected.flatMap((image) =>
    image.storage_path ? [image.storage_path] : []
  )
  const ordered = images
    .filter(
      (image): image is ClassifiedImage => image.tag !== null && !JUNK_TAGS.has(image.tag)
    )
    .toSorted((left, right) => right.score - left.score)

  return { rejectedIds, rejectedUpdates, pathsToDelete, ordered }
}

function classifyImagesClient(supabase: unknown): ClassifyImagesClient {
  return supabase as ClassifyImagesClient
}

export async function getUnclassifiedImages(
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

export async function resetImageTags(
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
    .not('tags', 'is', null)
    .select('id')
  if (error) throw error
  return data?.length ?? 0
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

    for (let i = 0; i < images.length; i += BATCH_SIZE) {
      const chunk = images.slice(i, i + BATCH_SIZE)

      const productTypeZh = brand.product_type
        ? PRODUCT_TYPE_CATEGORIES.find((c) => c.slug === brand.product_type)?.nameZh
        : undefined
      const brandContext = productTypeZh
        ? `品牌：${brand.name ?? brand.slug}（${productTypeZh}）。`
        : `品牌：${brand.name ?? brand.slug}。`

      const response = await client.chat({
        system: IMAGE_CLASSIFY_SYSTEM_PROMPT,
        user: `${brandContext}請分類以下 ${chunk.length} 張品牌圖片。回傳 JSON object，包含 "classifications" 陣列，每張圖片對應一個物件，順序與輸入相同。`,
        images: chunk.map((img) => img.url),
        json: true,
        maxTokens: 250 * chunk.length,
        temperature: 0,
        meta: {
          imageIds: chunk.map((image) => image.id),
          imageUrls: chunk.map((image) => image.url),
        },
      })

      const parsed = response.content
        ? parseClassificationBatch(response.content, chunk.length)
        : Array<null>(chunk.length).fill(null)

      for (let j = 0; j < chunk.length; j++) {
        const image = chunk[j]
        const classification = parsed[j] ?? null

        if (!classification) {
          const classificationResult = applyClassifications([{
            id: image.id,
            tag: null,
            score: 0,
            storage_path: image.storage_path,
          }])
          const rejectedUpdate = classificationResult.rejectedUpdates.at(0)
          if (rejectedUpdate) {
            await updateImage(supabase, target, rejectedUpdate.id, rejectedUpdate.row)
          }
          pathsToDelete.push(...classificationResult.pathsToDelete)
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

    if (ordered.length === 0 && classifications.length > 0) {
      const best = classifications
        .filter((image) => !JUNK_TAGS.has(image.tag))
        .toSorted((a, b) => b.score - a.score)
        .at(0)
      if (best && best.score >= MIN_HERO_SCORE) {
        await updateImage(supabase, target, best.id, { status: 'active', sort_order: 0 })
      }
    } else {
      for (const [index, image] of ordered.entries()) {
        await updateImage(supabase, target, image.id, { sort_order: index })
      }
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
      heroImageUrl: finalActiveImages.at(0)?.url ?? null,
    }
  })

  const changedFields = result.classifiedCount > 0
    ? [target.type === 'brand' ? 'brand_images' : 'submission_images']
    : []
  const patch = target.type === 'submission' && result.classifiedCount > 0
    ? { hero_image_url: result.heroImageUrl }
    : {}

  return {
    phaseResult: buildPhaseResult(
      'classify_images',
      'succeeded',
      changedFields,
      durationMs,
      undefined,
      `${result.classifiedCount} classified, ${result.rejectedCount} rejected`
    ),
    patch,
  }
}
