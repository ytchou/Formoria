/**
 * @formoria-script
 * purpose: Re-render detect-confidence-golden inputs through the production detect renderer, optionally adding admin-denied submissions and seeded splits (DEV-1894)
 * class: operator
 * invoke: npx tsx scripts/regenerate-detect-golden-inputs.ts [--target production] [--add-denied [--denied-sample <n>]] [--assign-splits] [--diffs <n>] [--apply --pre-export <path>] | --restore <pre-export path> [--apply]
 * target: staging-default
 * safety: dry-run-default
 * owner: engineering
 * notes: Writes to Langfuse dataset items only, and only on --apply (which requires --pre-export, the rollback file). Writes are paced under the Langfuse rate limit and every written id is read back; a mismatch exits 1. --restore <path> is the dataset rollback: it re-writes every exported item by id and archives the admin-denied items the export lacks. Database and Serper/probe calls are read-only; both zero-write seams are installed and assertNoNewAuditRows runs before any write.
 */
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

import { loadScriptTarget } from './shared/target'
import { splitByQuery } from './enrichment/eval/search-eval/label-shared'

import { getLangfuse, flushLangfuse } from '@/lib/langfuse/client'
import { DETECT_MESSAGE_LABELS as L } from '@/lib/prompts/detect-message'
import { renderDetectUserMessage, MAX_PROBE_URLS, type DetectItem } from '@/lib/services/category-classifier'
import {
  ownedUrlsFor,
  serpNameQuery,
  submissionToEnrichBrand,
  uniqueUrls,
} from '@/lib/services/curation-operations'
import { detectProbes, detectResultLines } from '@/lib/services/enrich-phases/detect-evidence'
import type { ProbeEvidence } from '@/lib/services/enrich-phases/gather'
import { extractInstagramHandle } from '@/lib/services/enrich-phases/scraper/parse/extractors'
import { parseBrandSearchEntries } from '@/lib/services/enrich-phases/scraper/search'
import { getDisplayBrandName } from '@/lib/services/enrich-phases/types'
import { parseLabelledLines } from '@/lib/services/eval/jev-questions'
import { JEV_INPUT_LABELS } from '@/lib/prompts/jev'
import { withRetry, type RetryPolicy } from '@/lib/retry'
import { shuffleWithSeed } from '@/lib/curated-products/home-wall'

const DATASET = 'detect-confidence-golden'
const SPLIT_SEED = 20260928
const SPLIT_RATIOS: [number, number, number] = [60, 20, 20]
const MAX_FAILURE_RATE = 0.1
/** Chunk for `.in()` reads; small enough that a multi-row-per-id table stays under PostgREST's page cap. */
const READ_CHUNK = 25
/** RFC 4122 URL namespace — the one `uuid.uuid5(uuid.NAMESPACE_URL, …)` used for the existing items. */
const UUID_NAMESPACE_URL = '6ba7b811-9dad-11d1-80b4-00c04fd430c8'
/**
 * The detect prompt's `## Golden anchors` names. A candidate carrying one would
 * put a prompt example into the eval set. scripts/ is outside the CJK guard.
 */
const ANCHOR_NAMES = ['好物嚴選', '島嶼紙品', '某某工作室'] as const
/** The same-name failures the design's riskiest assumption is checked against (pre-mortem). */
const NAMED_FAILURES: Array<{ label: string; matches: (name: string) => boolean }> = [
  { label: 'IDDAT', matches: (n) => n === 'IDDAT' },
  { label: 'AMUSE inc.', matches: (n) => n === 'AMUSE inc.' },
  { label: 'KOBE', matches: (n) => n === 'KOBE' },
  { label: 'Pinkoi placeholder', matches: (n) => /^Pinkoi Brand \S+$/.test(n) },
  { label: 'Admind Agency', matches: (n) => n === 'Admind Agency' },
]

export type SubmissionRow = Parameters<typeof submissionToEnrichBrand>[0]

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

export type RegenerateArgs = {
  apply: boolean
  preExport: string | null
  /** Rollback mode: the pre-export file to restore the dataset from. */
  restore: string | null
  addDenied: boolean
  assignSplits: boolean
  diffs: number
  /** Seeded sample size for `--add-denied`; null keeps every candidate. */
  deniedSample: number | null
}

export function parseRegenerateArgs(argv: readonly string[]): RegenerateArgs {
  const valueOf = (flag: string): string | null => {
    const index = argv.indexOf(flag)
    if (index === -1) return null
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value`)
    return value
  }
  const apply = argv.includes('--apply')
  const preExport = valueOf('--pre-export')
  const restore = valueOf('--restore')
  if (restore) {
    const conflicting = ['--add-denied', '--assign-splits', '--pre-export'].filter((flag) => argv.includes(flag))
    if (conflicting.length > 0) throw new Error(`--restore cannot be combined with ${conflicting.join(', ')}`)
  } else if (apply && !preExport) {
    throw new Error('--apply requires --pre-export <path>: the current items are exported there first, as the rollback source')
  }
  const diffsRaw = valueOf('--diffs')
  const diffs = diffsRaw === null ? 10 : Number(diffsRaw)
  if (!Number.isInteger(diffs) || diffs < 0) throw new Error(`--diffs must be a non-negative integer, got ${diffsRaw}`)
  const sampleRaw = valueOf('--denied-sample')
  const deniedSample = sampleRaw === null ? null : Number(sampleRaw)
  if (deniedSample !== null) {
    if (!argv.includes('--add-denied')) throw new Error('--denied-sample requires --add-denied')
    if (!Number.isInteger(deniedSample) || deniedSample < 1) {
      throw new Error(`--denied-sample must be a positive integer, got ${sampleRaw}`)
    }
  }
  return {
    apply,
    preExport,
    restore,
    addDenied: argv.includes('--add-denied'),
    assignSplits: argv.includes('--assign-splits'),
    diffs,
    deniedSample,
  }
}

// ---------------------------------------------------------------------------
// Pure assembly
// ---------------------------------------------------------------------------

export type StoredFields = {
  slug: string
  name: string
  description: string | null
  website: string | null
  /** Old-format messages never carried the submitted URL. */
  submittedWebsite: null
  /** Probe lines in the stored message: the baseline for the drift count. */
  probeLineCount: number
}

const valueOrNull = (value: string | undefined): string | null => {
  const trimmed = value?.trim()
  return trimmed && trimmed !== L.missing ? trimmed : null
}

/**
 * Reads the labelled fields back out of a stored (old-format) detect message —
 * the fallback when the item's submission row is gone (Tweakable Decision #3).
 * The old snippet label is listed so its lines never leak into the website field.
 */
const SUBMISSION_SLUG = /^submission-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

/**
 * A provisional detect item's slug is `submission-<uuid>`. When the audit row
 * and metadata carry no submission id, the slug is the last place it survives.
 */
export function submissionIdFromSlug(slug: string): string | null {
  const match = SUBMISSION_SLUG.exec(slug.trim())
  return match ? match[1].toLowerCase() : null
}

export function parseStoredFields(user: string): StoredFields {
  const fields = parseLabelledLines(user, [
    L.brandSlug,
    L.brandName,
    L.description,
    L.website,
    L.submittedWebsite,
    L.searchResult,
    L.probe,
    JEV_INPUT_LABELS.searchSnippets,
  ])
  const slug = valueOrNull(fields[L.brandSlug])
  const name = valueOrNull(fields[L.brandName])
  if (!slug || !name) throw new Error(`Stored detect message lacks slug or name: ${user.slice(0, 80)}`)
  return {
    slug,
    name,
    description: valueOrNull(fields[L.description]),
    website: valueOrNull(fields[L.website]),
    submittedWebsite: null,
    probeLineCount: user.split('\n').filter((line) => line.startsWith(`${L.probe}：`)).length,
  }
}

/** Everything detect needs about one brand before its SERP and probes are known. */
export type DetectSource = {
  slug: string
  name: string
  description: string | null
  website: string | null
  submittedWebsite: string | null
  igHandle: string | null
  /** D15 order: the submitted website_url first, then the known link columns. */
  ownedUrls: string[]
}

/** Mirrors `runDetectPhase`'s item fields and the orchestrator's D15 owned-URL list. */
export function sourceFromSubmission(row: SubmissionRow): DetectSource {
  const brand = submissionToEnrichBrand(row)
  return {
    slug: brand.slug,
    name: getDisplayBrandName(brand),
    description: brand.description ?? null,
    website: brand.purchase_website ?? null,
    submittedWebsite: brand.website_url ?? null,
    igHandle: extractInstagramHandle(brand.social_instagram),
    // Production also adds link-expansion adoptions made earlier in the same run;
    // a replay sees only what the submission row already carries.
    ownedUrls: ownedUrlsFor(brand),
  }
}

export function sourceFromStored(stored: StoredFields): DetectSource {
  return {
    slug: stored.slug,
    name: stored.name,
    description: stored.description,
    website: stored.website,
    submittedWebsite: null,
    igHandle: null,
    ownedUrls: uniqueUrls([stored.website ?? '']),
  }
}

export function probeUrlsFor(source: DetectSource): string[] {
  return source.ownedUrls.slice(0, MAX_PROBE_URLS)
}

export function buildDetectItem({
  source,
  rawResponse,
  probeEvidence,
}: {
  source: DetectSource
  /** A Serper `/search` response body: the stored `raw_response` or a live one. */
  rawResponse: unknown
  probeEvidence?: ProbeEvidence[]
}): { item: DetectItem; rendered: string } {
  const probes = detectProbes(probeEvidence)
  const item: DetectItem = {
    slug: source.slug,
    name: source.name,
    description: source.description,
    website: source.website,
    submittedWebsite: source.submittedWebsite,
    results: detectResultLines(parseBrandSearchEntries(rawResponse), source.ownedUrls, source.igHandle),
    ...(probes ? { probes } : {}),
  }
  return { item, rendered: renderDetectUserMessage(item) }
}

export function evidenceMetadata({ serpCreatedAt, runDate }: { serpCreatedAt: string | null; runDate: string }) {
  return {
    evidenceDates: { serp: serpCreatedAt ?? runDate, probe: runDate },
    serpSource: serpCreatedAt ? ('stored' as const) : ('live' as const),
  }
}

export function isAnchorLeak(name: string): boolean {
  const trimmed = name.trim()
  return ANCHOR_NAMES.some((anchor) => trimmed.includes(anchor))
}

export function applyGuard({ total, failed }: { total: number; failed: number }): { ok: boolean; reason?: string } {
  if (total === 0) return { ok: false, reason: 'no items were processed' }
  if (failed / total > MAX_FAILURE_RATE) {
    return { ok: false, reason: `${failed}/${total} items failed (> ${MAX_FAILURE_RATE * 100}%)` }
  }
  return { ok: true }
}

/** RFC 4122 name-based (SHA-1) UUID in the URL namespace; equals Python's `uuid.uuid5(NAMESPACE_URL, name)`. */
export function uuid5(name: string): string {
  const namespace = Buffer.from(UUID_NAMESPACE_URL.replace(/-/g, ''), 'hex')
  const bytes = createHash('sha1').update(namespace).update(name, 'utf8').digest().subarray(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Stratum names of the DEV-1869 selection (`detect_select.py`), derived from the label. */
export function stratumFromExpected(expected: unknown): string {
  const output = (expected ?? {}) as { isNonBrand?: unknown; confidence?: unknown }
  if (output.isNonBrand === true) return 'nonbrand'
  return typeof output.confidence === 'string' ? `brand-${output.confidence}` : 'brand-unknown'
}

/** Seeded, stratified 60/20/20 train/val/holdout split, keyed by item id. */
export function seededSplits(items: Array<{ id: string; stratum: string }>): Map<string, 'train' | 'val' | 'holdout'> {
  const { train, val, holdout } = splitByQuery(
    items.map((item) => ({ id: item.id, category: item.stratum })),
    SPLIT_RATIOS,
    SPLIT_SEED,
  )
  const splits = new Map<string, 'train' | 'val' | 'holdout'>()
  for (const item of train) splits.set(item.id, 'train')
  for (const item of val) splits.set(item.id, 'val')
  for (const item of holdout) splits.set(item.id, 'holdout')
  return splits
}

function headProbeCount(item: DetectItem): number {
  return (item.probes ?? []).filter((probe) => probe.title?.trim() || probe.description?.trim()).length
}

// ---------------------------------------------------------------------------
// IO
// ---------------------------------------------------------------------------

type DatasetItem = {
  id: string
  status?: string
  input: unknown
  expectedOutput: unknown
  metadata: unknown
}

/** One dataset-item upsert as Langfuse receives it. */
export type ItemBody = {
  datasetName: string
  id: string
  input: unknown
  expectedOutput: unknown
  metadata: unknown
  status: 'ACTIVE' | 'ARCHIVED'
}

/** The Langfuse calls the writer makes; injectable for tests. */
export type DatasetItemApi = {
  /** Resolves with the stored item. The SDK resolves on a 429 too, without the item. */
  createItem: (body: ItemBody) => Promise<unknown>
  /** `GET /dataset-items/<id>`: sees ARCHIVED items, which the dataset listing hides. Rejects with `{status: 404}` when absent. */
  getItem: (id: string) => Promise<unknown>
}

/** Same pacing as `llm-eval.ts#seedIntentDataset`: 700ms is ~86 calls/min, under Langfuse's 100/min. */
const LANGFUSE_PACE_MS = 700
/** 1 attempt + 3 retries, waiting ~2s/4s/8s (as `seedIntentDataset`). */
const LANGFUSE_RETRY_POLICY: RetryPolicy = { attempts: 4, baseMs: 2_000, factor: 2, capMs: 8_000 }

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function httpStatusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status
  return typeof status === 'number' ? status : undefined
}

/**
 * Paced, retried Langfuse item calls (the `seedIntentDataset` pattern): every
 * call waits `LANGFUSE_PACE_MS` after the previous one. A write counts only when
 * Langfuse returns the item with its id, because the SDK resolves on a 429
 * without throwing. Ceiling: one serial caller at the default rate limit.
 */
export function pacedItemApi(api: DatasetItemApi, { sleep = realSleep }: { sleep?: (ms: number) => Promise<void> } = {}) {
  let calls = 0
  const pace = async () => {
    if (calls++ > 0) await sleep(LANGFUSE_PACE_MS)
  }
  const retryUnconfirmed = { retryable: true, reason: 'rate_limit' } as const
  const done = { retryable: false, reason: 'terminal' } as const

  async function write(body: ItemBody): Promise<boolean> {
    return withRetry(
      LANGFUSE_RETRY_POLICY,
      async () => {
        await pace()
        try {
          const result = (await api.createItem(body)) as { id?: unknown } | null | undefined
          return result?.id === body.id
        } catch {
          return false
        }
      },
      { classify: (ok) => (ok ? done : retryUnconfirmed), service: 'langfuse-detect-golden', sleep },
    )
  }

  /** Only a 404 means absent; a 429 is retried and any other failure throws. */
  async function lookup(id: string): Promise<{ present: true; stored: unknown } | { present: false }> {
    const result = await withRetry(
      LANGFUSE_RETRY_POLICY,
      async () => {
        await pace()
        try {
          return { settled: true as const, value: { present: true as const, stored: await api.getItem(id) } }
        } catch (error) {
          if (httpStatusOf(error) === 404) return { settled: true as const, value: { present: false as const } }
          if (httpStatusOf(error) === 429) return { settled: false as const }
          throw error
        }
      },
      { classify: (r) => (r.settled ? done : retryUnconfirmed), service: 'langfuse-detect-golden', sleep },
    )
    if (!result.settled) throw new Error(`looking up dataset item ${id}: still rate-limited after retries`)
    return result.value
  }

  return { write, lookup }
}

/** JSON with sorted keys, so a Postgres jsonb round-trip compares equal. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  )
}

/**
 * The written items that did not land as written: absent, or stored with a
 * different status, input, expectedOutput or metadata. `stored` maps each id
 * to what Langfuse returns for it (absent ids are missing from the map).
 */
export function landedMismatches(
  expected: readonly ItemBody[],
  stored: ReadonlyMap<string, unknown>,
): Array<{ id: string; reason: string }> {
  const mismatches: Array<{ id: string; reason: string }> = []
  for (const body of expected) {
    const item = stored.get(body.id) as Partial<ItemBody> | undefined
    if (!item) {
      mismatches.push({ id: body.id, reason: 'not found' })
      continue
    }
    const field = (['input', 'expectedOutput', 'metadata'] as const).find(
      (key) => canonicalJson(item[key]) !== canonicalJson(body[key]),
    )
    if (item.status !== body.status) mismatches.push({ id: body.id, reason: `status ${item.status}, expected ${body.status}` })
    else if (field) mismatches.push({ id: body.id, reason: `${field} differs` })
  }
  return mismatches
}

/** Splits upserts into those whose id Langfuse does not hold yet and the ids it does (any status). */
export function dropExistingIds<T extends { id: string }>(
  upserts: readonly T[],
  presentIds: ReadonlySet<string>,
): { kept: T[]; skipped: string[] } {
  return {
    kept: upserts.filter((upsert) => !presentIds.has(upsert.id)),
    skipped: upserts.filter((upsert) => presentIds.has(upsert.id)).map((upsert) => upsert.id),
  }
}

/**
 * Writes every body through the paced path, then reads each id back (per id,
 * so ARCHIVED items are seen too) and compares. Returns the ids that did not
 * land as written.
 */
async function writeAndVerify(
  paced: ReturnType<typeof pacedItemApi>,
  bodies: readonly ItemBody[],
): Promise<Array<{ id: string; reason: string }>> {
  let unconfirmed = 0
  for (const body of bodies) {
    if (!(await paced.write(body))) unconfirmed++
  }
  if (unconfirmed > 0) console.warn(`${unconfirmed} write(s) unconfirmed after retries; the read-back decides`)
  // Read-back is the truth: an unconfirmed write may still have landed.
  // Ceiling: one paced read per item (~200 items, ~2.5 min).
  const stored = new Map<string, unknown>()
  for (const body of bodies) {
    const found = await paced.lookup(body.id)
    if (found.present) stored.set(body.id, found.stored)
  }
  return landedMismatches(bodies, stored)
}

function langfuseItemApi(langfuse: NonNullable<ReturnType<typeof getLangfuse>>): DatasetItemApi {
  return {
    createItem: (body) => langfuse.createDatasetItem(body),
    getItem: (id) => langfuse.api.datasetItemsGet(id),
  }
}

// ---------------------------------------------------------------------------
// Restore (dataset rollback)
// ---------------------------------------------------------------------------

export type ExportedItem = {
  id: string
  status: 'ACTIVE' | 'ARCHIVED'
  input: unknown
  expectedOutput: unknown
  metadata: unknown
}

/** Validates a `--pre-export` file: an array of `{id, status?, input, expectedOutput, metadata}`. */
export function parseExport(raw: unknown): ExportedItem[] {
  if (!Array.isArray(raw)) throw new Error('pre-export file must be a JSON array of dataset items')
  return raw.map((entry: unknown, index) => {
    const item = (entry ?? {}) as Record<string, unknown>
    if (typeof item.id !== 'string' || !item.id) throw new Error(`pre-export item ${index} has no id`)
    const status = item.status ?? 'ACTIVE'
    if (status !== 'ACTIVE' && status !== 'ARCHIVED') throw new Error(`pre-export item ${item.id} has status ${String(status)}`)
    return {
      id: item.id,
      status,
      input: item.input ?? null,
      expectedOutput: item.expectedOutput ?? null,
      metadata: item.metadata ?? null,
    }
  })
}

/**
 * Every exported item is re-written by id as exported; every current
 * admin-denied item the export lacks (one this script added) is archived.
 * `current` is the dataset listing, which already hides ARCHIVED items.
 */
export function buildRestorePlan(
  datasetName: string,
  exported: readonly ExportedItem[],
  current: ReadonlyArray<{ id: string; input: unknown; expectedOutput: unknown; metadata: unknown }>,
): { restores: ItemBody[]; archives: ItemBody[] } {
  const exportedIds = new Set(exported.map((item) => item.id))
  return {
    restores: exported.map((item) => ({ datasetName, ...item })),
    archives: current
      .filter(
        (item) =>
          !exportedIds.has(item.id) &&
          (item.metadata as { stratum?: unknown } | null | undefined)?.stratum === 'admin-denied',
      )
      .map((item) => ({
        datasetName,
        id: item.id,
        status: 'ARCHIVED' as const,
        input: item.input,
        expectedOutput: item.expectedOutput,
        metadata: item.metadata,
      })),
  }
}

async function runRestore(langfuse: NonNullable<ReturnType<typeof getLangfuse>>, args: RegenerateArgs): Promise<void> {
  const exported = parseExport(JSON.parse(readFileSync(args.restore!, 'utf8')))
  const dataset = await langfuse.getDataset(DATASET)
  const plan = buildRestorePlan(DATASET, exported, dataset.items as DatasetItem[])
  console.log(`restore from ${args.restore}: ${plan.restores.length} exported item(s) to re-write, ${plan.archives.length} admin-denied item(s) to archive`)
  for (const body of plan.archives) console.log(`  archive ${body.id}`)
  if (!args.apply) {
    console.log('\ndry run: nothing written; pass --apply to restore')
    return
  }
  const mismatches = await writeAndVerify(pacedItemApi(langfuseItemApi(langfuse)), [...plan.restores, ...plan.archives])
  reportLanded(mismatches, plan.restores.length + plan.archives.length)
}

function reportLanded(mismatches: Array<{ id: string; reason: string }>, total: number): void {
  if (mismatches.length === 0) {
    console.log(`verified: all ${total} item(s) landed as written in ${DATASET}`)
    return
  }
  console.error(`\nNOT LANDED: ${mismatches.length}/${total} item(s) in ${DATASET} differ from what was written`)
  for (const { id, reason } of mismatches) console.error(`  ${id}: ${reason}`)
  process.exitCode = 1
}

type Upsert = {
  id: string
  input: { user: string; promptName: 'detect' }
  expectedOutput: unknown
  metadata: Record<string, unknown>
  previousUser: string | null
  name: string
  item: DetectItem
}

type SupabaseClient = ReturnType<(typeof import('@/lib/supabase/service'))['createServiceClient']>

async function readChunked<T>(ids: string[], read: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const rows: T[] = []
  const unique = [...new Set(ids)]
  for (let i = 0; i < unique.length; i += READ_CHUNK) {
    rows.push(...(await read(unique.slice(i, i + READ_CHUNK))))
  }
  return rows
}

async function loadSubmissions(client: SupabaseClient, ids: string[]): Promise<Map<string, SubmissionRow>> {
  const rows = await readChunked(ids, async (chunk) => {
    const { data, error } = await client.from('brand_submissions').select('*').in('id', chunk)
    if (error) throw new Error(`brand_submissions read failed: ${error.message}`)
    return (data ?? []) as unknown as SubmissionRow[]
  })
  return new Map(rows.map((row) => [row.id, row]))
}

async function loadStoredSerp(client: SupabaseClient, submissionIds: string[]) {
  const { getLatestSearchResults } = await import('@/lib/services/search-results')
  const merged = new Map<string, { rawResponse: unknown; createdAt: string | null }>()
  await readChunked(submissionIds, async (chunk) => {
    const rows = await getLatestSearchResults(chunk, 'serp', 'submission', 'name', client)
    for (const [id, row] of rows) {
      // A row whose call never answered carries no organic results; search live instead.
      if (row.callStatus && row.callStatus !== 'succeeded' && row.callStatus !== 'empty') continue
      merged.set(id, { rawResponse: row.rawResponse, createdAt: row.createdAt ?? null })
    }
    return []
  })
  return merged
}

/**
 * SERP and probes for one brand, exactly as gather produces them: the stored
 * `name` row when there is one, otherwise a live search with the production
 * query (`serpNameQuery`); then a live `probeStatic` on the D15 URL list.
 * No audit resolver is passed, so the live search persists no search row.
 */
async function gatherEvidence(
  source: DetectSource,
  stored: { rawResponse: unknown; createdAt: string | null } | undefined,
  runDate: string,
) {
  const { batchSearchBrandsWithSnippets } = await import('@/lib/services/enrich-phases/scraper/search')
  const { probeStatic } = await import('@/lib/services/enrich-phases/gather')

  let rawResponse = stored?.rawResponse
  if (!stored) {
    const results = await batchSearchBrandsWithSnippets([source.name], (name) => serpNameQuery(name, source.igHandle), 1)
    const live = results.get(source.name)
    if (live?.callStatus !== 'succeeded' && live?.callStatus !== 'empty') {
      throw new Error(`live SERP ${live?.callStatus ?? 'missing'}${live?.error ? `: ${live.error}` : ''}`)
    }
    rawResponse = live.rawEntries
  }
  const urls = probeUrlsFor(source)
  const probeEvidence = urls.length > 0 ? await probeStatic(urls) : []
  return {
    ...buildDetectItem({ source, rawResponse, probeEvidence }),
    ...evidenceMetadata({ serpCreatedAt: stored?.createdAt ?? null, runDate }),
  }
}

type Plan = {
  upserts: Upsert[]
  failures: Array<{ id: string; reason: string }>
  attempted: number
  unchanged: number
  fallbackCount: number
  probeDrift: number
  rerendered: number
  deniedAdded: number
  /** `existingById`: the uuid5 id is already in Langfuse (any status, ARCHIVED included). */
  deniedSkipped: { existing: number; existingById: number; anchorLeak: string[] }
  /** Denied candidates left after every skip, before `--denied-sample`. */
  deniedPool: number
  submissionIds: string[]
}

const deniedItemId = (submissionId: string) => uuid5(`detect-golden:denied:${submissionId}`)

/**
 * Denial reasons that may hide a non-brand. The others (`duplicate`,
 * `no_purchase_channel`, `insufficient_info`, `not_mit`, taxonomy re-files)
 * reject a real brand on policy, so they would only add easy negatives.
 */
const DENIED_REASONS = ['other', 'admin_reject'] as const

export const DENIED_SAMPLE_SEED = '20260928'

/** PURE. A seeded sample of `n` rows, stable under input order; null keeps all. */
export function sampleDenied<T extends { id: string }>(rows: readonly T[], n: number | null, seed: string): T[] {
  const ordered = [...rows].sort((a, b) => a.id.localeCompare(b.id))
  if (n === null || n >= ordered.length) return ordered
  return shuffleWithSeed(ordered, seed).slice(0, n)
}

async function buildPlan(
  client: SupabaseClient,
  items: DatasetItem[],
  args: RegenerateArgs,
  runDate: string,
  /** True when Langfuse holds the id in any status (a per-id read, not the listing). */
  isPresent: (id: string) => Promise<boolean>,
): Promise<Plan> {
  const plan: Plan = {
    upserts: [],
    failures: [],
    attempted: 0,
    unchanged: 0,
    fallbackCount: 0,
    probeDrift: 0,
    rerendered: 0,
    deniedAdded: 0,
    deniedSkipped: { existing: 0, existingById: 0, anchorLeak: [] },
    deniedPool: 0,
    submissionIds: [],
  }

  // Per item: sourceAuditResultId → brand_ai_results → brand_submissions.
  const metaOf = (item: DatasetItem) => ((item.metadata as Record<string, unknown> | null) ?? {})
  const sourceOf = (item: DatasetItem) =>
    ((metaOf(item).source as { sourceAuditResultId?: string; submissionId?: string } | undefined) ?? {})
  const auditIds = items.map((item) => sourceOf(item).sourceAuditResultId).filter((id): id is string => Boolean(id))
  const auditRows = await readChunked(auditIds, async (chunk) => {
    const { data, error } = await client.from('brand_ai_results').select('id, submission_id').in('id', chunk)
    if (error) throw new Error(`brand_ai_results read failed: ${error.message}`)
    return data ?? []
  })
  const submissionByAudit = new Map(auditRows.map((row) => [row.id, row.submission_id]))
  const slugSubmissionIdOf = (item: DatasetItem): string | null => {
    const user = (item.input as { user?: unknown } | null)?.user
    if (typeof user !== 'string') return null
    try {
      return submissionIdFromSlug(parseStoredFields(user).slug)
    } catch {
      return null
    }
  }
  const submissionIdOf = (item: DatasetItem): string | null => {
    const source = sourceOf(item)
    return (
      (source.sourceAuditResultId && submissionByAudit.get(source.sourceAuditResultId)) ||
      source.submissionId ||
      slugSubmissionIdOf(item)
    )
  }

  const itemSubmissionIds = items.map(submissionIdOf).filter((id): id is string => Boolean(id))
  const submissions = await loadSubmissions(client, itemSubmissionIds)

  let denied: Array<SubmissionRow & { denial_reason: string | null; submitted_at: string }> = []
  if (args.addDenied) {
    // D9: admin-denied submissions as extra non-brand candidates. `duplicate`
    // denials are excluded: they are real brands already covered elsewhere.
    const existingIds = new Set(itemSubmissionIds)
    const existingNames = new Set(
      items.map((item) => {
        try {
          return parseStoredFields((item.input as { user: string }).user).name.trim().toLowerCase()
        } catch {
          return ''
        }
      }),
    )
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await client
        .from('brand_submissions')
        .select('*')
        .eq('status', 'rejected')
        .in('denial_reason', [...DENIED_REASONS])
        .order('submitted_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) throw new Error(`denied brand_submissions read failed: ${error.message}`)
      const page = (data ?? []) as unknown as typeof denied
      if (page.length === 0) break
      for (const row of page) {
        if (existingIds.has(row.id) || existingNames.has(row.brand_name.trim().toLowerCase())) {
          plan.deniedSkipped.existing++
          continue
        }
        denied.push(row)
      }
    }
    denied = denied.filter((row) => {
      const name = getDisplayBrandName(submissionToEnrichBrand(row))
      if (!isAnchorLeak(name)) return true
      plan.deniedSkipped.anchorLeak.push(`${row.id} (${name})`)
      return false
    })
    // A denied item's uuid5 id may already exist ARCHIVED (rejected in review);
    // the listing hides it, and re-writing it would re-activate it. Checked
    // before any search or probe, so a skipped item costs no Serper credit.
    const present = new Set<string>()
    for (const row of denied) {
      if (await isPresent(deniedItemId(row.id))) present.add(deniedItemId(row.id))
    }
    const { kept, skipped } = dropExistingIds(
      denied.map((row) => ({ id: deniedItemId(row.id), row })),
      present,
    )
    denied = kept.map(({ row }) => row)
    plan.deniedSkipped.existingById = skipped.length
    // Sampled last, after every skip, so the sample is exactly n when the pool allows.
    plan.deniedPool = denied.length
    denied = sampleDenied(denied, args.deniedSample, DENIED_SAMPLE_SEED)
  }

  plan.submissionIds = [...new Set([...itemSubmissionIds, ...denied.map((row) => row.id)])]
  const storedSerp = await loadStoredSerp(client, plan.submissionIds)

  // Sequential on purpose: ~200 items, one Serper call at most each. Switch to
  // mapWithConcurrency if the set grows past a few hundred.
  for (const item of items) {
    plan.attempted++
    const user = (item.input as { user?: unknown } | null)?.user
    try {
      if (typeof user !== 'string') throw new Error('input.user is not a string')
      const stored = parseStoredFields(user)
      const submissionId = submissionIdOf(item)
      const submission = submissionId ? submissions.get(submissionId) : undefined
      if (!submission) plan.fallbackCount++
      const source = submission ? sourceFromSubmission(submission) : sourceFromStored(stored)
      const evidence = await gatherEvidence(source, submissionId ? storedSerp.get(submissionId) : undefined, runDate)
      if (headProbeCount(evidence.item) !== stored.probeLineCount) plan.probeDrift++
      if (evidence.rendered === user) plan.unchanged++
      else plan.rerendered++
      plan.upserts.push({
        id: item.id,
        input: { ...(item.input as object), user: evidence.rendered, promptName: 'detect' },
        expectedOutput: item.expectedOutput,
        metadata: {
          ...metaOf(item),
          evidenceDates: evidence.evidenceDates,
          serpSource: evidence.serpSource,
          // Labels are re-decided by the blind panel (Task 10).
          humanApproval: { status: 'pending' },
          inputRegeneratedBy: 'DEV-1894',
          ...(submission ? {} : { inputRebuiltFrom: 'stored-fields' }),
        },
        previousUser: user,
        name: evidence.item.name,
        item: evidence.item,
      })
    } catch (error) {
      plan.failures.push({ id: item.id, reason: error instanceof Error ? error.message : String(error) })
    }
  }

  if (args.assignSplits) {
    const unsplit = plan.upserts.filter((upsert) => !upsert.metadata.split)
    const strata = new Map(
      unsplit.map((upsert) => [
        upsert.id,
        typeof upsert.metadata.stratum === 'string' ? upsert.metadata.stratum : stratumFromExpected(upsert.expectedOutput),
      ]),
    )
    const splits = seededSplits([...strata].map(([id, stratum]) => ({ id, stratum })))
    for (const upsert of unsplit) {
      upsert.metadata = { ...upsert.metadata, stratum: strata.get(upsert.id), split: splits.get(upsert.id) }
    }
  }

  const deniedUpserts: Upsert[] = []
  for (const row of denied) {
    plan.attempted++
    const id = deniedItemId(row.id)
    try {
      const source = sourceFromSubmission(row)
      const evidence = await gatherEvidence(source, storedSerp.get(row.id), runDate)
      deniedUpserts.push({
        id,
        input: { user: evidence.rendered, promptName: 'detect' },
        // No draft label: the blind panel labels every item from scratch (D10).
        expectedOutput: null,
        metadata: {
          source: {
            kind: 'admin-denied-submission',
            submissionId: row.id,
            status: row.status,
            denialReason: row.denial_reason,
            sourceCreatedAt: row.submitted_at,
          },
          stratum: 'admin-denied',
          evidenceDates: evidence.evidenceDates,
          serpSource: evidence.serpSource,
          humanApproval: { status: 'pending' },
          addedBy: 'DEV-1894 admin-denied sample (D9)',
        },
        previousUser: null,
        name: evidence.item.name,
        item: evidence.item,
      })
    } catch (error) {
      plan.failures.push({ id, reason: `denied ${row.id}: ${error instanceof Error ? error.message : String(error)}` })
    }
  }
  const deniedSplits = seededSplits(deniedUpserts.map((upsert) => ({ id: upsert.id, stratum: 'admin-denied' })))
  for (const upsert of deniedUpserts) upsert.metadata.split = deniedSplits.get(upsert.id)
  plan.deniedAdded = deniedUpserts.length
  plan.upserts.push(...deniedUpserts)

  return plan
}

function report(plan: Plan, args: RegenerateArgs): void {
  const changed = plan.upserts.filter((upsert) => upsert.previousUser !== upsert.input.user)
  for (const upsert of changed.slice(0, args.diffs)) {
    console.log(`\n${upsert.previousUser === null ? 'add' : 'rewrite'}  ${upsert.id}  ${upsert.name}`)
    for (const line of upsert.previousUser?.split('\n') ?? []) console.log(`  - ${line}`)
    for (const line of upsert.input.user.split('\n')) console.log(`  + ${line}`)
  }

  const existing = plan.upserts.filter((upsert) => upsert.previousUser !== null)
  console.log('\n--- pre-mortem ---')
  let tagged = 0
  for (const failure of NAMED_FAILURES) {
    const hit = existing.find((upsert) => failure.matches(upsert.name.trim()))
    const tags = hit ? (hit.item.results ?? []).filter((result) => result.match !== null).length : 0
    if (tags > 0) tagged++
    console.log(`  ${failure.label}: ${hit ? `${tags} tagged result(s)` : 'not found'}`)
  }
  console.log(`  named failures with >=1 tag: ${tagged}/${NAMED_FAILURES.length} (stop and re-plan below 3)`)
  const driftPct = existing.length ? ((plan.probeDrift / existing.length) * 100).toFixed(1) : '0'
  console.log(`  probe outcome differs from stored probe lines: ${plan.probeDrift}/${existing.length} (${driftPct}%; report the subset separately above 25%)`)

  console.log('\n--- summary ---')
  console.log(`  attempted ${plan.attempted}, failed ${plan.failures.length}`)
  console.log(`  re-rendered ${plan.rerendered}, unchanged ${plan.unchanged}`)
  console.log(`  missing submission row, rebuilt from stored fields: ${plan.fallbackCount}`)
  const live = plan.upserts.filter((upsert) => upsert.metadata.serpSource === 'live').length
  console.log(`  SERP: ${plan.upserts.length - live} stored, ${live} live`)
  if (args.addDenied) {
    console.log(`  admin-denied added ${plan.deniedAdded} of a pool of ${plan.deniedPool}, skipped ${plan.deniedSkipped.existing} already present, ${plan.deniedSkipped.existingById} id already in Langfuse (any status), ${plan.deniedSkipped.anchorLeak.length} anchor leak`)
    for (const leak of plan.deniedSkipped.anchorLeak) console.log(`    anchor leak: ${leak}`)
  }
  for (const failure of plan.failures) console.log(`  FAILED ${failure.id}: ${failure.reason}`)
}

async function main() {
  const { argv } = loadScriptTarget()
  const args = parseRegenerateArgs(argv)
  const langfuse = getLangfuse()
  if (!langfuse) throw new Error('Langfuse not configured')
  if (args.restore) {
    await runRestore(langfuse, args)
    await flushLangfuse()
    return
  }

  const { createServiceClient } = await import('@/lib/supabase/service')
  const { installSeams, assertNoNewAuditRows } = await import('@/lib/services/eval/zero-write')
  const { runWithAuditContext } = await import('@/lib/audit/context')

  const dataset = await langfuse.getDataset(DATASET)
  const items = dataset.items as DatasetItem[]
  const paced = pacedItemApi(langfuseItemApi(langfuse))
  const runDate = new Date().toISOString().slice(0, 10)
  const correlationId = randomUUID()
  const since = new Date()
  // Both seams: audit envelopes (external_call_audit) and LLM usage rows.
  const { collector, restore } = installSeams({
    sinkPath: `scripts/llm-eval/runs/regenerate-detect-golden-${since.toISOString().replace(/[:.]/g, '-')}.jsonl`,
  })

  let plan: Plan
  try {
    plan = await runWithAuditContext({ correlationId }, () =>
      buildPlan(createServiceClient(), items, args, runDate, async (id) => (await paced.lookup(id)).present),
    )
    report(plan, args)
    // Runs before any write: the Langfuse writes below touch no audited table,
    // and a leaked row must stop the apply.
    await assertNoNewAuditRows({
      since,
      correlationIds: [correlationId],
      spanIds: collector.all().map((record) => record.spanId),
      ...(plan.submissionIds.length > 0 ? { submissionIds: plan.submissionIds } : {}),
    })
  } finally {
    restore()
  }

  if (!args.apply) {
    console.log(`\ndry run: ${plan.upserts.length} item(s) would be written to ${DATASET}; nothing written`)
    await flushLangfuse()
    return
  }

  const guard = applyGuard({ total: plan.attempted, failed: plan.failures.length })
  if (!guard.ok) {
    console.error(`\nrefusing --apply: ${guard.reason}`)
    process.exitCode = 1
    return
  }

  // Rollback source. 'wx' refuses to overwrite an earlier export.
  writeFileSync(
    args.preExport!,
    JSON.stringify(
      items.map((item) => ({ id: item.id, status: item.status, input: item.input, expectedOutput: item.expectedOutput, metadata: item.metadata })),
      null,
      2,
    ),
    { flag: 'wx' },
  )
  console.log(`\nexported ${items.length} current item(s) to ${args.preExport}`)

  const bodies: ItemBody[] = plan.upserts.map((upsert) => ({
    datasetName: DATASET,
    id: upsert.id,
    input: upsert.input,
    expectedOutput: upsert.expectedOutput,
    status: 'ACTIVE',
    metadata: upsert.metadata,
  }))
  const mismatches = await writeAndVerify(paced, bodies)
  console.log(`applied: ${bodies.length - mismatches.length}/${bodies.length} item(s) written to ${DATASET}`)
  reportLanded(mismatches, bodies.length)
  await flushLangfuse()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
