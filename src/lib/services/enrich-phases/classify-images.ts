import { z } from 'zod'
import { IMAGE_CLASSIFY_SYSTEM_PROMPT } from '@/lib/prompts'
import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'
import { buildEnrichmentConfig } from '@/lib/constants/enrichment-config'
import { MAX_BRAND_ACTIVE_IMAGES } from '@/lib/constants/brand-images'
import { parseJson, type OpenAIChatResult } from '../openai-client'
import { createAuditedOpenAIClient } from '../llm-audit'
import { syncHeroDenormalized, type BrandImageRow } from '../brand-images'
import { brandImageRenderUrl } from '../image-upload'
import { localizeToTW } from '../taiwan-localization'
import { createServiceClient } from '@/lib/supabase/server'
import type { PhaseResult } from '@/lib/types/curation'
import {
  brandTarget,
  targetImageStorage,
  type EnrichmentTarget,
} from '../enrichment-target'
import { buildPhaseResult, timePhase, type EnrichBrand, type EnrichPhase } from './types'

/**
 * Small on purpose. A twenty-image batch let one uncertain verdict propagate
 * across the whole batch — measured once as all ten of a brand's images
 * flipping to wrong_brand in a single run and back the next. The prompt asks
 * for per-image independence; a short batch enforces it structurally. Extra
 * calls cost only the repeated system prompt, which image tokens dwarf.
 *
 * Nothing in the contract now spans images — see REJECTION_REASONS — so batch
 * length is purely a cost and stability knob, not a correctness one.
 */
const BATCH_SIZE = 5

/**
 * LEGACY. The seven-value vocabulary rows were written with before the
 * disposition/reasons contract landed. Kept only so `classifiedImageFromRow` and
 * `parseClassificationBatch` can still read old rows; the model is never
 * offered these values (see KEEP_TAGS, which is what feeds the schema).
 */
const IMAGE_TAGS = [
  'product',
  'lifestyle',
  'packaging',
  'logo',
  'promo',
  'text_banner',
  'irrelevant',
] as const

/**
 * The only tags the model may return, and the only ones written to new rows.
 *
 * Collapsed from four to two: `lifestyle` and `packaging` folded into `product`
 * because the distinction never changed what we do with the image — all three
 * are "this picture is about the product" — and a four-way choice cost the model
 * accuracy on the decision that actually matters (keep vs reject).
 *   - product: the image is primarily about the product — a direct product shot,
 *     a model using it, or its packaging.
 *   - logo: brand identity / brand-story imagery — related to the brand, but not
 *     directly about the product.
 * Everything else is a rejection, which the disposition/reasons contract carries.
 */
const KEEP_TAGS = ['product', 'logo'] as const

/**
 * LEGACY tags that are still valid images, mapped onto their modern equivalent.
 * Rows written before the collapse carry `lifestyle`/`packaging`; without this
 * map they would fail the narrowed `isKeptImageTag` check, parse as `null`, and
 * silently drop out of the hero-eligible set.
 */
const LEGACY_KEEP_TAG_ALIASES: Record<string, KeptImageTag> = {
  lifestyle: 'product',
  packaging: 'product',
}

/**
 * No `duplicate`. Deduplication is the download layer's job — exact-URL, then
 * Instagram-variant, then perceptual dHash — and it runs before an image is
 * ever stored. Asking the model to do it too was the last cross-image rule in
 * the prompt, and measurably the last source of instability: over three
 * identical runs every per-image verdict was reproducible while a brand's
 * `duplicate` calls flipped, discarding two good product photos in one run and
 * keeping them in the others. One layer owns dedupe.
 */
const REJECTION_REASONS = [
  'wrong_brand',
  'time_sensitive',
  'promo_subject',
  'text_dominant',
  'low_visual_quality',
  'irrelevant',
] as const

const VALID_TAGS = new Set<string>(IMAGE_TAGS)

/**
 * LEGACY compat set. These tag values can only come from rows written before the
 * disposition/reasons contract — the model can no longer produce them. The live
 * rejection path is `disposition === 'reject'` plus `rejection_reasons`.
 */
export const JUNK_TAGS = new Set(['promo', 'text_banner', 'irrelevant'])

/**
 * Hero ordering is a pure quality sort — the tag no longer participates.
 *
 * Tag-major ranking existed to stop high-scoring logos taking every hero slot,
 * but it also pinned genuinely worse product shots above genuinely better brand
 * imagery. With the vocabulary down to two tags the ranking signal has to come
 * from the score itself, corrected for the one shape effect we measured:
 * 58% of human-rejected images were portrait versus 23% of kept ones.
 *
 * PROVISIONAL: 15 points is a judgement call, not a fitted value — enough to
 * demote a portrait past a comparable landscape, not enough to bury it. Ceiling:
 * it is one flat number for every brand. Upgrade path: calibrate against the
 * image-eval golden set once it has enough labelled portrait heroes.
 */
const PORTRAIT_PENALTY = 15

/** Images a human picked. The classifier must never retag, reorder away, or delete these. */
const EXEMPT_SOURCES = new Set(['owner', 'admin'])

/**
 * sort_order doubles as the hero designation (position 0) and as the gallery
 * order. The publishability guards encode that: no duplicate sort_orders among
 * active rows, and `sort_order between 0 and MAX_BRAND_ACTIVE_SORT_ORDER` —
 * which is what caps a brand's active images. A brand may legitimately have no
 * active row at 0 while its images are being staged; the hero is whichever
 * active row holds the lowest sort_order.
 */
const MAX_ACTIVE_IMAGES = MAX_BRAND_ACTIVE_IMAGES

/**
 * `high` tiles the image rather than capping it at 512px, which would sharpen
 * the blur and text-density judgements. It is not worth it here: gpt-4o-mini
 * bills image tokens at ~33x the standard tile rate, so a 1024px image costs
 * ~25k tokens against a 128k window, and our own download gate admits images
 * at a 480px short edge — high detail would mostly be paying to look closely
 * at upscaled pixels. Revisit if the floor rises well above 768px.
 */
const CLASSIFY_IMAGE_DETAIL = 'low' as const

/** Width sent to the vision model — `detail: 'low'` downsamples to 512px anyway. */
const CLASSIFY_RENDER_WIDTH = 512

/**
 * Kept images must score at least this. Deliberately set at the rubric's
 * "unusable" boundary rather than at "unremarkable": it is the one gate no
 * human has calibrated yet, and the sharpness and entropy gates it would
 * otherwise stand in for were both measured net-negative and removed. Raise it
 * once the 231 labelled images say what it costs in true keeps.
 */
const MIN_KEEP_SCORE = 40

/** One retry per chunk, and only after dropping an image OpenAI could not download. */
const MAX_CHUNK_RETRIES = 1

/** LEGACY-inclusive union: what a stored row may carry, not what the model may emit. */
type ImageClassificationTag = (typeof IMAGE_TAGS)[number]
type KeptImageTag = (typeof KEEP_TAGS)[number]
type ImageRejectionReason = (typeof REJECTION_REASONS)[number]

type ParsedImageClassification = {
  disposition: 'keep' | 'reject'
  tag: KeptImageTag | null
  reasons: ImageRejectionReason[]
  score: number
  altZh: string
  altEn: string
}

type ClassifiedImage = {
  id: string
  tag: ImageClassificationTag
  score: number
  storage_path?: string | null
  disposition?: 'keep' | 'reject'
  rejectionReasons?: ImageRejectionReason[]
  /** Only used to detect portrait orientation for the hero ranking. */
  width?: number | null
  height?: number | null
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
          disposition: z.enum(['keep', 'reject']),
          tag: z.enum(KEEP_TAGS).nullable(),
          reasons: z.array(z.enum(REJECTION_REASONS)),
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
  in: (column: string, values: string[]) => BrandImagesSelectQuery
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

function isKeptImageTag(value: unknown): value is KeptImageTag {
  return typeof value === 'string' && KEEP_TAGS.includes(value as KeptImageTag)
}

/**
 * A current keep tag, or the modern equivalent of a legacy one. Returns null for
 * anything that is not a keepable image.
 *
 * This is the single place the four-tag vocabulary is collapsed into two, and it
 * runs on both read paths (stored rows and model responses) so a pre-collapse
 * `lifestyle`/`packaging` row keeps parsing as a valid kept image instead of
 * quietly becoming hero-ineligible.
 */
function keptImageTag(value: unknown): KeptImageTag | null {
  if (isKeptImageTag(value)) return value
  if (typeof value !== 'string') return null
  return LEGACY_KEEP_TAG_ALIASES[value] ?? null
}

function isImageRejectionReason(value: unknown): value is ImageRejectionReason {
  return typeof value === 'string' && REJECTION_REASONS.includes(value as ImageRejectionReason)
}

function scoreValue(value: BrandImageRow['score']): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value)
  return 0
}

function isExemptSource(source: BrandImageRow['source'] | string | null): boolean {
  return typeof source === 'string' && EXEMPT_SOURCES.has(source)
}

function classifiedImageFromRow(row: BrandImageForClassification): ClassifiedImage | null {
  if (isExemptSource(row.source)) return null

  const storedTag = row.tags?.find(isImageClassificationTag)
  if (!storedTag) return null

  // Legacy `lifestyle`/`packaging` rows normalize to `product` here so the rest
  // of the pipeline only ever sees the current two-tag vocabulary.
  const tag: ImageClassificationTag = keptImageTag(storedTag) ?? storedTag

  return {
    id: row.id,
    tag,
    score: scoreValue(row.score),
    storage_path: row.storage_path,
    width: row.width ?? null,
    height: row.height ?? null,
    disposition: JUNK_TAGS.has(storedTag) ? 'reject' : 'keep',
    ...(storedTag === 'promo' ? { rejectionReasons: ['promo_subject' as const] } : {}),
    ...(storedTag === 'text_banner' ? { rejectionReasons: ['text_dominant' as const] } : {}),
    ...(storedTag === 'irrelevant' ? { rejectionReasons: ['irrelevant' as const] } : {}),
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
export function parseClassificationBatch(responseText: string): Map<string, ParsedImageClassification> {
  type RawClassification = {
    id?: unknown
    disposition?: unknown
    tag?: unknown
    reasons?: unknown
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
    const score = typeof item.score === 'number' ? item.score : Number(item.score)
    if (!Number.isFinite(score)) continue

    // Legacy tags (`lifestyle`, `packaging`) normalize onto `product` rather than
    // failing the narrowed keep check, which would drop the verdict entirely.
    const normalizedTag = keptImageTag(item.tag)

    const disposition = item.disposition === 'keep' || item.disposition === 'reject'
      ? item.disposition
      : JUNK_TAGS.has(item.tag as string)
        ? 'reject'
        : normalizedTag
          ? 'keep'
          : null
    if (!disposition) continue

    const tag = disposition === 'keep' ? normalizedTag : null
    if (disposition === 'keep' && !tag) continue

    const parsedReasons = Array.isArray(item.reasons)
      ? [...new Set(item.reasons.filter(isImageRejectionReason))]
      : []
    const legacyReasons: ImageRejectionReason[] = item.tag === 'promo'
      ? ['promo_subject']
      : item.tag === 'text_banner'
        ? ['text_dominant']
        : item.tag === 'irrelevant'
          ? ['irrelevant']
          : []

    const reasons = parsedReasons.length > 0 ? parsedReasons : legacyReasons
    if (disposition === 'keep' && reasons.length > 0) continue
    if (disposition === 'reject' && reasons.length === 0) continue

    // The quality floor lives here rather than in the prompt: the model returns a
    // score either way, so the threshold can be swept against scores already in
    // the database without spending a single API call, and moving it is a code
    // change rather than a prompt revision that invalidates the eval baseline.
    const clampedScore = Math.max(0, Math.min(100, Math.round(score)))
    const belowFloor = disposition === 'keep' && clampedScore < MIN_KEEP_SCORE

    verdicts.set(id, {
      disposition: belowFloor ? 'reject' : disposition,
      tag: belowFloor ? null : tag,
      reasons: belowFloor ? ['low_visual_quality'] : reasons,
      score: clampedScore,
      altZh: typeof item.alt_zh === 'string' ? localizeToTW(item.alt_zh).text : '',
      altEn: typeof item.alt_en === 'string' ? item.alt_en : '',
    })
  }

  return verdicts
}

/** Taller than wide. Square and unknown-dimension images are not penalised. */
function isPortrait(image: ClassifiedImage): boolean {
  const { width, height } = image
  return typeof width === 'number' && typeof height === 'number' && height > width
}

/**
 * The single ranking signal for hero selection: the model's quality score, minus
 * a fixed penalty for portrait orientation.
 *
 * A penalty rather than an exclusion, because portrait images are perfectly good
 * gallery entries — they just crop badly in the landscape hero frame. At 15 a
 * portrait must be clearly better than its landscape rivals to take slot 0, but
 * a brand whose only images are portrait still gets a hero.
 *
 * The kept band is MIN_KEEP_SCORE-100. The prompt pushes the model to spread
 * scores across that range rather than cluster near 85, because this sort is
 * the only thing deciding which image leads the page.
 */
function heroQuality(image: ClassifiedImage): number {
  return image.score - (isPortrait(image) ? PORTRAIT_PENALTY : 0)
}

export function applyClassifications(images: ClassifiedImage[]): {
  rejectedIds: string[]
  rejectedUpdates: Array<{
    id: string
    row: {
      status: 'rejected'
      storage_path: string | null
      tags: null
      rejection_reasons?: ImageRejectionReason[] | null
    }
  }>
  ordered: ClassifiedImage[]
} {
  const rejected = images.filter((image) => image.disposition === 'reject' || JUNK_TAGS.has(image.tag))
  const rejectedIds = rejected.map((image) => image.id)
  const rejectedUpdates = rejected.map((image) => ({
    id: image.id,
    row: {
      status: 'rejected' as const,
      storage_path: image.storage_path ?? null,
      tags: null,
      ...(image.rejectionReasons ? { rejection_reasons: image.rejectionReasons } : {}),
    },
  }))
  const ordered = images
    .filter((image) => image.disposition !== 'reject' && !JUNK_TAGS.has(image.tag))
    .toSorted((left, right) => heroQuality(right) - heroQuality(left))

  return { rejectedIds, rejectedUpdates, ordered }
}

export type ActiveImageForOrdering = {
  id: string
  source?: string | null
  sort_order?: number | null
}

/**
 * Decides the final sort_order of every active image, and which ones have to
 * step down to stay inside the MAX_ACTIVE_IMAGES window.
 *
 * Exists because the reindex used to walk only *judged* images. An image the
 * vision model returned no verdict for is deliberately left active, but it was
 * then skipped here and kept the column default of 0 — so a submission could
 * end up with ten active rows all claiming to be the hero, which the app reads
 * as "has a hero" and the database rejects as "not exactly one".
 *
 * Judged images keep the classifier's ranking; unjudged ones are appended after
 * them, never ahead, so an unranked image cannot displace a scored product shot
 * as the hero. Human picks are never reordered or demoted — their positions are
 * reserved and merely counted against the cap.
 */
export function planActiveImageOrder(input: {
  activeImages: ActiveImageForOrdering[]
  rankedJudgedIds: string[]
}): { assignments: Array<{ id: string; sortOrder: number }>; demotedIds: string[] } {
  const { activeImages, rankedJudgedIds } = input

  const exempt = activeImages.filter((row) => isExemptSource(row.source))
  const managed = activeImages.filter((row) => !isExemptSource(row.source))

  const rankIndex = new Map(rankedJudgedIds.map((id, index) => [id, index]))
  const judged = managed
    .filter((row) => rankIndex.has(row.id))
    .toSorted((left, right) => rankIndex.get(left.id)! - rankIndex.get(right.id)!)
  // Unjudged rows keep their incoming order (getActiveImages sorts by
  // sort_order) so repeated runs do not shuffle the gallery for no reason.
  const unjudged = managed.filter((row) => !rankIndex.has(row.id))

  const ranked = [...judged, ...unjudged]
  const capacity = Math.max(0, MAX_ACTIVE_IMAGES - exempt.length)
  const keep = ranked.slice(0, capacity)
  const demotedIds = ranked.slice(capacity).map((row) => row.id)

  const reserved = new Set(
    exempt.flatMap((row) => (typeof row.sort_order === 'number' ? [row.sort_order] : [])),
  )

  const assignments: Array<{ id: string; sortOrder: number }> = []
  let sortOrder = 0
  for (const row of keep) {
    while (reserved.has(sortOrder)) sortOrder += 1
    assignments.push({ id: row.id, sortOrder })
    sortOrder += 1
  }

  return { assignments, demotedIds }
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
    .select('id, url, source, status, tags, score, sort_order, storage_path, width, height')
    .eq(storage.foreignKey, target.id)
    .in('status', ['active', 'candidate'])
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
    .select('id, url, source, status, tags, score, sort_order, storage_path, width, height')
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
    .update({
      tags: null,
      score: null,
      alt_zh: null,
      alt_en: null,
      rejection_reasons: null,
      rejected_at: null,
    })
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
      user: `${brandContext}Classify the ${remaining.length} brand images that follow, numbered ${ordinals.join(', ')} in order. Return a JSON object with a "classifications" array holding exactly ${remaining.length} objects, whose "id" values are the image numbers as strings. Do not omit any image.`,
      images: sentUrls,
      imageDetail: CLASSIFY_IMAGE_DETAIL,
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

/**
 * Identifying context sent with every classification batch.
 *
 * The name alone is not enough to answer "is this the right brand?". Marketplace
 * listings (Pinkoi, Shopee, momo) carry the seller's storefront rather than a
 * visible logo, so a model given only a name it does not recognise has nothing
 * to check against — and measured over three identical runs it resolved that
 * uncertainty differently each time, once rejecting an entire ten-image batch as
 * wrong_brand and twice keeping all ten. The official domain gives it something
 * verifiable.
 *
 * English, matching the system prompt — only alt_zh is Chinese, and the prompt
 * asks for that explicitly. Shared with `scripts/image-eval/baseline.ts` so the
 * harness measures the context production actually sends; the corpus manifest
 * carries no website, so it passes `website: null` until the next capture.
 */
export function buildBrandContext(brand: {
  name: string | null
  productType: string | null
  website: string | null
}): string {
  const parts: string[] = [`Brand: ${brand.name ?? 'unknown'}.`]

  const category = brand.productType
    ? PRODUCT_TYPE_CATEGORIES.find((c) => c.slug === brand.productType)?.name
    : undefined
  if (category) parts.push(`Category: ${category}.`)

  const host = (() => {
    const raw = brand.website?.trim()
    if (!raw) return null
    try {
      return new URL(raw).hostname.replace(/^www\./, '')
    } catch {
      return null
    }
  })()
  if (host) parts.push(`Official site: ${host}.`)

  return `${parts.join(' ')} `
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
    // Duplicates DEFAULT_OPENAI_MODEL in openai-client.ts because this object is the
    // stored audit contract: if the two drift, every brand_ai_results row for this
    // phase records a model that never ran. Change both together.
    model: 'gpt-5.6-luna',
    batchSize: BATCH_SIZE,
    detail: CLASSIFY_IMAGE_DETAIL,
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
    const failedBatches: string[] = []
    let unjudgedCount = 0
    let brokenCount = 0
    let rejectedCount = 0

    const brandContext = buildBrandContext({
      name: brand.name ?? brand.slug,
      productType: brand.product_type ?? null,
      website: brand.purchase_website ?? null,
    })

    for (let i = 0; i < images.length; i += BATCH_SIZE) {
      const chunk = images.slice(i, i + BATCH_SIZE)
      const outcome = await classifyChunk(client, brandContext, chunk)
      const brokenIds = new Set(outcome.brokenImageIds)

      for (const brokenId of brokenIds) {
        // Undownloadable or dangling: retain the object for the seven-day
        // classifier retention window so the failure remains inspectable.
        brokenCount += 1
        rejectedCount += 1
        await updateImage(supabase, target, brokenId, {
          status: 'rejected',
          tags: null,
          rejection_reasons: ['low_visual_quality'],
          rejected_at: new Date().toISOString(),
        })
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

        const classifiedImage: ClassifiedImage = {
          id: image.id,
          tag: classification.tag ?? 'irrelevant',
          score: classification.score,
          storage_path: image.storage_path,
          width: image.width ?? null,
          height: image.height ?? null,
          disposition: classification.disposition,
          rejectionReasons: classification.reasons,
        }
        classifications.push(classifiedImage)
        const rejected = classification.disposition === 'reject'
        if (rejected) rejectedCount += 1
        await updateImage(supabase, target, image.id, {
          tags: rejected ? null : [classification.tag as KeptImageTag],
          score: classification.score,
          alt_zh: classification.altZh,
          alt_en: classification.altEn,
          status: rejected ? 'rejected' : 'active',
          rejection_reasons: rejected ? classification.reasons : null,
          rejected_at: rejected ? new Date().toISOString() : null,
        })
      }
    }

    const activeImages = await getActiveImages(supabase, target)
    const { rejectedIds, rejectedUpdates, ordered } = applyClassifications(
      activeImages
        .map(classifiedImageFromRow)
        .filter((image): image is ClassifiedImage => image !== null)
    )

    for (const update of rejectedUpdates) {
      await updateImage(supabase, target, update.id, {
        ...update.row,
        rejected_at: new Date().toISOString(),
      })
    }
    rejectedCount += rejectedIds.length

    // Reindex every row that is still active — including ones the model never
    // judged. Human-chosen images keep their reserved positions so a
    // classifier-managed image cannot steal sort_order 0 from an admin pick.
    const rejectedIdSet = new Set(rejectedIds)
    const { assignments, demotedIds } = planActiveImageOrder({
      activeImages: activeImages.filter((row) => !rejectedIdSet.has(row.id)),
      rankedJudgedIds: ordered.map((image) => image.id),
    })

    for (const { id, sortOrder } of assignments) {
      await updateImage(supabase, target, id, { sort_order: sortOrder })
    }

    // Overflow past the MAX_ACTIVE_IMAGES window steps down to 'rejected', but
    // its storage object is deliberately kept: these ranked below the cap, they
    // are not junk, and deleting them would be irreversible.
    for (const id of demotedIds) {
      await updateImage(supabase, target, id, { status: 'rejected' })
    }

    if (target.type === 'brand') {
      await syncHeroDenormalized(supabase, target.id)
    }

    const finalActiveImages = target.type === 'submission'
      ? await getActiveImages(supabase, target)
      : []

    return {
      classifiedCount: classifications.length,
      rejectedCount,
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
