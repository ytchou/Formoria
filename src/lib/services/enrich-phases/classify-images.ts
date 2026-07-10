import { IMAGE_CLASSIFY_SYSTEM_PROMPT } from '@/lib/prompts'
import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'
import { buildEnrichmentConfig } from '@/lib/constants/enrichment-config'
import { createOpenAIClient, parseJson } from '../openai-client'
import { syncHeroDenormalized, type BrandImageRow } from '../brand-images'
import { createServiceClient } from '@/lib/supabase/server'
import type { PhaseResult } from '@/lib/types/curation'
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
}

type ClassifyImagesPhaseOptions = {
  brand: EnrichBrand
  phases: EnrichPhase[]
  dryRun?: boolean
  overwrite?: boolean
}

type ClassifyImagesPhaseOutput = {
  phaseResult: PhaseResult
}

type BrandImageForClassification = BrandImageRow & {
  id: string
  alt_zh?: string | null
  alt_en?: string | null
}

type BrandImagesSelectQuery = {
  eq: (column: string, value: string) => BrandImagesSelectQuery
  is: (column: string, value: null) => BrandImagesSelectQuery
  order: (
    column: string,
    options: { ascending: boolean }
  ) => Promise<{ data: BrandImageForClassification[] | null; error: unknown }>
}

type BrandImagesUpdateQuery = {
  eq: (column: string, value: string) => Promise<{ error: unknown }>
}

type AiResultsTable = {
  insert: (row: Record<string, unknown>) => Promise<{ error: unknown }>
}

type BrandImagesTable = {
  select: (columns: string) => BrandImagesSelectQuery
  update: (row: Record<string, unknown>) => BrandImagesUpdateQuery
}

type ClassifyImagesClient = {
  from(table: 'brand_images'): BrandImagesTable
  from(table: 'brand_ai_results'): AiResultsTable
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
  const tag = row.tags?.find(isImageClassificationTag)
  if (!tag) return null

  return {
    id: row.id,
    tag,
    score: scoreValue(row.score),
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
    altZh: typeof raw.alt_zh === 'string' ? raw.alt_zh : '',
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
      altZh: typeof item.alt_zh === 'string' ? item.alt_zh : '',
      altEn: typeof item.alt_en === 'string' ? item.alt_en : '',
    }
  })
}

export function applyClassifications(images: ClassifiedImage[]): {
  rejectedIds: string[]
  ordered: ClassifiedImage[]
} {
  const rejectedIds = images
    .filter((image) => JUNK_TAGS.has(image.tag))
    .map((image) => image.id)
  const ordered = images
    .filter((image) => !JUNK_TAGS.has(image.tag))
    .toSorted((left, right) => right.score - left.score)

  return { rejectedIds, ordered }
}

function classifyImagesClient(supabase: unknown): ClassifyImagesClient {
  return supabase as ClassifyImagesClient
}

async function insertRawClassificationResult(
  supabase: unknown,
  brandId: string,
  imageId: string,
  rawResponse: string | null,
  config: unknown,
  latencyMs: number
): Promise<void> {
  const { error } = await classifyImagesClient(supabase)
    .from('brand_ai_results')
    .insert({
      brand_id: brandId,
      phase: 'classify_images',
      model: 'gpt-4o-mini',
      raw_response: { imageId, response: rawResponse },
      config,
      latency_ms: latencyMs,
    })

  if (error) throw error
}

async function getUnclassifiedImages(
  supabase: unknown,
  brandId: string
): Promise<BrandImageForClassification[]> {
  const { data, error } = await classifyImagesClient(supabase)
    .from('brand_images')
    .select('id, url, status, tags, score, sort_order')
    .eq('brand_id', brandId)
    .eq('status', 'active')
    .is('tags', null)
    .order('sort_order', { ascending: true })

  if (error) throw error
  return data ?? []
}

async function getActiveImages(
  supabase: unknown,
  brandId: string
): Promise<BrandImageForClassification[]> {
  const { data, error } = await classifyImagesClient(supabase)
    .from('brand_images')
    .select('id, url, status, tags, score, sort_order')
    .eq('brand_id', brandId)
    .eq('status', 'active')
    .order('sort_order', { ascending: true })

  if (error) throw error
  return data ?? []
}

async function updateImage(
  supabase: unknown,
  imageId: string,
  row: Record<string, unknown>
): Promise<void> {
  const { error } = await classifyImagesClient(supabase)
    .from('brand_images')
    .update(row)
    .eq('id', imageId)

  if (error) throw error
}

async function resetImageTags(supabase: unknown, brandId: string): Promise<number> {
  const active = await getActiveImages(supabase, brandId)
  const tagged = active.filter((img) => img.tags && img.tags.length > 0)
  for (const img of tagged) {
    await updateImage(supabase, img.id, { tags: null, score: null, alt_zh: null, alt_en: null, status: 'active' })
  }
  return tagged.length
}

export async function runClassifyImagesPhase({
  brand,
  phases,
  dryRun = false,
  overwrite = false,
}: ClassifyImagesPhaseOptions): Promise<ClassifyImagesPhaseOutput> {
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
    }
  }

  if (dryRun) {
    return {
      phaseResult: buildPhaseResult('classify_images', 'skipped', [], 0, undefined, 'dry run'),
    }
  }

  const supabase = createServiceClient()

  if (overwrite) {
    const resetCount = await resetImageTags(supabase, brand.id)
    if (resetCount > 0) {
      console.log(`  [CLASSIFY] Reset tags on ${resetCount} images for reclassification`)
    }
  }

  const images = await getUnclassifiedImages(supabase, brand.id)
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
    }
  }

  const client = createOpenAIClient()
  const config = buildEnrichmentConfig('classify_images', IMAGE_CLASSIFY_SYSTEM_PROMPT, {
    model: 'gpt-4o-mini',
    batchSize: BATCH_SIZE,
    detail: 'low',
    temperature: 0,
  })
  const { result, durationMs } = await timePhase(async () => {
    const classifications: ClassifiedImage[] = []

    for (let i = 0; i < images.length; i += BATCH_SIZE) {
      const chunk = images.slice(i, i + BATCH_SIZE)

      const batchStart = Date.now()
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
      })
      const batchLatencyMs = Date.now() - batchStart

      const parsed = response.content
        ? parseClassificationBatch(response.content, chunk.length)
        : Array<null>(chunk.length).fill(null)

      for (let j = 0; j < chunk.length; j++) {
        const image = chunk[j]
        const classification = parsed[j] ?? null

        await insertRawClassificationResult(supabase, brand.id, image.id, response.content, config, batchLatencyMs)

        if (!classification) {
          await updateImage(supabase, image.id, { status: 'rejected' })
          continue
        }

        classifications.push({
          id: image.id,
          tag: classification.tag,
          score: classification.score,
        })
        await updateImage(supabase, image.id, {
          tags: [classification.tag],
          score: classification.score,
          alt_zh: classification.altZh,
          alt_en: classification.altEn,
          status: JUNK_TAGS.has(classification.tag) ? 'rejected' : 'active',
        })
      }
    }

    const activeImages = await getActiveImages(supabase, brand.id)
    const { rejectedIds, ordered } = applyClassifications(
      activeImages
        .map(classifiedImageFromRow)
        .filter((image): image is ClassifiedImage => image !== null)
    )

    for (const id of rejectedIds) {
      await updateImage(supabase, id, { status: 'rejected' })
    }

    if (ordered.length === 0 && classifications.length > 0) {
      const best = classifications.toSorted((a, b) => b.score - a.score)[0]
      await updateImage(supabase, best.id, { status: 'active', sort_order: 0 })
    } else {
      for (const [index, image] of ordered.entries()) {
        await updateImage(supabase, image.id, { sort_order: index })
      }
    }

    await syncHeroDenormalized(supabase, brand.id)

    return {
      classifiedCount: classifications.length,
      rejectedCount: rejectedIds.length,
    }
  })

  const changedFields = result.classifiedCount > 0
    ? ['brand_images']
    : []

  return {
    phaseResult: buildPhaseResult(
      'classify_images',
      'succeeded',
      changedFields,
      durationMs,
      undefined,
      `${result.classifiedCount} classified, ${result.rejectedCount} rejected`
    ),
  }
}
