/**
 * Pure mappers behind `llm-eval dataset capture` and `dataset harvest`
 * (DEV-1873): classify a model call to one of the four golden prompts by its
 * system text, derive what each prompt's scorers need, and shape Langfuse
 * dataset items. No I/O here; the CLI does the reads and writes.
 *
 * Every item stores `input` as the raw user string production sent, never an
 * object, so a replay sends the exact message (name-arbiter lesson).
 */

import { PRODUCTS_LABELS } from '@/lib/prompts'
import { normalizeProductUrl } from '../enrich-phases/product-candidates'
import { MAX_PROMPT_LENGTH, PROMPT_TRUNCATION_MARK, type CapturedCall } from '../llm-audit'
import type { ProductsGoldenContext } from './scorers'

// ---------------------------------------------------------------------------
// Prompts and datasets
// ---------------------------------------------------------------------------

export const GOLDEN_PROMPTS = [
  'acquisition-plan',
  'acquisition-critique',
  'products-repair',
  'products',
] as const

export type GoldenPrompt = (typeof GOLDEN_PROMPTS)[number]

export const GOLDEN_DATASETS: Record<GoldenPrompt, string> = {
  'acquisition-plan': 'acquisition-plan-golden',
  'acquisition-critique': 'acquisition-critique-golden',
  'products-repair': 'products-repair-golden',
  products: 'products-fallback-golden',
}

/** `brand_ai_results.phase` values each prompt's rows are written under. */
export const GOLDEN_PROMPT_PHASES: Record<GoldenPrompt, readonly string[]> = {
  // `acquisition` is the sub-phase historical rows carry (before 20260903100400).
  'acquisition-plan': ['acquire', 'acquisition'],
  'acquisition-critique': ['acquire', 'acquisition'],
  'products-repair': ['products'],
  products: ['products'],
}

export function promptForDataset(dataset: string): GoldenPrompt | null {
  const entry = Object.entries(GOLDEN_DATASETS).find(([, name]) => name === dataset)
  return entry ? (entry[0] as GoldenPrompt) : null
}

// ---------------------------------------------------------------------------
// Truncation and classification
// ---------------------------------------------------------------------------

/** True for text `llm-audit`'s `truncate` cut before storing it. */
export function isTruncatedPrompt(value: string): boolean {
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

/** Prefix of `checkDescriptionOrigin`'s failure (products/verify.ts): the only soft failure. */
const ORIGIN_OMITTED = 'description_origin_omitted'

function normalized(url: string): string {
  return normalizeProductUrl(url) ?? url
}

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
  const slug = message.brand?.slug
  const siteUrl = message.brand?.url ?? (slug ? `https://${slug}.com` : null)
  if (!siteUrl || !Array.isArray(message.repairable)) return null
  const entries = message.repairable.filter((entry) => typeof entry.proposal?.official_url === 'string')
  // Production validates against the whole candidate pool, which the message
  // does not carry. The repaired entries' own URLs came from that pool, so a
  // repair that keeps its page is judged exactly as production would.
  const candidates = [...new Set(entries.map((entry) => normalized(entry.proposal!.official_url!)))]
  const hardUrls = [
    ...new Set(
      entries
        .filter((entry) => (entry.failures ?? []).some((f) => !f.startsWith(ORIGIN_OMITTED)))
        .map((entry) => normalized(entry.proposal!.official_url!)),
    ),
  ]
  return { siteUrl, candidates, ownedHosts: message.brand?.ownedHosts ?? [], hardUrls }
}

/** Reads the site URL and candidate page lines `buildProductsUserContent` wrote. */
function fallbackContext(user: string): ProductsGoldenContext | null {
  const lines = user.split('\n')
  const siteLine = lines.find((line) => line.startsWith(PRODUCTS_LABELS.siteUrl))
  const siteUrl = siteLine?.slice(PRODUCTS_LABELS.siteUrl.length).trim()
  if (!siteUrl) return null
  const header = lines.indexOf(PRODUCTS_LABELS.candidatePages)
  const candidates: string[] = []
  if (header >= 0) {
    for (const line of lines.slice(header + 1)) {
      if (!line.startsWith('- ')) break
      const url = line.slice(2).split(' | ')[0]?.trim()
      if (url) candidates.push(normalized(url))
    }
  }
  return { siteUrl, candidates: [...new Set(candidates)], ownedHosts: [] }
}

/**
 * What the prompt's scorers read from `expectedOutput.context`. `undefined`
 * means the context cannot be derived and the item is skipped.
 */
export function contextFor(prompt: GoldenPrompt, user: string): unknown {
  switch (prompt) {
    case 'acquisition-plan':
      return {}
    case 'acquisition-critique':
      return null
    case 'products-repair':
      return repairContext(user) ?? undefined
    case 'products':
      return fallbackContext(user) ?? undefined
  }
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export type GoldenSource = 'capture' | 'harvest'

export type GoldenCallRecord = {
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
  status: 'ARCHIVED'
  metadata: {
    source: GoldenSource
    brandSlug: string
    jobId: string | null
    context: unknown
    humanApproval: { status: 'pending' }
  }
}

/**
 * Turns classified calls into dataset items: drops truncated users and calls
 * whose context cannot be derived, keeps the first plan turn per job (every
 * plan-loop turn repeats the same first user message), and drops exact repeats
 * of one user message within a job. Items are written ARCHIVED with a pending
 * `humanApproval`, the same state `prelabelItem` keeps, so none reaches a run
 * before review.
 */
export function toGoldenItems(records: readonly GoldenCallRecord[]): GoldenItemBody[] {
  const ordered = [...records].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const seen = new Set<string>()
  const items: GoldenItemBody[] = []
  for (const record of ordered) {
    if (isTruncatedPrompt(record.user)) continue
    const context = contextFor(record.prompt, record.user)
    if (context === undefined) continue
    const job = record.jobId ?? `${record.brandSlug}:${record.createdAt}`
    const key =
      record.prompt === 'acquisition-plan' ? `${record.prompt}|${job}` : `${record.prompt}|${job}|${record.user}`
    if (seen.has(key)) continue
    seen.add(key)
    items.push({
      datasetName: GOLDEN_DATASETS[record.prompt],
      id: `${record.prompt}:${record.brandSlug}:${record.createdAt}`,
      input: record.user,
      // The critique's label is drafted by `dataset prelabel`; rule-only sets
      // already know everything their scorers need.
      expectedOutput: record.prompt === 'acquisition-critique' ? null : { context },
      status: 'ARCHIVED',
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
  const wanted = new Set(options.prompts ?? GOLDEN_PROMPTS)
  const records: GoldenCallRecord[] = []
  for (const call of calls) {
    const prompt = classifyCapturedCall(call, options.texts)
    if (!prompt || !wanted.has(prompt)) continue
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
