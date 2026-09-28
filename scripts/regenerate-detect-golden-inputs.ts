/**
 * @formoria-script
 * purpose: Re-render detect-confidence-golden inputs through the production detect renderer, optionally adding admin-denied submissions and seeded splits (DEV-1894)
 * class: operator
 * invoke: npx tsx scripts/regenerate-detect-golden-inputs.ts [--target production] [--add-denied] [--assign-splits] [--diffs <n>] [--apply --pre-export <path>]
 * target: staging-default
 * safety: dry-run-default
 * owner: engineering
 * notes: Writes to Langfuse dataset items only, and only on --apply (which requires --pre-export, the rollback file). Database and Serper/probe calls are read-only; both zero-write seams are installed and assertNoNewAuditRows runs before any write.
 */
import { createHash, randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'

import { loadScriptTarget } from './shared/target'
import { splitByQuery } from './enrichment/eval/search-eval/label-shared'

import { getLangfuse, flushLangfuse } from '@/lib/langfuse/client'
import { DETECT_MESSAGE_LABELS as L } from '@/lib/prompts/detect-message'
import { renderDetectUserMessage, MAX_PROBE_URLS, type DetectItem } from '@/lib/services/category-classifier'
import {
  collectKnownUrls,
  serpNameQuery,
  submissionToEnrichBrand,
  uniqueUrls,
} from '@/lib/services/curation-operations'
import { detectProbes, detectResults } from '@/lib/services/enrich-phases/detect-evidence'
import type { ProbeEvidence } from '@/lib/services/enrich-phases/gather'
import { extractInstagramHandle } from '@/lib/services/enrich-phases/scraper/parse/extractors'
import { parseBrandSearchEntries } from '@/lib/services/enrich-phases/scraper/search'
import { getDisplayBrandName } from '@/lib/services/enrich-phases/types'
import { parseLabelledLines } from '@/lib/services/eval/jev-questions'
import { JEV_INPUT_LABELS } from '@/lib/prompts/jev'

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
  addDenied: boolean
  assignSplits: boolean
  diffs: number
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
  if (apply && !preExport) {
    throw new Error('--apply requires --pre-export <path>: the current items are exported there first, as the rollback source')
  }
  const diffsRaw = valueOf('--diffs')
  const diffs = diffsRaw === null ? 10 : Number(diffsRaw)
  if (!Number.isInteger(diffs) || diffs < 0) throw new Error(`--diffs must be a non-negative integer, got ${diffsRaw}`)
  return {
    apply,
    preExport,
    addDenied: argv.includes('--add-denied'),
    assignSplits: argv.includes('--assign-splits'),
    diffs,
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
    ownedUrls: uniqueUrls([brand.website_url ?? '', ...collectKnownUrls(brand)]),
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
    results: detectResults(parseBrandSearchEntries(rawResponse), source.ownedUrls, source.igHandle),
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
  deniedSkipped: { existing: number; anchorLeak: string[] }
  submissionIds: string[]
}

async function buildPlan(
  client: SupabaseClient,
  items: DatasetItem[],
  args: RegenerateArgs,
  runDate: string,
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
    deniedSkipped: { existing: 0, anchorLeak: [] },
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
  const submissionIdOf = (item: DatasetItem): string | null => {
    const source = sourceOf(item)
    return (source.sourceAuditResultId && submissionByAudit.get(source.sourceAuditResultId)) || source.submissionId || null
  }

  const itemSubmissionIds = items.map(submissionIdOf).filter((id): id is string => Boolean(id))
  const submissions = await loadSubmissions(client, itemSubmissionIds)

  let denied: Array<SubmissionRow & { denial_reason: string | null; created_at: string }> = []
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
        .not('denial_reason', 'is', null)
        .neq('denial_reason', 'duplicate')
        .order('created_at', { ascending: true })
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
    const id = uuid5(`detect-golden:denied:${row.id}`)
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
            sourceCreatedAt: row.created_at,
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
    console.log(`  admin-denied added ${plan.deniedAdded}, skipped ${plan.deniedSkipped.existing} already present, ${plan.deniedSkipped.anchorLeak.length} anchor leak`)
    for (const leak of plan.deniedSkipped.anchorLeak) console.log(`    anchor leak: ${leak}`)
  }
  for (const failure of plan.failures) console.log(`  FAILED ${failure.id}: ${failure.reason}`)
}

async function main() {
  const { argv } = loadScriptTarget()
  const args = parseRegenerateArgs(argv)
  const langfuse = getLangfuse()
  if (!langfuse) throw new Error('Langfuse not configured')

  const { createServiceClient } = await import('@/lib/supabase/service')
  const { installSeams, assertNoNewAuditRows } = await import('@/lib/services/eval/zero-write')
  const { runWithAuditContext } = await import('@/lib/audit/context')

  const dataset = await langfuse.getDataset(DATASET)
  const items = dataset.items as DatasetItem[]
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
      buildPlan(createServiceClient(), items, args, runDate),
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

  for (const upsert of plan.upserts) {
    await langfuse.createDatasetItem({
      datasetName: DATASET,
      id: upsert.id,
      input: upsert.input,
      expectedOutput: upsert.expectedOutput,
      status: 'ACTIVE',
      metadata: upsert.metadata,
    })
  }
  console.log(`applied: ${plan.upserts.length} item(s) written to ${DATASET}`)
  await flushLangfuse()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
