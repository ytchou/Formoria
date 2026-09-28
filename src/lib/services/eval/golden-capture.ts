/**
 * Pure mappers behind `llm-eval dataset capture` and `dataset harvest`
 * (DEV-1873): classify a model call to one of the four golden prompts by its
 * system text, derive what each prompt's scorers need, and shape Langfuse
 * dataset items. No I/O here; the CLI does the reads and writes.
 *
 * Every item stores `input` as the raw user string production sent, never an
 * object, so a replay sends the exact message (name-arbiter lesson).
 *
 * DEV-1898 adds agreement sets (D11): the incumbent model's own answer, captured
 * zero-write, is the reference. Their items store the full captured request
 * (`{ user, messages, schema, ... }`) and the captured output as
 * `expectedOutput.output`; see `agreementCallsToItems`.
 */

import { createHash } from 'node:crypto'

import { PRODUCTS_LABELS } from '@/lib/prompts'
import { productUrlKey } from '../enrich-phases/product-candidates'
import { brandSiteUrl } from '../enrich-phases/products/graph'
import { DESCRIPTION_ORIGIN_OMITTED } from '../enrich-phases/products/verify'
import { MAX_PROMPT_LENGTH, PROMPT_TRUNCATION_MARK, type CapturedCall } from '../llm-audit'
import type { ChatMessage, OpenAIJsonSchema } from '../openai-client'
import type { ProductsGoldenContext } from './product-scorers'

// ---------------------------------------------------------------------------
// Prompts and datasets
// ---------------------------------------------------------------------------

/** Labelled or rule-scored golden sets (DEV-1873). */
export const LEGACY_GOLDEN_PROMPTS = [
  'acquisition-plan',
  'acquisition-critique',
  'products-repair',
  'products',
] as const

/**
 * Agreement sets (DEV-1898 D11/D3/D17). Each key is the Langfuse prompt name
 * the phase compiles, so classification matches the text production sends.
 */
export const AGREEMENT_PROMPTS = [
  'brand-facts',
  'founding-facts',
  'founding-facts-verify',
  'faq-preamble',
  'stockists',
  'editorial-repair',
  'classify-images',
  'sentry-classify',
] as const

export const GOLDEN_PROMPTS = [...LEGACY_GOLDEN_PROMPTS, ...AGREEMENT_PROMPTS] as const

export type GoldenPrompt = (typeof GOLDEN_PROMPTS)[number]
export type AgreementPrompt = (typeof AGREEMENT_PROMPTS)[number]

export function isAgreementPrompt(prompt: GoldenPrompt): prompt is AgreementPrompt {
  return (AGREEMENT_PROMPTS as readonly string[]).includes(prompt)
}

export const GOLDEN_DATASETS: Record<GoldenPrompt, string> = {
  'acquisition-plan': 'acquisition-plan-golden',
  'acquisition-critique': 'acquisition-critique-golden',
  'products-repair': 'products-repair-golden',
  products: 'products-fallback-golden',
  'brand-facts': 'brand-facts-agreement',
  'founding-facts': 'founding-facts-agreement',
  'founding-facts-verify': 'founding-facts-verify-agreement',
  'faq-preamble': 'faq-preamble-agreement',
  stockists: 'stockists-agreement',
  'editorial-repair': 'editorial-repair-agreement',
  'classify-images': 'classify-images-agreement',
  'sentry-classify': 'sentry-classify-agreement',
}

/**
 * `brand_ai_results.phase` values each prompt's rows are written under. The
 * editorial repair turn is audited as `descriptions` (and faq rows share `faq`),
 * so editorial rows are told apart by prompt text, never by phase.
 */
export const GOLDEN_PROMPT_PHASES: Record<GoldenPrompt, readonly string[]> = {
  // `acquisition` is the sub-phase historical rows carry (before 20260903100400).
  'acquisition-plan': ['acquire', 'acquisition'],
  'acquisition-critique': ['acquire', 'acquisition'],
  'products-repair': ['products'],
  products: ['products'],
  'brand-facts': ['facts'],
  'founding-facts': ['founding_facts'],
  'founding-facts-verify': ['founding_facts_verify'],
  'faq-preamble': ['faq'],
  stockists: ['stockists'],
  'editorial-repair': ['descriptions', 'faq'],
  'classify-images': ['classify_images'],
  'sentry-classify': ['sentry-classify'],
}

export function promptForDataset(dataset: string): GoldenPrompt | null {
  const entry = Object.entries(GOLDEN_DATASETS).find(([, name]) => name === dataset)
  return entry ? (entry[0] as GoldenPrompt) : null
}

// ---------------------------------------------------------------------------
// Truncation and classification
// ---------------------------------------------------------------------------

/** True for text `llm-audit`'s `truncate` cut before storing it. */
function isTruncatedPrompt(value: string): boolean {
  return (
    value.length === MAX_PROMPT_LENGTH + PROMPT_TRUNCATION_MARK.length &&
    value.endsWith(PROMPT_TRUNCATION_MARK)
  )
}

/** Every known resolved text per prompt: the current one, plus older versions for harvest. */
export type PromptTexts = Record<GoldenPrompt, readonly string[]>

/**
 * The golden prompt whose resolved text the system message starts with, or
 * null. A stored (truncated) system matches when the known text starts with
 * what survived. When several texts match, the longest wins, so a prompt whose
 * text is a prefix of another's never claims the other's calls.
 */
export function classifyCapturedCall(
  call: { system: string },
  texts: PromptTexts,
): GoldenPrompt | null {
  const truncated = isTruncatedPrompt(call.system)
  const body = truncated ? call.system.slice(0, -PROMPT_TRUNCATION_MARK.length) : call.system
  let best: { prompt: GoldenPrompt; length: number } | null = null
  for (const prompt of GOLDEN_PROMPTS) {
    for (const text of texts[prompt] ?? []) {
      if (!text) continue
      const matches = body.startsWith(text) || (truncated && text.startsWith(body))
      if (matches && (!best || text.length > best.length)) best = { prompt, length: text.length }
    }
  }
  return best?.prompt ?? null
}

// ---------------------------------------------------------------------------
// Scorer context, derived from the user message
// ---------------------------------------------------------------------------

type RepairUserMessage = {
  brand?: { slug?: string; url?: string; ownedHosts?: string[] }
  repairable?: Array<{ proposal?: { official_url?: string }; failures?: string[] }>
}

/** Mirrors `repairNode`: brand URL, owned hosts, and which entries are hard. */
function repairContext(user: string): ProductsGoldenContext | null {
  let message: RepairUserMessage
  try {
    message = JSON.parse(user) as RepairUserMessage
  } catch {
    return null
  }
  const brand = message.brand
  const siteUrl = brand?.slug ? brandSiteUrl({ slug: brand.slug, url: brand.url }) : (brand?.url ?? null)
  if (!siteUrl || !Array.isArray(message.repairable)) return null
  const entries = message.repairable.filter((entry) => typeof entry.proposal?.official_url === 'string')
  // Production validates against the whole candidate pool, which the message
  // does not carry. The repaired entries' own URLs came from that pool, so a
  // repair that keeps its page is judged exactly as production would.
  // Shortcut, ceiling: a repair that moves to a different pool URL is rejected
  // here but accepted in production, so repairPassRate is a lower bound.
  // Upgrade path: record the full candidate pool in the repair user message or
  // in the capture context, and score against that.
  const candidates = [...new Set(entries.map((entry) => productUrlKey(entry.proposal!.official_url!)))]
  const hardUrls = [
    ...new Set(
      entries
        .filter((entry) => (entry.failures ?? []).some((f) => !f.startsWith(DESCRIPTION_ORIGIN_OMITTED)))
        .map((entry) => productUrlKey(entry.proposal!.official_url!)),
    ),
  ]
  return { siteUrl, candidates, ownedHosts: message.brand?.ownedHosts ?? [], hardUrls }
}

/** The blocks `buildProductsUserContent` may write after the candidate pages. */
const SECTIONS_AFTER_CANDIDATES: ReadonlySet<string> = new Set([
  PRODUCTS_LABELS.listingEntryPoints,
  PRODUCTS_LABELS.originExcerpts,
])

const CANDIDATE_LINE = /^- https?:\/\//

/**
 * Reads the site URL and candidate page lines `buildProductsUserContent` wrote.
 * A page's evidence text can hold newlines, so a line that is not a
 * `- http(s)://` entry is evidence continuation and is skipped. The block ends
 * at a blank line followed by the next section's label, or at the end of text.
 *
 * Shortcut, ceiling: the pool read here is what the prompt listed
 * (`pool.products.slice(0, MAX_CANDIDATE_PAGES)` in products.ts), not the
 * `evaluationCandidates` production validates against, so gated or
 * near-duplicate pages can differ and keepRate is approximate. Upgrade path:
 * record the validation pool in the capture context.
 */
function fallbackContext(user: string): ProductsGoldenContext | null {
  const lines = user.split('\n')
  const siteLine = lines.find((line) => line.startsWith(PRODUCTS_LABELS.siteUrl))
  const siteUrl = siteLine?.slice(PRODUCTS_LABELS.siteUrl.length).trim()
  if (!siteUrl) return null
  const header = lines.indexOf(PRODUCTS_LABELS.candidatePages)
  const candidates: string[] = []
  if (header >= 0) {
    for (let i = header + 1; i < lines.length; i++) {
      const line = lines[i]!
      if (line === '' && SECTIONS_AFTER_CANDIDATES.has(lines[i + 1] ?? '')) break
      if (!CANDIDATE_LINE.test(line)) continue
      const url = line.slice(2).split(' | ')[0]?.trim()
      if (url) candidates.push(productUrlKey(url))
    }
  }
  return { siteUrl, candidates: [...new Set(candidates)], ownedHosts: [] }
}

/**
 * What the prompt's scorers read from `expectedOutput.context`. `undefined`
 * means the context cannot be derived and the item is skipped.
 */
function contextFor(prompt: GoldenPrompt, user: string): unknown {
  switch (prompt) {
    case 'acquisition-plan':
      return {}
    case 'acquisition-critique':
      return null
    case 'products-repair':
      return repairContext(user) ?? undefined
    case 'products':
      return fallbackContext(user) ?? undefined
    default:
      // Agreement sets are built by `agreementCallsToItems`, never from a user message alone.
      return undefined
  }
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

type GoldenSource = 'capture' | 'harvest'

type GoldenCallRecord = {
  prompt: GoldenPrompt
  user: string
  brandSlug: string
  jobId: string | null
  createdAt: string
  source: GoldenSource
}

export type GoldenItemBody = {
  datasetName: string
  id: string
  input: string
  expectedOutput: { context: unknown } | null
  status: 'ACTIVE'
  metadata: {
    source: GoldenSource
    brandSlug: string
    jobId: string | null
    context: unknown
    humanApproval: { status: 'pending' }
  }
}

/**
 * A content-derived item id: the same user message for the same prompt and
 * brand is the same item on every capture or harvest, so a re-run upserts
 * instead of duplicating, and two calls in one millisecond never collide.
 */
function goldenItemId(prompt: GoldenPrompt, brandSlug: string, user: string): string {
  const digest = createHash('sha256').update(user).digest('hex').slice(0, 16)
  return `${prompt}:${brandSlug}:${digest}`
}

/**
 * Turns classified calls into dataset items: drops truncated users and calls
 * whose context cannot be derived, keeps one item per (prompt, brand, user
 * message), and keeps only the first plan turn per (job, brand). Every
 * plan-loop turn repeats the same first user message, so rows with no job
 * collapse through the user message. Items are written ACTIVE with a
 * pending `humanApproval`, the same state `prelabelItem` keeps: the dataset
 * listing omits ARCHIVED items (ARCHIVED means rejected), and a run admits
 * only items carrying `humanApproval.reviewedVia`, so none reaches a run
 * before review.
 */
function toGoldenItems(records: readonly GoldenCallRecord[]): GoldenItemBody[] {
  const ordered = [...records].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const seen = new Set<string>()
  const items: GoldenItemBody[] = []
  for (const record of ordered) {
    if (isTruncatedPrompt(record.user)) continue
    const context = contextFor(record.prompt, record.user)
    if (context === undefined) continue
    const id = goldenItemId(record.prompt, record.brandSlug, record.user)
    // Shortcut, ceiling: a row with no job_id cannot be tied to its run, so
    // two plan turns of one run collapse only when their user messages are
    // identical, and a later turn with a different message becomes its own
    // item. Upgrade path: persist a job/run id on every brand_ai_results row.
    const keys = [id]
    if (record.prompt === 'acquisition-plan' && record.jobId !== null) {
      keys.push(`${record.prompt}|${record.jobId}|${record.brandSlug}`)
    }
    if (keys.some((key) => seen.has(key))) continue
    for (const key of keys) seen.add(key)
    items.push({
      datasetName: GOLDEN_DATASETS[record.prompt],
      id,
      input: record.user,
      // The critique's label is drafted by `dataset prelabel`; rule-only sets
      // already know everything their scorers need.
      expectedOutput: record.prompt === 'acquisition-critique' ? null : { context },
      status: 'ACTIVE',
      metadata: {
        source: record.source,
        brandSlug: record.brandSlug,
        jobId: record.jobId,
        context,
        humanApproval: { status: 'pending' },
      },
    })
  }
  return items
}

/** A `brand_ai_results` row as the harvest query selects it (brand slug flattened by the caller). */
export type HarvestRow = {
  created_at: string
  job_id: string | null
  brand_slug: string | null
  input: unknown
}

export function harvestRowsToItems(
  rows: readonly HarvestRow[],
  options: { prompt: GoldenPrompt; texts: PromptTexts; since?: string },
): GoldenItemBody[] {
  const since = options.since ? new Date(options.since).getTime() : null
  const records: GoldenCallRecord[] = []
  for (const row of rows) {
    const input = row.input as { system?: unknown; user?: unknown } | null
    if (typeof input?.system !== 'string' || typeof input.user !== 'string') continue
    if (since !== null && new Date(row.created_at).getTime() < since) continue
    if (classifyCapturedCall({ system: input.system }, options.texts) !== options.prompt) continue
    records.push({
      prompt: options.prompt,
      user: input.user,
      // Shortcut, ceiling: rows that resolve to no brand (neither `brands` nor
      // `brand_submissions.brands` joins) share the 'unknown' slug, so their
      // ids and plan dedup keys pool across brands; only an identical user
      // message then merges two of them. Upgrade path: select the row's
      // brand_id / submission_id and key on that when the slug is missing.
      brandSlug: row.brand_slug ?? 'unknown',
      jobId: row.job_id,
      createdAt: row.created_at,
      source: 'harvest',
    })
  }
  return toGoldenItems(records)
}

export type TimedCapturedCall = CapturedCall & { capturedAt: string }

export function capturedCallsToItems(
  calls: readonly TimedCapturedCall[],
  options: { brandSlug: string; jobId: string; texts: PromptTexts; prompts?: readonly GoldenPrompt[] },
): GoldenItemBody[] {
  const wanted = new Set(options.prompts ?? LEGACY_GOLDEN_PROMPTS)
  const records: GoldenCallRecord[] = []
  for (const call of calls) {
    const prompt = classifyCapturedCall(call, options.texts)
    if (!prompt || !wanted.has(prompt) || isAgreementPrompt(prompt)) continue
    records.push({
      prompt,
      user: call.user,
      brandSlug: options.brandSlug,
      jobId: options.jobId,
      createdAt: call.capturedAt,
      source: 'capture',
    })
  }
  return toGoldenItems(records)
}

// ---------------------------------------------------------------------------
// Agreement items (DEV-1898 D11)
// ---------------------------------------------------------------------------

/** The full captured request of a text agreement item; `user` lets the default replay path read it too. */
export type AgreementInput = {
  user: string
  messages: ChatMessage[]
  schema: OpenAIJsonSchema | null
  promptName: string | null
  profileKey: string | null
}

/** A vision agreement item: one brand's images, re-downloaded and classified on replay (D3). */
export type VisionAgreementInput = {
  brandContext: string
  imageUrls: string[]
}

/** One image's verdict as `classifyImageBuffers` returned it. */
export type VisionVerdict = { sourceUrl: string; disposition: 'keep' | 'reject'; score: number; tag: string }

export type AgreementItemBody = {
  datasetName: string
  id: string
  input: AgreementInput | VisionAgreementInput
  /** The incumbent's captured output: the reference, not a label. */
  expectedOutput: { output: unknown }
  status: 'ACTIVE'
  metadata: {
    source: 'capture'
    brandSlug: string
    jobId: string | null
    phase: string
    profileKey: string | null
    humanApproval: { status: 'pending' }
  }
}

function agreementItemId(prompt: AgreementPrompt, key: string, content: string): string {
  const digest = createHash('sha256').update(content).digest('hex').slice(0, 16)
  return `${prompt}:${key}:${digest}`
}

/**
 * Captured calls to agreement items. A call is kept when its system text
 * classifies to one of `prompts` and the incumbent answered with parseable
 * JSON (`response.parsed`); a failed or unparseable call has no reference.
 * One item per (prompt, brand, user message), so a re-capture upserts.
 * `classify-images` calls are skipped; see `visionAgreementItem`.
 */
export function agreementCallsToItems(
  calls: readonly TimedCapturedCall[],
  options: { brandSlug: string; jobId: string | null; texts: PromptTexts; prompts: readonly AgreementPrompt[] },
): AgreementItemBody[] {
  const wanted = new Set<GoldenPrompt>(options.prompts)
  const seen = new Set<string>()
  const items: AgreementItemBody[] = []
  for (const call of [...calls].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))) {
    const prompt = classifyCapturedCall(call, options.texts)
    if (!prompt || !wanted.has(prompt) || !isAgreementPrompt(prompt)) continue
    // Vision items are per brand (`visionAgreementItem`): a batch call's images are not in `messages`.
    if (prompt === 'classify-images') continue
    if (call.response.parsed === undefined) continue
    const id = agreementItemId(prompt, options.brandSlug, call.user)
    if (seen.has(id)) continue
    seen.add(id)
    items.push({
      datasetName: GOLDEN_DATASETS[prompt],
      id,
      input: {
        user: call.user,
        messages: call.messages,
        schema: call.schema ?? null,
        promptName: call.promptName,
        profileKey: call.profileKey,
      },
      expectedOutput: { output: call.response.parsed },
      status: 'ACTIVE',
      metadata: {
        source: 'capture',
        brandSlug: options.brandSlug,
        jobId: options.jobId,
        phase: call.phase,
        profileKey: call.profileKey,
        humanApproval: { status: 'pending' },
      },
    })
  }
  return items
}

/**
 * One brand's vision agreement item (D3): the image URLs and brand context the
 * replay re-classifies, with the incumbent's per-image verdicts as reference.
 * Null when the incumbent judged no image (every batch failed or none gated).
 */
export function visionAgreementItem(options: {
  brandSlug: string
  jobId: string | null
  brandContext: string
  imageUrls: readonly string[]
  verdicts: readonly VisionVerdict[]
}): AgreementItemBody | null {
  if (options.verdicts.length === 0) return null
  const imageUrls = [...options.imageUrls]
  return {
    datasetName: GOLDEN_DATASETS['classify-images'],
    id: agreementItemId('classify-images', options.brandSlug, JSON.stringify(imageUrls)),
    input: { brandContext: options.brandContext, imageUrls },
    expectedOutput: { output: { images: options.verdicts.map(({ sourceUrl, disposition, score, tag }) => ({ sourceUrl, disposition, score, tag })) } },
    status: 'ACTIVE',
    metadata: {
      source: 'capture',
      brandSlug: options.brandSlug,
      jobId: options.jobId,
      phase: 'classify_images',
      profileKey: 'classifyImages',
      humanApproval: { status: 'pending' },
    },
  }
}
