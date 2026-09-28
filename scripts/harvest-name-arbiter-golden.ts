/**
 * @formoria-script
 * purpose: Build the name-arbiter-confidence-golden pool from read-only brand_ai_results row dumps: re-render, tag hard cases, pin prompt leaks to train, assign seeded splits (DEV-1896)
 * class: operator
 * invoke: npx tsx scripts/harvest-name-arbiter-golden.ts --from <dump.json> [--from <dump.json>] [--existing] [--seed <seed>] [--out <items-blind.json>] [--apply]
 * target: none
 * safety: dry-run-default
 * owner: engineering
 * prerequisites: LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY and LANGFUSE_HOST (read from .env.staging) for --existing and --apply.
 * notes: The script never opens Supabase; it reads row dumps. Make one dump per project with the census curl, piping the service key and never printing it.
 *   Production: KEY=$(pnpm supabase projects api-keys --project-ref xkcayngbttpxyibgzern --reveal -o json | jq -r '.[] | select(.name=="service_role") | .api_key')
 *   then curl -s "https://xkcayngbttpxyibgzern.supabase.co/rest/v1/brand_ai_results?phase=eq.names&select=id,created_at,input&order=created_at.desc" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" > prod-names-rows.json
 *   Staging: the same curl against the staging ref with the service key from .env.staging.
 *   Dry run prints the tag x split table, the skipped-line count and the pool size. --apply requires --existing, upserts new items ACTIVE and pending,
 *   and merges only split and hardTags into existing items. A new id Langfuse already holds in any status (the listing omits ARCHIVED) is skipped.
 *   A reviewed item newly pinned to train gets only its split moved. Every write is paced, confirmed by returned id, then re-read per id (the SDK swallows 429s).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

import { config as dotenvConfig } from 'dotenv'

import { getLangfuse, flushLangfuse } from '@/lib/langfuse/client'
import { snapshotPrompt } from '@/lib/langfuse/prompt'
import { normalizeCandidates, normalizeCandidateValue } from '@/lib/services/enrich-phases/names'
import { assignSplits as assignSeededSplits, SPLITS, type Split } from '@/lib/services/eval/splits'
import { MAX_PROMPT_LENGTH, PROMPT_TRUNCATION_MARK } from '@/lib/services/llm-audit'
import { buildNameArbiterUserContent, parseNameArbiterItemLine } from '@/lib/services/name-arbiter'

import { httpStatusOf, pacedLangfuseWriter, realSleep } from './shared/langfuse-paced-write'

export const DATASET = 'name-arbiter-confidence-golden'
const PROMPT_NAME = 'name-arbiter'
const HARVESTED_BY = 'DEV-1896'
const DEFAULT_SEED = 'dev-1896'

export const HARD_TAGS = ['trailing-segment', 'bilingual-half', 'capitalisation'] as const
export type HardTag = (typeof HARD_TAGS)[number]
export { SPLITS, type Split }

/** Golden items quoted in prompt v6 (D1). They stay in train so no scored split holds a prompt example. */
export const PINNED_SLUGS: ReadonlySet<string> = new Set(['unigaze', 'trista', 'mu-ran', 'lin-tsao', 'qn-dessert', 'boingboing'])

/**
 * The prompt line naming page-chrome words (首頁 and friends) the model should
 * remove. Its quotes are chrome, not brand names; pinning every candidate that
 * contains one would move ordinary items to train.
 */
const CHROME_LINE_MARKER = 'page-title framing'

const HEADER_LINE = buildNameArbiterUserContent([]).split('\n')[0]!

export type HarvestRow = { id: string | number; created_at: string; input: { user?: unknown } | null }

export type ExistingItem = {
  id: string
  input: unknown
  expectedOutput?: unknown
  status: string
  metadata?: unknown
}

export type HarvestedItem = {
  slug: string
  storedName: string
  values: string[]
  user: string
  sourceRowId: string
  createdAt: string
}

export type PoolItem = {
  id: string
  slug: string
  storedName: string
  user: string
  values: string[]
  hardTags: HardTag[]
  pinned: boolean
  split?: Split
  sourceRowId?: string
  existing?: ExistingItem
}

export type HarvestStats = {
  rows: number
  rowsWithoutUser: number
  truncatedRows: number
  intactLines: number
  skipped: number
  tooFew: number
}

// ---------------------------------------------------------------------------
// Parsing and re-rendering
// ---------------------------------------------------------------------------

/**
 * Item lines of one stored user message. llm-audit cuts stored text at
 * MAX_PROMPT_LENGTH chars and appends PROMPT_TRUNCATION_MARK; only a message of
 * exactly that shape is truncated, and its cut line is dropped, never repaired.
 * A shorter message that merely ends in the mark (a snippet ending in "…") is complete.
 */
export function extractItemLines(user: string): { lines: string[]; truncated: boolean } {
  const truncated =
    user.length === MAX_PROMPT_LENGTH + PROMPT_TRUNCATION_MARK.length && user.endsWith(PROMPT_TRUNCATION_MARK)
  const lines = user.split('\n')
  if (lines[0] === HEADER_LINE) lines.shift()
  if (truncated) lines.pop()
  return { lines: lines.filter((line) => line.trim() !== ''), truncated }
}

type RenderResult =
  | { ok: true; slug: string; storedName: string; values: string[]; user: string }
  | { ok: false; reason: 'unparseable' | 'mismatch' | 'too-few' }

/**
 * Parses one line and re-renders it through the production normalizer and
 * builder. A line whose re-render differs from the stored bytes is skipped:
 * the dataset input must be exactly what production would send.
 */
export function renderItemLine(line: string): RenderResult {
  const parsed = parseNameArbiterItemLine(line)
  if (!parsed || !parsed.slug) return { ok: false, reason: 'unparseable' }

  const candidates = normalizeCandidates(parsed.storedName, parsed.candidates)
  const user = buildNameArbiterUserContent([
    { slug: parsed.slug, storedName: parsed.storedName, candidates, snippets: parsed.snippets },
  ])
  // The stored line carries its batch position ("7."); a single-item render is always "1.".
  if (user.split('\n')[1] !== line.replace(/^\d+\./, '1.')) return { ok: false, reason: 'mismatch' }
  if (candidates.length < 2) return { ok: false, reason: 'too-few' }

  return { ok: true, slug: parsed.slug, storedName: parsed.storedName, values: candidates.map((c) => c.value), user }
}

export function harvestRows(rows: HarvestRow[]): { items: HarvestedItem[]; stats: HarvestStats } {
  const stats: HarvestStats = { rows: rows.length, rowsWithoutUser: 0, truncatedRows: 0, intactLines: 0, skipped: 0, tooFew: 0 }
  const items: HarvestedItem[] = []

  for (const row of rows) {
    const user = row.input?.user
    if (typeof user !== 'string') {
      stats.rowsWithoutUser++
      continue
    }
    const { lines, truncated } = extractItemLines(user)
    if (truncated) stats.truncatedRows++
    for (const line of lines) {
      stats.intactLines++
      const rendered = renderItemLine(line)
      if (!rendered.ok) {
        if (rendered.reason === 'too-few') stats.tooFew++
        else stats.skipped++
        continue
      }
      items.push({
        slug: rendered.slug,
        storedName: rendered.storedName,
        values: rendered.values,
        user: rendered.user,
        sourceRowId: String(row.id),
        createdAt: row.created_at,
      })
    }
  }
  return { items, stats }
}

// ---------------------------------------------------------------------------
// Tags and leak pins
// ---------------------------------------------------------------------------

const HAN = /\p{Script=Han}/u
const LATIN = /\p{Script=Latin}/u

function isTrailingSegment(longer: string, shorter: string): boolean {
  if (longer.length <= shorter.length || !longer.startsWith(shorter)) return false
  const rest = longer.slice(shorter.length)
  if (!rest.trim()) return false
  // A segment starts at whitespace or punctuation, or at a Han character (no spaces between Han words).
  return /^[\s\p{P}]/u.test(rest) || HAN.test(rest[0]!) || HAN.test(shorter.at(-1)!)
}

/** Deterministic hard-case tags over one item's normalized candidate values. */
export function hardTagsFor(values: string[]): HardTag[] {
  const tags = new Set<HardTag>()
  for (const a of values) {
    for (const b of values) {
      if (a === b) continue
      if (isTrailingSegment(a, b)) tags.add('trailing-segment')
      const aBoth = HAN.test(a) && LATIN.test(a)
      const bOne = HAN.test(b) !== LATIN.test(b)
      if (aBoth && bOne) tags.add('bilingual-half')
      if (a.toLowerCase() === b.toLowerCase()) tags.add('capitalisation')
    }
  }
  return HARD_TAGS.filter((tag) => tags.has(tag))
}

/** The production candidate normalizer, case-folded for matching. */
function normalizeForMatch(value: string): string {
  return normalizeCandidateValue(value).toLowerCase()
}

/**
 * Every name the prompt shows the model: each 「…」 quote (minus page chrome)
 * and the stored name and candidate values of each golden anchor input line.
 */
export function promptLeakStrings(promptText: string): string[] {
  const leaks = new Set<string>()
  for (const promptLine of promptText.split('\n')) {
    if (!promptLine.includes(CHROME_LINE_MARKER)) {
      for (const match of promptLine.matchAll(/「([^」]+)」/gu)) leaks.add(match[1]!.trim())
    }
    // Anchor input lines are "<label>：<item line without the numbered slug>".
    const sep = promptLine.indexOf('：')
    if (sep < 0) continue
    const anchor = parseNameArbiterItemLine(`1. [anchor] ${promptLine.slice(sep + 1)}`)
    if (!anchor) continue
    leaks.add(anchor.storedName.trim())
    for (const candidate of anchor.candidates) leaks.add(candidate.value.trim())
  }
  leaks.delete('')
  return [...leaks]
}

/** True when any candidate value contains a prompt string (case- and whitespace-insensitive). */
export function isPromptLeak(values: string[], leakStrings: string[]): boolean {
  const needles = leakStrings.map(normalizeForMatch).filter(Boolean)
  return values.some((value) => {
    const haystack = normalizeForMatch(value)
    return needles.some((needle) => haystack.includes(needle))
  })
}

// ---------------------------------------------------------------------------
// Pool: dedupe, tag, pin
// ---------------------------------------------------------------------------

function existingSplit(item: ExistingItem | undefined): Split | undefined {
  const split = (item?.metadata as { split?: unknown } | null | undefined)?.split
  return SPLITS.includes(split as Split) ? (split as Split) : undefined
}

function isReviewed(item: ExistingItem): boolean {
  const approval = (item.metadata as { humanApproval?: { reviewedVia?: unknown } } | null | undefined)?.humanApproval
  return approval?.reviewedVia != null
}

function parseExisting(item: ExistingItem): Omit<PoolItem, 'hardTags' | 'pinned'> {
  const user = String((item.input as { user?: unknown } | null)?.user ?? '')
  const parsed = parseNameArbiterItemLine(user.split('\n')[1] ?? '')
  const values = parsed ? normalizeCandidates(parsed.storedName, parsed.candidates).map((c) => c.value) : []
  return {
    id: item.id,
    slug: parsed?.slug ?? '',
    storedName: parsed?.storedName ?? '',
    user,
    values,
    split: existingSplit(item),
    existing: item,
  }
}

/**
 * Existing dataset items come first and keep their ids; harvested items follow,
 * latest row first. A harvested item is a duplicate when its slug or its
 * normalized stored name was already taken; existing items are always kept.
 */
export function buildPool({
  existing,
  harvested,
  leakStrings,
}: {
  existing: ExistingItem[]
  harvested: HarvestedItem[]
  leakStrings: string[]
}): { pool: PoolItem[]; duplicates: number } {
  const latestFirst = harvested
    .map((item, index) => ({ item, index }))
    .sort((a, b) => b.item.createdAt.localeCompare(a.item.createdAt) || a.index - b.index)
    .map(({ item }) => ({
      id: `names-${item.slug}`,
      slug: item.slug,
      storedName: item.storedName,
      user: item.user,
      values: item.values,
      sourceRowId: item.sourceRowId,
    }))

  const slugs = new Set<string>()
  const names = new Set<string>()
  const pool: PoolItem[] = []
  let duplicates = 0

  for (const candidate of [...existing.map(parseExisting), ...latestFirst]) {
    const name = normalizeForMatch(candidate.storedName)
    // Existing items are never dropped: some are hand-built variants that share a
    // stored name on purpose (e.g. three ADELA cases with different candidates).
    const taken = (candidate.slug && slugs.has(candidate.slug)) || (name && names.has(name))
    if (taken && !('existing' in candidate && candidate.existing)) {
      duplicates++
      continue
    }
    if (candidate.slug) slugs.add(candidate.slug)
    if (name) names.add(name)
    pool.push({
      ...candidate,
      hardTags: hardTagsFor(candidate.values),
      pinned: PINNED_SLUGS.has(candidate.slug) || isPromptLeak([candidate.storedName, ...candidate.values], leakStrings),
    })
  }
  return { pool, duplicates }
}

// ---------------------------------------------------------------------------
// Splits
// ---------------------------------------------------------------------------

/**
 * The shared seeded 60/20/20 deal (`@/lib/services/eval/splits`), stratified by
 * the item's hard-tag set. Pinned items go to train; unpinned items that
 * already carry a split keep it, so a re-run never moves an item between splits.
 */
export const assignSplits = (pool: PoolItem[], seed: string): PoolItem[] =>
  assignSeededSplits(pool, {
    seed,
    strataOf: (item) => item.hardTags.join('+') || 'untagged',
    pinnedToTrain: new Set(pool.filter((item) => item.pinned).map((item) => item.id)),
  })

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/** The panel's input: ids and user text only, no labels and no model outputs. */
export function blindItems(pool: PoolItem[]): Array<{ id: string; user: string }> {
  return pool.map((item) => ({ id: item.id, user: item.user }))
}

export function formatSummary(pool: PoolItem[], stats: HarvestStats, duplicates: number): string {
  const rows: Array<[string, (item: PoolItem) => boolean]> = [
    ...HARD_TAGS.map((tag): [string, (item: PoolItem) => boolean] => [tag, (item) => item.hardTags.includes(tag)]),
    ['untagged', (item) => item.hardTags.length === 0],
    ['pinned', (item) => item.pinned],
    ['all', () => true],
  ]
  const table = [
    '| tag | train | val | holdout | total |',
    '|---|---|---|---|---|',
    ...rows.map(([label, match]) => {
      const matched = pool.filter(match)
      const counts = SPLITS.map((split) => matched.filter((item) => item.split === split).length)
      return `| ${label} | ${counts.join(' | ')} | ${matched.length} |`
    }),
  ]
  const skipRate = stats.intactLines ? stats.skipped / stats.intactLines : 0
  return [
    ...table,
    '',
    `rows ${stats.rows} (${stats.truncatedRows} truncated, ${stats.rowsWithoutUser} without input.user)`,
    `intact lines ${stats.intactLines}: skipped ${stats.skipped} (${(skipRate * 100).toFixed(1)}%, not round-tripping), ` +
      `dropped ${stats.tooFew} (<2 candidates), ${duplicates} duplicates`,
    `pool ${pool.length} (${pool.filter((item) => item.existing).length} existing, ${pool.filter((item) => !item.existing).length} new)`,
    ...(skipRate > 0.1 ? ['WARNING: more than 10% of intact lines were skipped; inspect the row format before --apply.'] : []),
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type HarvestWriter = {
  createDatasetItem: (body: Record<string, unknown>) => Promise<unknown>
  getDatasetItem: (id: string) => Promise<unknown>
}

type WriteBody = {
  datasetName: string
  id: string
  input: unknown
  expectedOutput: unknown
  status: string
  metadata: Record<string, unknown>
}

function sameTags(a: unknown, b: HardTag[]): boolean {
  return Array.isArray(a) && a.length === b.length && a.every((tag, index) => tag === b[index])
}

type WritePlan = { body: WriteBody | null; reviewed: boolean; repinnedFrom?: Split }

/**
 * The write for one pool item, or null when nothing should be written:
 * - a reviewed item that already has a split is not re-split, so a re-run
 *   cannot move a labelled item between scored splits. The one exception is a
 *   pinned item (prompt leak or D1 slug) stored outside train: only its
 *   `metadata.split` becomes train, so no scored split holds a prompt example;
 * - an existing item whose split and tags already match is unchanged.
 * Existing items keep input, expectedOutput, status and every other metadata key.
 */
function writeBodyFor(item: PoolItem): WritePlan {
  const split = item.split
  if (!split) throw new Error(`[harvest] ${item.id} has no split; run assignSplits first`)

  const existing = item.existing
  if (!existing) {
    return {
      reviewed: false,
      body: {
        datasetName: DATASET,
        id: item.id,
        input: { user: item.user, promptName: PROMPT_NAME },
        expectedOutput: null,
        status: 'ACTIVE',
        metadata: {
          split,
          hardTags: item.hardTags,
          harvestedBy: HARVESTED_BY,
          sourceRowId: item.sourceRowId,
          humanApproval: { status: 'pending' },
        },
      },
    }
  }

  const metadata = { ...((existing.metadata as Record<string, unknown> | null | undefined) ?? {}) }
  const stored = existingSplit(existing)
  if (isReviewed(existing) && stored) {
    if (!item.pinned || stored === 'train') return { body: null, reviewed: true }
    return {
      reviewed: false,
      repinnedFrom: stored,
      body: {
        datasetName: DATASET,
        id: existing.id,
        input: existing.input,
        expectedOutput: existing.expectedOutput ?? null,
        status: existing.status,
        metadata: { ...metadata, split: 'train' },
      },
    }
  }
  if (metadata.split === split && sameTags(metadata.hardTags, item.hardTags)) return { body: null, reviewed: false }
  return {
    reviewed: false,
    body: {
      datasetName: DATASET,
      id: existing.id,
      input: existing.input,
      expectedOutput: existing.expectedOutput ?? null,
      status: existing.status,
      metadata: { ...metadata, split, hardTags: item.hardTags },
    },
  }
}

function matchesWrite(stored: unknown, body: WriteBody): boolean {
  const record = stored as { id?: unknown; status?: unknown; metadata?: { split?: unknown } | null } | null
  return record?.id === body.id && record.status === body.status && record.metadata?.split === body.metadata.split
}

function storedStatus(stored: unknown): string {
  const status = (stored as { status?: unknown } | null | undefined)?.status
  return typeof status === 'string' ? status : 'unknown'
}

export type ApplyResult = {
  written: number
  unchanged: number
  skippedReviewed: number
  skippedExists: number
  repinned: number
}

/**
 * Upserts the pool one item at a time through the shared paced writer
 * (scripts/shared/langfuse-paced-write.ts: ~85/min, under the 100/min Langfuse
 * limit). Before a new id is created it is read by id, because the dataset
 * listing omits ARCHIVED (rejected) items; an id Langfuse holds in any status is
 * skipped, never reset to pending. A create counts only when it resolves with
 * the item's id; then every written id is re-read, because the SDK resolves a
 * 429 as if it had succeeded. Ceiling: three paced calls per new item, ~28 new
 * items a minute; batch through the ingestion API if the pool grows past a few hundred.
 */
export async function applyPool(
  pool: PoolItem[],
  writer: HarvestWriter,
  { sleep = realSleep, log = console.log }: { sleep?: (ms: number) => Promise<void>; log?: (msg: string) => void } = {},
): Promise<ApplyResult> {
  const { withRetry, orThrow, confirmedWrite } = pacedLangfuseWriter<WriteBody>({
    createItem: (body) => writer.createDatasetItem(body),
    sleep,
  })

  let unchanged = 0
  let skippedReviewed = 0
  let repinned = 0
  const bodies: WriteBody[] = []
  const newIds = new Set<string>()
  for (const item of pool) {
    const { body, reviewed, repinnedFrom } = writeBodyFor(item)
    if (body) {
      bodies.push(body)
      if (!item.existing) newIds.add(body.id)
      if (repinnedFrom) {
        repinned++
        log(`[harvest] ${body.id} pinned: split ${repinnedFrom} -> train (reviewed; labels untouched)`)
      }
    } else if (reviewed) skippedReviewed++
    else unchanged++
  }

  let skippedExists = 0
  const written: WriteBody[] = []
  const failed: string[] = []
  for (const body of bodies) {
    if (newIds.has(body.id)) {
      const lookup = orThrow(
        await withRetry(async () => {
          try {
            const stored = await writer.getDatasetItem(body.id)
            return { present: stored != null, stored }
          } catch (error) {
            if (httpStatusOf(error) === 404) return { present: false, stored: null }
            throw error
          }
        }),
        `looking up item "${body.id}"`,
      )
      if (lookup.present) {
        skippedExists++
        log(`[harvest] ${body.id} skipped (exists, ${storedStatus(lookup.stored)})`)
        continue
      }
    }
    written.push(body)
    if (!(await confirmedWrite(body))) failed.push(body.id)
  }
  if (failed.length > 0) {
    throw new Error(`[harvest] ${written.length - failed.length}/${written.length} upserts confirmed; unconfirmed: ${failed.join(', ')}`)
  }

  const unverified: string[] = []
  for (const body of written) {
    const ok = await withRetry(async () => (matchesWrite(await writer.getDatasetItem(body.id), body) ? true : undefined))
    if (ok !== true) unverified.push(body.id)
  }
  if (unverified.length > 0) {
    throw new Error(`[harvest] ${unverified.length}/${written.length} items did not read back with their split: ${unverified.join(', ')}`)
  }

  return { written: written.length, unchanged, skippedReviewed, skippedExists, repinned }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function readDump(path: string): HarvestRow[] {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
  if (!Array.isArray(parsed)) throw new Error(`[harvest] ${path} is not a JSON array of brand_ai_results rows`)
  return parsed as HarvestRow[]
}

async function main() {
  const { values } = parseArgs({
    options: {
      from: { type: 'string', multiple: true },
      existing: { type: 'boolean', default: false },
      seed: { type: 'string', default: DEFAULT_SEED },
      out: { type: 'string' },
      apply: { type: 'boolean', default: false },
    },
    strict: true,
  })
  const from = values.from ?? []
  if (from.length === 0) throw new Error('[harvest] pass at least one --from <dump.json>')
  // Without the dataset loaded, a harvested id could collide with a stored item and reset its labels.
  if (values.apply && !values.existing) throw new Error('[harvest] --apply requires --existing')

  const { items, stats } = harvestRows(from.flatMap(readDump))

  let existing: ExistingItem[] = []
  let langfuse: ReturnType<typeof getLangfuse> = null
  if (values.existing) {
    // Langfuse credentials only; this script opens no database client.
    dotenvConfig({ path: '.env.staging', override: false })
    langfuse = getLangfuse()
    if (!langfuse) throw new Error('[harvest] Langfuse not configured')
    const dataset = await langfuse.getDataset(DATASET)
    existing = dataset.items as unknown as ExistingItem[]
  }

  const { pool: unsplit, duplicates } = buildPool({
    existing,
    harvested: items,
    leakStrings: promptLeakStrings(snapshotPrompt(PROMPT_NAME).text),
  })
  const pool = assignSplits(unsplit, values.seed ?? DEFAULT_SEED)

  console.log(formatSummary(pool, stats, duplicates))
  if (values.out) {
    writeFileSync(values.out, `${JSON.stringify(blindItems(pool), null, 2)}\n`)
    console.log(`wrote ${pool.length} blind items to ${values.out}`)
  }

  if (!values.apply) {
    console.log('\ndry run: pass --apply to write the dataset')
    return
  }
  const client = langfuse!
  const result = await applyPool(pool, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createDatasetItem: (body) => client.createDatasetItem(body as any),
    getDatasetItem: (id) => client.api.datasetItemsGet(id),
  })
  console.log(
    `\napplied: ${result.written} written and verified (${result.repinned} reviewed items pinned to train), ` +
      `${result.unchanged} unchanged, ${result.skippedReviewed} reviewed items skipped, ` +
      `${result.skippedExists} new ids skipped (already in Langfuse)`,
  )
  await flushLangfuse()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
