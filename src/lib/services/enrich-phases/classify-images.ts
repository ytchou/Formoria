import { IMAGE_CLASSIFY_SYSTEM_PROMPT } from '@/lib/prompts'
import { createDeepSeekClient, parseDeepSeekJson } from '../deepseek-client'
import { pickHero, syncHeroDenormalized, type BrandImageRow } from '../brand-images'
import { createServiceClient } from '@/lib/supabase/server'
import type { PhaseResult } from '@/lib/types/curation'
import { buildPhaseResult, timePhase, type EnrichBrand, type EnrichPhase } from './types'

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

export type ImageClassificationTag =
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
  const raw = parseDeepSeekJson<RawClassification>(responseText)
    ?? (normalized ? parseDeepSeekJson<RawClassification>(normalized) : null)

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
  rawResponse: string | null
): Promise<void> {
  const { error } = await classifyImagesClient(supabase)
    .from('brand_ai_results')
    .insert({
      brand_id: brandId,
      phase: 'classify_images',
      model: 'deepseek-v4-flash',
      raw_response: { imageId, response: rawResponse },
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

export async function runClassifyImagesPhase({
  brand,
  phases,
  dryRun = false,
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

  const client = createDeepSeekClient()
  const { result, durationMs } = await timePhase(async () => {
    const classifications: ClassifiedImage[] = []

    for (const image of images) {
      const response = await client.chat({
        system: IMAGE_CLASSIFY_SYSTEM_PROMPT,
        user: 'Classify this brand image.',
        images: [image.url],
        json: true,
        maxTokens: 200,
        temperature: 0,
      })
      await insertRawClassificationResult(supabase, brand.id, image.id, response.content)

      const classification = response.content ? parseClassification(response.content) : null
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

    const activeImages = await getActiveImages(supabase, brand.id)
    const { rejectedIds, ordered } = applyClassifications(
      activeImages
        .map(classifiedImageFromRow)
        .filter((image): image is ClassifiedImage => image !== null)
    )
    for (const [index, image] of ordered.entries()) {
      await updateImage(supabase, image.id, { sort_order: index })
    }

    const reorderedActiveImages = await getActiveImages(supabase, brand.id)
    pickHero(reorderedActiveImages)
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
