/**
 * @formoria-script
 * purpose: LLM evaluation harness — dataset validation, golden review, experiment runs, prompt management, pairwise comparison
 * class: operator
 * invoke: pnpm llm-eval
 * target: staging-default
 * safety: writes-on-apply
 * owner: engineering
 * notes: Writes to Langfuse (dataset items, scores, annotation queue items, prompt versions on push, labels on promote, repo snapshot on pull). Zero production DB writes enforced by assertNoNewAuditRows.
 */
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs as nodeParseArgs } from 'node:util'

import { config as dotenvConfig } from 'dotenv'

import { assertCensusTarget } from '../enrichment/eval/production-guard'
import { loadScriptTarget } from '../shared/target'

// @/ imports — available after loadScriptTarget() sets up env
import { getLangfuse, flushLangfuse } from '@/lib/langfuse/client'
import {
  adapterFor,
  registeredDatasets,
} from '@/lib/services/eval/phase-adapters'
import { enqueueDataset, applyVerdicts } from '@/lib/services/eval/golden-review'
import { runExperiment, type ExperimentArm } from '@/lib/services/eval/run-experiment'
import {
  type ProductsReplayOutput,
  driftRate,
} from '@/lib/services/eval/products-calibration'
import type { SnapshotFile, PromptApi } from '@/lib/services/eval/prompt-sync'
import {
  promptForDataset,
  type GoldenItemBody,
  type HarvestRow,
  type PromptTexts,
  type TimedCapturedCall,
} from '@/lib/services/eval/golden-capture'
import type { EnrichBrand, EnrichPhase } from '@/lib/services/enrich-phases/types'

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

export type ArmSpec =
  | { kind: 'prompt'; version: number }
  | { kind: 'model'; model: string }

export type ParsedCommand =
  | { command: 'dataset-validate'; allowUnreviewed: boolean }
  | { command: 'dataset-review-enqueue'; dataset: string }
  | { command: 'dataset-review-push'; dataset: string; approvedBy: string }
  | { command: 'dataset-record'; dataset: string; brand: string; urls?: string[] }
  | { command: 'dataset-prelabel'; dataset: string; item: string; file: string }
  | { command: 'dataset-harvest'; dataset: string; since?: string; limit?: number; confirm: boolean }
  | { command: 'dataset-capture'; brands: string[]; datasets?: string[]; confirm: boolean }
  | {
      command: 'run'
      dataset: string
      arms: ArmSpec[]
      envFile?: string
      allowUnreviewed: boolean
    }
  | { command: 'prompt-push'; name: string; file?: string; label?: string; allowVariableChange: boolean }
  | { command: 'prompt-pull'; add: string[]; check: boolean; allowVariableChange: boolean }
  | { command: 'prompt-promote'; name: string; version: number; allowVariableChange: boolean }
  | {
      command: 'pairwise-run'
      phase: string
      target: string
      sample: number
      arms: ArmSpec[]
      envFile?: string
      noEnqueue: boolean
      allowUnreviewed: boolean
    }
  | { command: 'pairwise-report'; runName: string }

export function parseArm(spec: string): ArmSpec {
  const colon = spec.indexOf(':')
  if (colon === -1) {
    throw new Error(
      `Malformed arm spec: ${spec} (expected prompt:<version> or model:<name>)`,
    )
  }

  const kind = spec.slice(0, colon)
  const value = spec.slice(colon + 1)

  if (kind === 'prompt') {
    const version = Number(value)
    if (!value || !Number.isFinite(version) || version < 1) {
      throw new Error(`Malformed arm spec: ${spec} (version must be a positive integer)`)
    }
    return { kind: 'prompt', version }
  }

  if (kind === 'model') {
    if (!value) {
      throw new Error(`Malformed arm spec: ${spec} (model name required)`)
    }
    return { kind: 'model', model: value }
  }

  throw new Error(
    `Malformed arm spec: ${spec} (expected prompt:<version> or model:<name>)`,
  )
}

function splitList(value: string): string[] {
  return value.split(',').map((part) => part.trim()).filter(Boolean)
}

function assertGoldenCaptureDataset(dataset: string): void {
  if (!promptForDataset(dataset)) {
    throw new Error(`"${dataset}" is not a capture/harvest golden dataset`)
  }
}

export function parseCliArgs(args: string[]): ParsedCommand {
  const { positionals, values } = nodeParseArgs({
    args,
    allowPositionals: true,
    options: {
      dataset: { type: 'string' },
      arm: { type: 'string', multiple: true },
      'env-file': { type: 'string' },
      'approved-by': { type: 'string' },
      'allow-unreviewed': { type: 'boolean', default: false },
      name: { type: 'string' },
      phase: { type: 'string' },
      target: { type: 'string' },
      sample: { type: 'string' },
      brand: { type: 'string' },
      urls: { type: 'string' },
      item: { type: 'string' },
      file: { type: 'string' },
      'no-enqueue': { type: 'boolean', default: false },
      add: { type: 'string', multiple: true },
      check: { type: 'boolean', default: false },
      label: { type: 'string' },
      'allow-variable-change': { type: 'boolean', default: false },
      since: { type: 'string' },
      limit: { type: 'string' },
      brands: { type: 'string' },
      datasets: { type: 'string' },
      confirm: { type: 'boolean', default: false },
    },
  })

  const sub = positionals[0]

  if (sub === 'dataset') {
    const sub2 = positionals[1]
    if (sub2 === 'validate') {
      return {
        command: 'dataset-validate',
        allowUnreviewed: values['allow-unreviewed'] ?? false,
      }
    }
    if (sub2 === 'record') {
      if (!values.dataset) throw new Error('--dataset is required')
      if (!values.brand) throw new Error('--brand is required')
      return {
        command: 'dataset-record',
        dataset: values.dataset,
        brand: values.brand,
        urls: values.urls ? values.urls.split(',') : undefined,
      }
    }
    if (sub2 === 'harvest') {
      if (!values.dataset) throw new Error('--dataset is required')
      assertGoldenCaptureDataset(values.dataset)
      if (values.since !== undefined && Number.isNaN(new Date(values.since).getTime())) {
        throw new Error('--since must be a date (YYYY-MM-DD)')
      }
      const limit = values.limit !== undefined ? Number(values.limit) : undefined
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
        throw new Error('--limit must be a positive integer')
      }
      return {
        command: 'dataset-harvest',
        dataset: values.dataset,
        since: values.since,
        limit,
        confirm: values.confirm ?? false,
      }
    }
    if (sub2 === 'capture') {
      if (!values.brands) throw new Error('--brands is required')
      const datasets = values.datasets ? splitList(values.datasets) : undefined
      datasets?.forEach(assertGoldenCaptureDataset)
      return {
        command: 'dataset-capture',
        brands: splitList(values.brands),
        datasets,
        confirm: values.confirm ?? false,
      }
    }
    if (sub2 === 'prelabel') {
      if (!values.dataset) throw new Error('--dataset is required')
      if (!values.item) throw new Error('--item is required')
      if (!values.file) throw new Error('--file is required')
      return {
        command: 'dataset-prelabel',
        dataset: values.dataset,
        item: values.item,
        file: values.file,
      }
    }
    if (sub2 === 'review') {
      const sub3 = positionals[2]
      if (sub3 === 'enqueue') {
        if (!values.dataset) throw new Error('--dataset is required')
        return {
          command: 'dataset-review-enqueue',
          dataset: values.dataset,
        }
      }
      if (sub3 === 'push') {
        if (!values.dataset) throw new Error('--dataset is required')
        if (!values['approved-by'])
          throw new Error('--approved-by is required')
        return {
          command: 'dataset-review-push',
          dataset: values.dataset,
          approvedBy: values['approved-by'],
        }
      }
    }
  }

  if (sub === 'run') {
    if (!values.dataset) throw new Error('--dataset is required')
    const arms = (values.arm ?? []).map(parseArm)
    return {
      command: 'run',
      dataset: values.dataset,
      arms,
      envFile: values['env-file'],
      allowUnreviewed: values['allow-unreviewed'] ?? false,
    }
  }

  if (sub === 'prompt') {
    const sub2 = positionals[1]
    if (sub2 === 'push') {
      const name = positionals[2]
      if (!name) throw new Error('name argument is required')
      const label = values.label
      if (label !== undefined && label !== 'production') {
        throw new Error('--label must be "production" if specified')
      }
      return {
        command: 'prompt-push',
        name,
        file: values.file,
        label,
        allowVariableChange: values['allow-variable-change'] ?? false,
      }
    }
    if (sub2 === 'pull') {
      return {
        command: 'prompt-pull',
        add: values.add ?? [],
        check: values.check ?? false,
        allowVariableChange: values['allow-variable-change'] ?? false,
      }
    }
    if (sub2 === 'promote') {
      const name = positionals[2]
      if (!name) throw new Error('name argument is required')
      const versionStr = positionals[3]
      if (!versionStr) throw new Error('version argument is required')
      const version = Number(versionStr)
      if (!Number.isInteger(version) || version < 1) {
        throw new Error('version must be a positive integer')
      }
      return {
        command: 'prompt-promote',
        name,
        version,
        allowVariableChange: values['allow-variable-change'] ?? false,
      }
    }
  }

  if (sub === 'pairwise') {
    const sub2 = positionals[1]
    if (sub2 === 'run') {
      if (!values.phase) throw new Error('--phase is required')
      const sample = values.sample ? Number(values.sample) : 20
      if (!Number.isFinite(sample) || sample < 1)
        throw new Error('--sample must be a positive integer')
      const arms = (values.arm ?? []).map(parseArm)
      return {
        command: 'pairwise-run',
        phase: values.phase,
        target: values.target ?? 'staging',
        sample,
        arms,
        envFile: values['env-file'],
        noEnqueue: values['no-enqueue'] ?? false,
        allowUnreviewed: values['allow-unreviewed'] ?? false,
      }
    }
    if (sub2 === 'report') {
      const runName = positionals[2]
      if (!runName) throw new Error('run name argument is required')
      return { command: 'pairwise-report', runName }
    }
  }

  throw new Error(
    `Unknown command: ${args.join(' ')}\n` +
      'Usage:\n' +
      '  llm-eval dataset validate [--allow-unreviewed]\n' +
      '  llm-eval dataset record --dataset <name> --brand <slug> [--urls url1,url2,...]\n' +
      '  llm-eval dataset prelabel --dataset <name> --item <id> --file <json-path>\n' +
      '  llm-eval dataset harvest --dataset <name> [--since <YYYY-MM-DD>] [--limit <n>] [--target production --confirm]\n' +
      '  llm-eval dataset capture --brands <slug,slug,...> [--datasets <name,name,...>] [--target production --confirm]\n' +
      '  llm-eval dataset review enqueue --dataset <name>\n' +
      '  llm-eval dataset review push --dataset <name> --approved-by <user>\n' +
      '  llm-eval run --dataset <name> --arm <spec> [--arm <spec>] [--env-file <path>] [--allow-unreviewed]\n' +
      '  llm-eval prompt push <name> [--file <path>] [--label production] [--allow-variable-change]\n' +
      '  llm-eval prompt pull [--add <name>]... [--check] [--allow-variable-change]\n' +
      '  llm-eval prompt promote <name> <version> [--allow-variable-change]\n' +
      '  llm-eval pairwise run --phase <phase> [--target <target>] [--sample <n>] --arm <spec> --arm <spec> [--no-enqueue] [--allow-unreviewed]\n' +
      '  llm-eval pairwise report <runName>',
  )
}

// ---------------------------------------------------------------------------
// Env file helper
// ---------------------------------------------------------------------------

/**
 * Applies a dotenv file with override:false — existing env vars are preserved.
 * Called BEFORE loadScriptTarget so the scratch file's values win over the
 * target's .env.staging defaults.
 */
export function applyEnvFile(
  path: string,
  processEnv: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): void {
  dotenvConfig({ path, override: false, processEnv })
}

// ---------------------------------------------------------------------------
// Prompt snapshot path
// ---------------------------------------------------------------------------

export const LANGFUSE_SNAPSHOT_PATH = 'src/lib/prompts/langfuse-snapshot.json'

// ---------------------------------------------------------------------------
// Prompt handlers
// ---------------------------------------------------------------------------

type PromptHandlerDeps = {
  api: PromptApi
  log: (msg: string) => void
  readFile: (path: string) => string
  writeFile: (path: string, content: string) => void
}

function defaultApi(): PromptApi {
  const client = getLangfuse()
  if (!client) throw new Error('Langfuse not configured')
  return client.api as unknown as PromptApi
}

export async function handlePromptPush({
  name,
  file,
  label,
  deps,
}: {
  name: string
  file?: string
  label?: string
  deps?: Partial<PromptHandlerDeps>
}): Promise<void> {
  const { pushPrompt } = await import(
    '@/lib/services/eval/prompt-sync'
  )

  const api = deps?.api ?? defaultApi()
  const logFn = deps?.log ?? console.log
  const readFileFn = deps?.readFile ?? ((p: string) => readFileSync(p, 'utf8'))

  let text: string | undefined
  let snapshot: SnapshotFile | undefined

  if (file) {
    text = readFileFn(file)
  } else {
    const raw = readFileFn(LANGFUSE_SNAPSHOT_PATH)
    snapshot = JSON.parse(raw) as SnapshotFile
  }

  const result = await pushPrompt({ api, name, text, snapshot, label })

  if (result.skipped) {
    logFn(`${name} unchanged, skipped`)
  } else {
    logFn(`${name} v${result.version}`)
  }
}

export async function handlePromptPull({
  add,
  check,
  allowVariableChange,
  deps,
}: {
  add: string[]
  check: boolean
  allowVariableChange: boolean
  deps?: Partial<PromptHandlerDeps>
}): Promise<number> {
  const { pullSnapshot } = await import(
    '@/lib/services/eval/prompt-sync'
  )

  const api = deps?.api ?? defaultApi()
  const logFn = deps?.log ?? console.log
  const readFileFn = deps?.readFile ?? ((p: string) => readFileSync(p, 'utf8'))
  const writeFileFn =
    deps?.writeFile ?? ((p: string, c: string) => writeFileSync(p, c))

  const raw = readFileFn(LANGFUSE_SNAPSHOT_PATH)
  const snapshot = JSON.parse(raw) as SnapshotFile
  const knownNames = Object.keys(snapshot.prompts)

  // For now, remoteNames = knownNames + add (CLI does not list all remote prompts)
  const remoteNames = [...knownNames, ...add]

  const result = await pullSnapshot({
    api,
    snapshot,
    knownNames,
    remoteNames,
    add,
    check,
    allowVariableChange,
    warn: (msg: string) => logFn(`[warn] ${msg}`),
  })

  if (result.fetchErrors) {
    for (const e of result.fetchErrors) {
      logFn(`fetch error: ${e.name} (${e.error})`)
    }
  }

  if (!result.ok) {
    if (result.drift) {
      for (const d of result.drift) {
        logFn(`drift: ${d.name} snapshot=v${d.snapshotVersion} remote=v${d.remoteVersion}`)
      }
    }
    if (result.rejected) {
      for (const name of result.rejected) {
        logFn(`rejected: ${name} (no production label)`)
      }
    }
    if (result.placeholderDrift) {
      for (const d of result.placeholderDrift) {
        logFn(`placeholder drift: ${d.name} +${d.added.join(',')} -${d.removed.join(',')}`)
      }
    }
  }

  // A partial pull (fetch errors only) still writes the prompts that succeeded
  if (result.snapshot && !check) {
    writeFileFn(
      LANGFUSE_SNAPSHOT_PATH,
      JSON.stringify(result.snapshot, null, 2) + '\n',
    )
    logFn('Snapshot updated')
  }

  return result.ok ? 0 : 1
}

export async function handlePromptPromote({
  name,
  version,
  allowVariableChange = false,
  deps,
}: {
  name: string
  version: number
  allowVariableChange?: boolean
  deps?: Partial<PromptHandlerDeps>
}): Promise<number> {
  const { promotePrompt } = await import(
    '@/lib/services/eval/prompt-sync'
  )

  const api = deps?.api ?? defaultApi()
  const logFn = deps?.log ?? console.log
  const readFileFn = deps?.readFile ?? ((p: string) => readFileSync(p, 'utf8'))
  const writeFileFn =
    deps?.writeFile ?? ((p: string, c: string) => writeFileSync(p, c))

  const raw = readFileFn(LANGFUSE_SNAPSHOT_PATH)
  const snapshot = JSON.parse(raw) as SnapshotFile
  const knownNames = Object.keys(snapshot.prompts)

  const result = await promotePrompt({
    api,
    name,
    version,
    snapshot,
    knownNames,
    allowVariableChange,
  })

  if (!result.ok) {
    logFn(`promote failed: ${result.error}`)
    return 1
  }

  for (const e of result.fetchErrors ?? []) {
    logFn(`[warn] fetch error: ${e.name} (${e.error}), snapshot entry kept`)
  }

  if (result.snapshot) {
    writeFileFn(
      LANGFUSE_SNAPSHOT_PATH,
      JSON.stringify(result.snapshot, null, 2) + '\n',
    )
    logFn(`${name} v${version} promoted to production, snapshot updated`)
  }

  return 0
}

// ---------------------------------------------------------------------------
// Pre-scan for --env-file (needed before loadScriptTarget)
// ---------------------------------------------------------------------------

function extractEnvFile(args: readonly string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--env-file' && i + 1 < args.length) return args[i + 1]
    if (args[i]?.startsWith('--env-file='))
      return args[i]!.slice('--env-file='.length)
  }
  return undefined
}

// ---------------------------------------------------------------------------
// isReviewed — requires humanApproval.reviewedVia (queue-based review)
// ---------------------------------------------------------------------------

export function isReviewed(item: { metadata?: unknown }): boolean {
  const meta = item.metadata as Record<string, unknown> | undefined
  const ha = meta?.humanApproval as Record<string, unknown> | undefined
  return ha?.reviewedVia != null
}

export function isAdmittedProductsItem(
  item: { status: string; metadata?: unknown },
  allowUnreviewed: boolean,
): boolean {
  if (item.status === 'ACTIVE' && isReviewed(item)) return true
  if (allowUnreviewed && item.status === 'ACTIVE' && !isReviewed(item)) return true
  return false
}

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

async function cmdDatasetValidate(allowUnreviewed: boolean): Promise<void> {
  const client = getLangfuse()
  if (!client) {
    console.error('[validate] Langfuse not configured')
    process.exitCode = 1
    return
  }

  const names = registeredDatasets().filter(
    (name) => adapterFor(name).mode !== 'pairwise',
  )

  let hasUnreviewed = false

  console.log('Dataset                             | Reviewed | Unreviewed | Archived')
  console.log('------------------------------------|----------|------------|--------')

  for (const name of names) {
    const { items } = await client.getDataset(name)
    const active = items.filter((i) => i.status === 'ACTIVE')
    const archived = items.filter((i) => i.status === 'ARCHIVED')
    const reviewed = active.filter((i) => isReviewed(i))
    const unreviewed = active.length - reviewed.length

    if (unreviewed > 0) hasUnreviewed = true

    console.log(
      `${name.padEnd(36)}| ${String(reviewed.length).padEnd(9)}| ${String(unreviewed).padEnd(11)}| ${archived.length}`,
    )
  }

  await flushLangfuse()

  if (hasUnreviewed && !allowUnreviewed) {
    console.error('[validate] Unreviewed items found. Pass --allow-unreviewed to proceed.')
    process.exitCode = 1
  }
}

async function cmdDatasetReviewEnqueue(dataset: string): Promise<void> {
  const adapter = adapterFor(dataset)
  const result = await enqueueDataset({
    dataset,
    queueName: 'golden-review',
    reviewView: adapter.reviewView,
  })
  console.log(`[enqueue] ${result.enqueued} items enqueued to queue "${result.queueName}"`)
  await flushLangfuse()
}

async function cmdDatasetReviewPush(
  dataset: string,
  approvedBy: string,
): Promise<void> {
  const result = await applyVerdicts({ dataset, queueName: 'golden-review', approvedBy })
  console.log(
    `[push] processed=${result.processed} pending=${result.pending} ` +
      `(approved=${result.summary.approved} edited=${result.summary.edited} rejected=${result.summary.rejected})`,
  )
  await flushLangfuse()
}

async function cmdRun(
  dataset: string,
  armSpecs: ArmSpec[],
  allowUnreviewed: boolean,
): Promise<void> {
  const adapter = adapterFor(dataset)

  const client = getLangfuse()
  if (!client) {
    console.error('[run] Langfuse not configured')
    process.exitCode = 1
    return
  }

  const { items: rawItems } = await client.getDataset(dataset)

  // Golden items awaiting review are ACTIVE (DEV-1879), so admit only reviewed
  // ones unless --allow-unreviewed — the same gate the products run applies.
  const admitted = rawItems.filter((i) => isAdmittedProductsItem(i, allowUnreviewed))
  const skipped = rawItems.filter((i) => i.status === 'ACTIVE').length - admitted.length
  if (skipped > 0) {
    console.log(`[run] ${skipped} unreviewed item(s) skipped; pass --allow-unreviewed to include them`)
  }

  const items = admitted
    .map((i) => ({
      id: i.id,
      input: i.input,
      expectedOutput: i.expectedOutput,
      humanApproval: (i.metadata as Record<string, unknown>)?.humanApproval as {
        reviewedVia?: { queueId: string; scoreId: string } | string | undefined
        at?: string
      } ?? {},
    }))

  const arms: ExperimentArm[] = armSpecs.map((spec) => {
    if (spec.kind === 'prompt') {
      return {
        name: `prompt-v${spec.version}`,
        type: 'prompt' as const,
        value: `${adapter.promptName}:${spec.version}`,
      }
    }
    return { name: spec.model, type: 'model' as const, value: spec.model }
  })

  const { createScriptExperimentDeps } = await import(
    '@/lib/services/eval/script-experiment-deps'
  )
  const deps = await createScriptExperimentDeps({ adapter, profileKey: adapter.profileKey })

  const result = await runExperiment({
    dataset,
    arms,
    adapter,
    items,
    allowUnreviewed,
    deps,
  })

  console.log(result.markdown)
  if (result.provisional) {
    console.log('\n(provisional — unreviewed items included)')
  }
  console.log(
    `\nSummary: ${result.summary.succeeded}/${result.summary.total} succeeded`,
  )
  process.exitCode = result.exitCode
}

async function cmdDatasetRecord(
  dataset: string,
  brandSlug: string,
  urls?: string[],
): Promise<void> {
  const { writeFileSync, mkdirSync } = await import('node:fs')
  const { createServiceClient } = await import('@/lib/supabase/service')
  const { installSeams, assertNoNewAuditRows } = await import('@/lib/services/eval/zero-write')
  const { toReadPageFetch, buildPoolFromRows, recordPool } = await import(
    '@/lib/services/eval/products-record'
  )
  const { fetchHtmlWithMetadata } = await import(
    '@/lib/services/enrich-phases/scraper/fetch-guards'
  )
  const { readProductPage } = await import(
    '@/lib/services/enrich-phases/products/read-page'
  )
  const { randomUUID } = await import('node:crypto')
  const { runWithAuditContext } = await import('@/lib/audit/context')

  const client = getLangfuse()
  if (!client) {
    console.error('[record] Langfuse not configured')
    process.exitCode = 1
    return
  }

  const supabase = createServiceClient()

  // Look up the brand
  const { data: brand, error: brandError } = await supabase
    .from('brands')
    .select('id, slug, name, purchase_website')
    .eq('slug', brandSlug)
    .single()

  if (brandError || !brand) {
    console.error(`[record] Brand "${brandSlug}" not found: ${brandError?.message ?? 'no data'}`)
    process.exitCode = 1
    return
  }

  // Load candidates from the latest job
  const { data: rows, error: rowsError } = await supabase
    .from('curated_product_candidates')
    .select('job_id, url, title, image_url, supplier, url_class, search_position, created_at')
    .eq('brand_id', brand.id)
    .order('created_at', { ascending: false })

  if (rowsError || !rows || rows.length === 0) {
    console.error(`[record] No candidates for brand "${brandSlug}": ${rowsError?.message ?? 'empty'}`)
    process.exitCode = 1
    return
  }

  const pool = buildPoolFromRows(rows)
  console.log(`[record] Pool: ${pool.length} candidates from latest job`)

  const readPage = async (url: string) => {
    const fetchResult = await fetchHtmlWithMetadata(url)
    const { text, statusCode } = toReadPageFetch(fetchResult)
    return readProductPage(url, {
      fetchHtml: async () => ({ text, statusCode }),
      budget: {
        allowed: { reads: 12, renders: 0, turns: 0, wallClockMs: 60000 },
        used: { reads: 0, renders: 0, turns: 0, wallClockMs: 0 },
      },
    })
  }

  // Install zero-write seams (audit write sink + CURATION_EVAL_SINK) after
  // DB reads so early-return errors don't need restore()
  const since = new Date()
  const runCorrelationId = randomUUID()
  const { collector, restore } = installSeams({
    sinkPath: `scripts/llm-eval/runs/record-${brandSlug}-sink.jsonl`,
  })

  try {
    const body = await runWithAuditContext(
      { correlationId: runCorrelationId },
      () => recordPool({
        brand: {
          id: brand.id,
          slug: brand.slug,
          name: brand.name,
          url: brand.purchase_website ?? undefined,
        },
        pool,
        priorityUrls: [],
        urlsOverride: urls,
        readPage,
        candidateIdFactory: () => randomUUID(),
      }),
    )

    // Ensure dataset exists (create on first use)
    try {
      await client.getDataset(dataset)
    } catch {
      await client.createDataset({ name: dataset, description: 'DEV-1707 frozen product pools' })
    }

    // Write to Langfuse
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await client.createDatasetItem({ datasetName: dataset, ...body } as any)
    await flushLangfuse()

    // Assert zero writes — scoped to this run's own identity
    await assertNoNewAuditRows({
      since,
      correlationIds: [runCorrelationId],
      spanIds: collector.all().map((r) => r.spanId),
    })

    // Dump run JSON
    const runJsonPath = `scripts/llm-eval/runs/record-${brandSlug}.json`
    mkdirSync('scripts/llm-eval/runs', { recursive: true })
    writeFileSync(runJsonPath, JSON.stringify(body, null, 2))

    console.log(`[record] Item "${body.id}" written to dataset "${dataset}"`)
    console.log(`[record] Run JSON: ${runJsonPath}`)
  } finally {
    restore()
  }
}

async function cmdDatasetPrelabel(
  dataset: string,
  itemId: string,
  filePath: string,
): Promise<void> {
  const { readFileSync } = await import('node:fs')
  const { prelabelItem } = await import('@/lib/services/eval/golden-review')

  const expectedOutput = JSON.parse(readFileSync(filePath, 'utf8'))

  await prelabelItem({
    dataset,
    itemId,
    expectedOutput,
    prelabel: {
      author: 'cli',
      method: 'file-import',
      status: 'prelabeled',
    },
    boundaryTags: [],
  })

  await flushLangfuse()
  console.log(`[prelabel] Item "${itemId}" prelabeled in dataset "${dataset}"`)
}

// ---------------------------------------------------------------------------
// Golden capture / harvest (DEV-1873)
// ---------------------------------------------------------------------------

/** Parallel version reads per prompt; prompts run one after another. */
const VERSION_FETCH_CONCURRENCY = 5

/**
 * Every known resolved text per golden prompt, for classifying a call by its
 * system message. Harvest also needs older versions: stored rows carry the
 * version that ran then, not the current one.
 */
async function resolveGoldenPromptTexts({
  allVersions,
}: {
  allVersions: boolean
}): Promise<PromptTexts> {
  const { GOLDEN_PROMPTS, GOLDEN_DATASETS } = await import('@/lib/services/eval/golden-capture')
  const { fetchLangfusePromptWithMeta } = await import('@/lib/langfuse/prompt')
  const client = getLangfuse()
  const texts = {} as Record<(typeof GOLDEN_PROMPTS)[number], string[]>

  for (const name of GOLDEN_PROMPTS) {
    // The same variables production compiles into the prompt (the adapter owns them).
    const variables = adapterFor(GOLDEN_DATASETS[name]).variables
    const known = new Set<string>([(await fetchLangfusePromptWithMeta(name, variables)).text])
    if (allVersions && client) {
      try {
        const latest = await client.getPrompt(name, undefined, { label: 'latest' })
        const versions: (typeof latest | null)[] = [latest]
        // `latest` is already in hand, so only the older versions are read.
        const older = Array.from({ length: latest.version - 1 }, (_, index) => index + 1)
        for (let start = 0; start < older.length; start += VERSION_FETCH_CONCURRENCY) {
          versions.push(
            ...(await Promise.all(
              older.slice(start, start + VERSION_FETCH_CONCURRENCY).map((version) =>
                // A deleted version: nothing to match against.
                client.getPrompt(name, version).catch(() => null),
              ),
            )),
          )
        }
        for (const prompt of versions) {
          if (!prompt || typeof prompt.prompt !== 'string') continue
          known.add(variables ? (prompt.compile(variables) as string) : prompt.prompt)
        }
      } catch (error) {
        console.warn(`[harvest] could not list versions of "${name}"; matching the current text only:`, error)
      }
    }
    texts[name] = [...known]
  }
  return texts
}

/**
 * The Langfuse public-API calls `writeGoldenItems` makes. Each rejects with an
 * object carrying the HTTP `status` (the SDK's `client.api.*` client throws its
 * Response), which is how a 404 is told apart from a 429 or an outage.
 */
export type GoldenWriteApi = {
  getDataset: (name: string) => Promise<unknown>
  createDataset: (body: { name: string; description: string }) => Promise<unknown>
  getItem: (id: string) => Promise<unknown>
  createItem: (item: GoldenWriteBody) => Promise<unknown>
}

/** A dataset-item upsert: a fresh golden item, or a stored one re-written ACTIVE. */
export type GoldenWriteBody = {
  datasetName: string
  id: string
  input: unknown
  expectedOutput: unknown
  status: 'ACTIVE'
  metadata: unknown
}

/**
 * A stored item written before DEV-1879: ARCHIVED while still pending, so the
 * dataset listing hid it from prelabel, enqueue and validate. Rejected
 * (ARCHIVED, status rejected) and reviewed (reviewedVia set) items never match.
 */
function isArchivedPending(stored: unknown): stored is { input?: unknown; expectedOutput?: unknown; metadata?: unknown } {
  const record = stored as { status?: unknown; metadata?: unknown } | null
  if (record?.status !== 'ARCHIVED') return false
  const approval = (record.metadata as { humanApproval?: { status?: unknown; reviewedVia?: unknown } } | null)
    ?.humanApproval
  return approval?.status === 'pending' && approval.reviewedVia == null
}

function langfuseGoldenWriteApi(): GoldenWriteApi {
  const client = getLangfuse()
  if (!client) throw new Error('Langfuse not configured')
  return {
    getDataset: (name) => client.api.datasetsGet(name),
    createDataset: (body) => client.api.datasetsCreate(body),
    getItem: (id) => client.api.datasetItemsGet(id),
    createItem: (item) => client.api.datasetItemsCreate(item),
  }
}

function httpStatusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status
  return typeof status === 'number' ? status : undefined
}

/**
 * Writes items ACTIVE and pending, skipping ids Langfuse already holds:
 * re-writing one would reset a reviewed or rejected item to pending. The one
 * exception is an ARCHIVED item still pending review (written before
 * DEV-1879): it is re-written ACTIVE with its stored input, expectedOutput and
 * metadata, so a prelabel survives, and counted in `reactivated`.
 *
 * Existence is read per id (`GET /dataset-items/<id>`), never from the dataset
 * listing — the listing omits ARCHIVED items, which is every rejected and
 * every pre-DEV-1879 pending golden item. Only a 404 means "absent"; any other
 * failure aborts the write rather than being mistaken for it.
 *
 * Calls are paced `minIntervalMs` apart (default 700ms, ~85/min, under the
 * 100/min Langfuse Cloud limit). A 429, or a create that resolves without the
 * item's id, is retried with exponential backoff; a create still unconfirmed
 * after `retries` attempts is reported in `failed`, not counted as written.
 * Ceiling: two calls per item, so ~40 items a minute. Upgrade path: list the
 * ACTIVE ids once and look up only the rest, or batch through the ingestion API.
 */
export async function writeGoldenItems(
  items: GoldenItemBody[],
  {
    api = langfuseGoldenWriteApi(),
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
    minIntervalMs = 700,
    retries = 4,
    backoffMs = 10_000,
  }: {
    api?: GoldenWriteApi
    sleep?: (ms: number) => Promise<void>
    now?: () => number
    minIntervalMs?: number
    retries?: number
    backoffMs?: number
  } = {},
): Promise<{ written: number; reactivated: number; existing: number; failed: string[] }> {
  let lastCall: number | null = null
  const paced = async <T>(call: () => Promise<T>): Promise<T> => {
    if (lastCall !== null) {
      const wait = lastCall + minIntervalMs - now()
      if (wait > 0) await sleep(wait)
    }
    lastCall = now()
    return call()
  }
  /** Retries a 429; `undefined` from `call` also means "retry". Other errors propagate. */
  const withRetry = async <T>(call: () => Promise<T | undefined>): Promise<T | undefined> => {
    for (let attempt = 1; ; attempt++) {
      try {
        const result = await paced(call)
        if (result !== undefined) return result
      } catch (error) {
        if (httpStatusOf(error) !== 429) throw error
      }
      if (attempt >= retries) return undefined
      await sleep(backoffMs * 2 ** (attempt - 1))
    }
  }
  const orThrow = <T>(value: T | undefined, what: string): T => {
    if (value === undefined) throw new Error(`[golden] ${what}: still rate-limited after ${retries} attempts`)
    return value
  }

  let written = 0
  let reactivated = 0
  let existing = 0
  const failed: string[] = []
  /** Creates `body` through the paced, retried path; true only when Langfuse confirms the id. */
  const confirmedWrite = async (body: GoldenWriteBody): Promise<boolean> =>
    (await withRetry(async () => {
      const response = (await api.createItem(body)) as { id?: unknown } | null
      return response?.id === body.id ? true : undefined
    })) === true
  for (const dataset of [...new Set(items.map((item) => item.datasetName))]) {
    const found = await withRetry(async () => {
      try {
        await api.getDataset(dataset)
        return true
      } catch (error) {
        if (httpStatusOf(error) === 404) return false
        throw error
      }
    })
    if (!orThrow(found, `reading dataset "${dataset}"`)) {
      orThrow(
        await withRetry(async () => {
          await api.createDataset({ name: dataset, description: 'DEV-1873 golden set' })
          return true
        }),
        `creating dataset "${dataset}"`,
      )
    }

    for (const item of items.filter((i) => i.datasetName === dataset)) {
      const lookup = orThrow(
        await withRetry(async () => {
          try {
            return { present: true, stored: await api.getItem(item.id) }
          } catch (error) {
            if (httpStatusOf(error) === 404) return { present: false, stored: null }
            throw error
          }
        }),
        `looking up item "${item.id}"`,
      )
      if (lookup.present && isArchivedPending(lookup.stored)) {
        const { input, expectedOutput, metadata } = lookup.stored
        const body = { datasetName: dataset, id: item.id, input, expectedOutput, status: 'ACTIVE' as const, metadata }
        if (await confirmedWrite(body)) reactivated += 1
        else failed.push(item.id)
        continue
      }
      if (lookup.present) {
        existing += 1
        continue
      }
      if (await confirmedWrite(item)) written += 1
      else failed.push(item.id)
    }
  }
  return { written, reactivated, existing, failed }
}

function reportFailedWrites(tag: string, failed: string[]): void {
  if (failed.length === 0) return
  console.error(`[${tag}] ${failed.length} item(s) not confirmed written: ${failed.join(', ')}`)
  process.exitCode = 1
}

/**
 * A PostgREST embed as one row. supabase-js types an embedded relation as an
 * array even when the foreign key makes it many-to-one (an object at runtime),
 * so both shapes are accepted.
 */
function embedOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

/** Refuses production unless `--target production --confirm` were both given. */
function assertGoldenTarget(target: string, confirm: boolean): void {
  assertCensusTarget({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    target,
    confirmed: confirm,
  })
}

async function cmdDatasetHarvest(
  dataset: string,
  target: string,
  confirm: boolean,
  since?: string,
  limit?: number,
): Promise<void> {
  assertGoldenTarget(target, confirm)
  const { createServiceClient } = await import('@/lib/supabase/service')
  const { GOLDEN_PROMPT_PHASES, GOLDEN_PROMPTS, classifyCapturedCall, harvestRowsToItems } =
    await import('@/lib/services/eval/golden-capture')

  if (!getLangfuse()) {
    console.error('[harvest] Langfuse not configured')
    process.exitCode = 1
    return
  }
  const prompt = promptForDataset(dataset)!
  const texts = await resolveGoldenPromptTexts({ allVersions: true })
  const supabase = createServiceClient()
  const toItems = (from: HarvestRow[]) =>
    harvestRowsToItems(from, { prompt, texts, ...(since ? { since } : {}) })

  // Read-only. Paged until an empty page: PostgREST caps a page (1,000 rows by
  // default, possibly lower), so a short page is not proof of the end.
  // Rows arrive newest first, so a --limit stops paging once it is met.
  const PAGE = 1000
  const rows: HarvestRow[] = []
  for (let from = 0; ; ) {
    let query = supabase
      .from('brand_ai_results')
      .select('created_at, job_id, input, brands(slug), brand_submissions(brands(slug))')
      .in('phase', [...GOLDEN_PROMPT_PHASES[prompt]])
      .not('input', 'is', null)
    if (since) query = query.gte('created_at', new Date(since).toISOString())
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`[harvest] brand_ai_results read failed: ${error.message}`)
    const page = data ?? []
    if (page.length === 0) break
    for (const row of page) {
      const submission = embedOne(row.brand_submissions)
      rows.push({
        created_at: row.created_at,
        job_id: row.job_id,
        input: row.input,
        brand_slug: embedOne(row.brands)?.slug ?? embedOne(submission?.brands)?.slug ?? null,
      })
    }
    from += page.length
    if (limit !== undefined && toItems(rows).length >= limit) break
  }

  // Why rows did not become items. Historical rows are matched against every
  // prompt version compiled with TODAY's variables, so a version whose
  // variables have since changed lands in `unclassified`.
  const tally: Record<string, number> = { malformed: 0, unclassified: 0 }
  for (const name of GOLDEN_PROMPTS) tally[name] = 0
  for (const row of rows) {
    const input = row.input as { system?: unknown; user?: unknown } | null
    if (typeof input?.system !== 'string' || typeof input.user !== 'string') {
      tally.malformed += 1
      continue
    }
    tally[classifyCapturedCall({ system: input.system }, texts) ?? 'unclassified'] += 1
  }

  const all = toItems(rows)
  // Items come back oldest first; a limit keeps the newest.
  const items = limit !== undefined ? all.slice(-limit) : all
  const { written, reactivated, existing, failed } = await writeGoldenItems(items)
  await flushLangfuse()
  console.log(
    `[harvest] ${dataset}: ${rows.length} rows read — ` +
      Object.entries(tally)
        .map(([reason, count]) => `${reason} ${count}`)
        .join(', '),
  )
  console.log(
    `[harvest] ${dataset}: ${all.length} usable (after dedupe), ${items.length} selected, ` +
      `${written} written (ACTIVE, pending review), ${reactivated} reactivated, ${existing} already present, ` +
      `${failed.length} failed`,
  )
  reportFailedWrites('harvest', failed)
}

async function cmdDatasetCapture(
  brandSlugs: string[],
  target: string,
  confirm: boolean,
  datasets?: string[],
): Promise<void> {
  assertGoldenTarget(target, confirm)
  const { createServiceClient } = await import('@/lib/supabase/service')
  const { installSeams, assertNoNewAuditRows } = await import('@/lib/services/eval/zero-write')
  const { setChatCaptureSeam } = await import('@/lib/services/llm-audit')
  const { runWithAuditContext } = await import('@/lib/audit/context')
  const { runAcquirePhase } = await import('@/lib/services/enrich-phases/acquire')
  const { runProductsPhase } = await import('@/lib/services/enrich-phases/products')
  const { loadCachedSearchResults } = await import('@/lib/services/enrich-phases/discover')
  const { searchBrandUrls, batchSearchBrandImages } = await import(
    '@/lib/services/enrich-phases/scraper/search'
  )
  const { collectKnownUrls, uniqueUrls } = await import('@/lib/services/curation-operations')
  const { GOLDEN_DATASETS, capturedCallsToItems } = await import('@/lib/services/eval/golden-capture')

  if (!getLangfuse()) {
    console.error('[capture] Langfuse not configured')
    process.exitCode = 1
    return
  }
  // products-repair never runs here (PRODUCTS_AGENT is forced off below), so
  // it is not a default; its items come from `dataset harvest`.
  const repairDataset = GOLDEN_DATASETS['products-repair']
  if (datasets?.includes(repairDataset)) {
    console.warn(
      `[capture] warning: capture never calls products-repair; "${repairDataset}" items come from \`dataset harvest\``,
    )
  }
  const selected = datasets ?? Object.values(GOLDEN_DATASETS).filter((d) => d !== repairDataset)
  const prompts = selected.map((d) => promptForDataset(d)!)
  const texts = await resolveGoldenPromptTexts({ allVersions: false })
  const supabase = createServiceClient()

  // Brand reads happen before the seams go in, so an early return needs no restore().
  const { data: brandRows, error: brandError } = await supabase
    .from('brands')
    .select('*')
    .in('slug', brandSlugs)
  if (brandError) throw new Error(`[capture] brands read failed: ${brandError.message}`)
  const bySlug = new Map((brandRows ?? []).map((row) => [row.slug, row as EnrichBrand]))
  const brands: EnrichBrand[] = []
  for (const slug of brandSlugs) {
    const brand = bySlug.get(slug)
    if (brand) brands.push(brand)
    else console.error(`[capture] Brand "${slug}" not found`)
  }
  if (brands.length === 0) {
    process.exitCode = 1
    return
  }
  const cachedSearches = await loadCachedSearchResults(
    brands.map((brand) => brand.id),
    'brand',
  )

  const phases: EnrichPhase[] = ['acquire', 'products']
  // No candidate row may be written; the products phase persists its pool even on a dry run.
  const noCandidateWrites = { insert: async () => ({ data: null, error: null }) }
  // Every zero-write count is scoped by this run's own correlation, span and
  // synthetic submission ids, so the time bound is only a secondary filter. It
  // is backdated 5 minutes so a local clock running ahead of the database's
  // `created_at` cannot hide a leaked row.
  const since = new Date(Date.now() - 5 * 60_000)
  const correlationIds: string[] = []
  const submissionIds: string[] = []
  const captured: TimedCapturedCall[] = []
  const items: GoldenItemBody[] = []
  const previousProductsAgent = process.env.PRODUCTS_AGENT
  const { collector, restore } = installSeams({
    sinkPath: 'scripts/llm-eval/runs/capture-sink.jsonl',
  })

  try {
    // The single-call products body only runs with the agent off.
    process.env.PRODUCTS_AGENT = 'off'
    setChatCaptureSeam((call) => {
      captured.push({ ...call, capturedAt: new Date().toISOString() })
    })

    for (const brand of brands) {
      const correlationId = randomUUID()
      correlationIds.push(correlationId)
      // A synthetic submission: the products phase runs only for submission
      // targets, and any row that did escape would fail its foreign key
      // instead of attaching to a real submission.
      const target = { type: 'submission' as const, id: randomUUID() }
      submissionIds.push(target.id)
      // Same derivation as curation-operations' acquire step.
      const knownUrls = collectKnownUrls(brand)
      const discoveredUrls = uniqueUrls(
        (cachedSearches.get(brand.id)?.urls ?? []).filter((url) => !knownUrls.includes(url)),
      )

      try {
        await runWithAuditContext({ correlationId }, async () => {
          // Known divergences from curation-operations' acquire call (a
          // deliberate shortcut): no renderProvider (JS-only pages are not
          // rendered, so the agent sees less than production), no jobId
          // (nothing joins to a job), no linkExpansion (the pre-acquire
          // expansion step is not run) and no budgetScale (production sets it
          // only on reruns, so a first run matches). Ceiling: captured inputs
          // for render-dependent brands differ from production's. Upgrade
          // path: extract curation-operations' per-brand acquire setup into a
          // shared builder and call it here.
          const acquire = await runAcquirePhase({
            brand,
            phases,
            discoveredUrls,
            knownUrls,
            dryRun: true,
            target,
            // A dry run still writes search-audit rows; the synthetic target
            // would fail their foreign key and abort the phase. The searches
            // run unaudited and the scrape audit is a no-op.
            deps: {
              startSearchAudit: async () => 'capture-no-audit',
              finishSearchAudit: async () => {},
              searchBrandUrls: (query, template) => searchBrandUrls(query, template),
              batchSearchBrandImages: (inputs, concurrency, template) =>
                batchSearchBrandImages(inputs, concurrency, template),
            },
          })
          await runProductsPhase({
            brand,
            phases,
            scrapedData: acquire.scrapedData,
            dryRun: true,
            target,
            imagePool: acquire.imagePool,
            catalogResult: acquire.catalogResult,
            acquisitionPageUrls: acquire.acquisitionPageUrls,
            priorityProductUrls: acquire.priorityProductUrls,
            candidateWriter: noCandidateWrites,
          })
        })
      } catch (error) {
        console.error(
          `[capture] ${brand.slug}: phase run failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }

      const brandItems = capturedCallsToItems(captured.splice(0), {
        brandSlug: brand.slug,
        jobId: correlationId,
        texts,
        prompts,
      })
      items.push(...brandItems)
      console.log(`[capture] ${brand.slug}: ${brandItems.length} items`)
    }

    // Before any item leaves the process: a run that leaked a row writes nothing.
    await assertNoNewAuditRows({
      since,
      correlationIds,
      spanIds: collector.all().map((r) => r.spanId),
      submissionIds,
    })

    const { written, reactivated, existing, failed } = await writeGoldenItems(items)
    await flushLangfuse()

    for (const dataset of selected) {
      const count = items.filter((item) => item.datasetName === dataset).length
      console.log(`[capture] ${dataset}: ${count} items`)
    }
    console.log(
      `[capture] ${written} items written (ACTIVE, pending review), ${reactivated} reactivated, ` +
      `${existing} already present, ${failed.length} failed`,
    )
    reportFailedWrites('capture', failed)
  } finally {
    setChatCaptureSeam(null)
    restore()
    if (previousProductsAgent === undefined) delete process.env.PRODUCTS_AGENT
    else process.env.PRODUCTS_AGENT = previousProductsAgent
  }
}

async function cmdPairwiseRun(
  phase: string,
  _target: string,
  sample: number,
  armSpecs: ArmSpec[],
  noEnqueue: boolean = false,
  allowUnreviewed: boolean = false,
): Promise<void> {
  if (phase === 'products') {
    return cmdPairwiseRunProducts(armSpecs, noEnqueue, sample, allowUnreviewed)
  }

  const { writeFileSync, mkdirSync } = await import('node:fs')
  const { createServiceClient } = await import('@/lib/supabase/service')
  const { stratifiedSample, blind } = await import(
    '@/lib/services/eval/pairwise'
  )
  const { findQueueByName, enqueueTrace } = await import(
    '@/lib/services/eval/langfuse-runs'
  )
  const { rewriteBrandDescription } = await import(
    '@/lib/services/description-rewrite'
  )
  const { loadPersistedScrapeText, buildDescriptionEvidence } = await import(
    '@/lib/services/enrich-phases/descriptions'
  )

  if (armSpecs.length !== 2) {
    console.error('Pairwise run requires exactly 2 arms')
    process.exitCode = 1
    return
  }

  let queueId: string | undefined
  if (!noEnqueue) {
    queueId = await findQueueByName({ name: 'pairwise' })
    console.log(`Pairwise queue: ${queueId}`)
  }

  const supabase = createServiceClient()
  const { data: allBrands } = await supabase
    .from('brands')
    .select('id, name, category, slug, description, purchase_website, social_instagram, social_threads, social_facebook, purchase_pinkoi')
    .eq('status', 'approved')

  if (!allBrands || allBrands.length === 0) {
    console.error('No approved brands found')
    process.exitCode = 1
    return
  }

  const sampled = stratifiedSample({ brands: allBrands, n: sample })
  console.log(`Sampled ${sampled.length} brands across ${new Set(sampled.map(b => b.category)).size} categories`)

  const armOutputs = new Map<string, Map<string, unknown>>()
  const armLabels: string[] = []

  for (const arm of armSpecs) {
    let label: string
    if (arm.kind === 'prompt') {
      label = `prompt-v${arm.version}`
    } else if (arm.kind === 'model') {
      label = arm.model
    } else {
      throw new Error(`Unknown arm kind: ${(arm as { kind: string }).kind}`)
    }
    armLabels.push(label)
    const outputs = new Map<string, unknown>()

    const savedVersions = process.env.LANGFUSE_PROMPT_VERSIONS
    const savedModel = process.env.OPENAI_MODEL_OVERRIDE
    try {
      if (arm.kind === 'prompt') {
        process.env.LANGFUSE_PROMPT_VERSIONS = `descriptions:${arm.version}`
      } else if (arm.kind === 'model') {
        process.env.OPENAI_MODEL_OVERRIDE = arm.model
      } else {
        throw new Error(`Unknown arm kind: ${(arm as { kind: string }).kind}`)
      }

      console.log(`\nRunning arm "${label}" on ${sampled.length} brands...`)
      for (const brand of sampled) {
        try {
          const scrapeText = await loadPersistedScrapeText(brand.id)
          const evidence = buildDescriptionEvidence(
            brand as Parameters<typeof buildDescriptionEvidence>[0],
            undefined,
            [],
          )
          const result = await rewriteBrandDescription(
            brand.name,
            brand.description,
            scrapeText.snippets,
            scrapeText.siteContent,
            { jobId: undefined, target: undefined },
            evidence,
          )
          outputs.set(brand.id, result)
          process.stdout.write('.')
        } catch (err) {
          console.error(`\nFailed for ${brand.slug}:`, (err as Error).message)
          outputs.set(brand.id, null)
        }
      }
      console.log(` done (${outputs.size} brands)`)
    } finally {
      if (savedVersions !== undefined) process.env.LANGFUSE_PROMPT_VERSIONS = savedVersions
      else delete process.env.LANGFUSE_PROMPT_VERSIONS
      if (savedModel !== undefined) process.env.OPENAI_MODEL_OVERRIDE = savedModel
      else delete process.env.OPENAI_MODEL_OVERRIDE
    }

    armOutputs.set(label, outputs)
  }

  const client = getLangfuse()
  if (!client) {
    console.error('Langfuse not configured')
    process.exitCode = 1
    return
  }

  const mappings: Record<string, { left: 'a' | 'b'; right: 'a' | 'b' }> = {}
  const traceIds: string[] = []
  const [armA, armB] = armLabels

  console.log('\nBlinding and enqueueing traces...')
  for (const brand of sampled) {
    const outputA = armOutputs.get(armA)?.get(brand.id)
    const outputB = armOutputs.get(armB)?.get(brand.id)

    if (!outputA || !outputB) {
      console.log(`Skipping ${brand.slug} — missing output from one arm`)
      continue
    }

    const blinded = blind(outputA, outputB)
    const trace = client.trace({
      name: `pairwise:descriptions:${brand.slug}`,
      input: { left: blinded.left, right: blinded.right, brandName: brand.name },
      metadata: { brandId: brand.id, brandSlug: brand.slug, armA, armB },
    })

    mappings[trace.id] = blinded.mapping
    traceIds.push(trace.id)
    if (!noEnqueue && queueId) {
      await enqueueTrace({ queueId, traceId: trace.id })
    }
  }

  const iso = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
  const runFileName = `pairwise-descriptions-${iso}`
  const runJsonPath = `scripts/llm-eval/runs/${runFileName}.json`
  mkdirSync('scripts/llm-eval/runs', { recursive: true })
  writeFileSync(
    runJsonPath,
    JSON.stringify({ dataset: 'pairwise-descriptions', mappings, traceIds, armA, armB }, null, 2),
  )

  await flushLangfuse()

  console.log(`\n${traceIds.length} items ${noEnqueue ? 'traced' : 'enqueued'} to pairwise queue`)
  console.log(`Run JSON: ${runJsonPath}`)
  console.log(`Arms: A=${armA}, B=${armB}`)
  console.log('Vote in Langfuse, then run: pnpm llm-eval pairwise report ' + runFileName)
}

async function cmdPairwiseRunProducts(
  armSpecs: ArmSpec[],
  noEnqueue: boolean,
  sample: number = 0,
  allowUnreviewed: boolean = false,
): Promise<void> {
  const { writeFileSync, mkdirSync } = await import('node:fs')
  const { buildProductPairs } = await import('@/lib/services/eval/pairwise')
  const { productsTask } = await import('@/lib/services/eval/products-replay')
  const { createAgentModel } = await import(
    '@/lib/services/enrich-phases/agents/runtime'
  )
  const { runProductsAgent } = await import(
    '@/lib/services/enrich-phases/products/graph'
  )
  const { findQueueByName, enqueueTrace } = await import(
    '@/lib/services/eval/langfuse-runs'
  )
  const { installSeams, assertNoNewAuditRows } = await import(
    '@/lib/services/eval/zero-write'
  )
  const { runWithAuditContext } = await import('@/lib/audit/context')
  if (armSpecs.length !== 2) {
    console.error('Pairwise run requires exactly 2 arms')
    process.exitCode = 1
    return
  }

  const client = getLangfuse()
  if (!client) {
    console.error('Langfuse not configured')
    process.exitCode = 1
    return
  }

  let queueId: string | undefined
  if (!noEnqueue) {
    queueId = await findQueueByName({ name: 'pairwise' })
    console.log(`Pairwise queue: ${queueId}`)
  }

  // Load items from the products dataset (optionally including pending unreviewed)
  const datasetName = 'products-agent-ranking-golden'
  const { items: rawItems } = await client.getDataset(datasetName)
  const items = rawItems.filter((i) => isAdmittedProductsItem(i, allowUnreviewed))

  if (items.length === 0) {
    console.error('No ACTIVE+reviewed items found in products dataset')
    process.exitCode = 1
    return
  }

  const selectedItems = sample > 0 ? items.slice(0, sample) : items
  console.log(`[products] ${selectedItems.length} ACTIVE+reviewed items loaded${sample > 0 ? ` (sampled from ${items.length})` : ''}`)

  const since = new Date()
  const { collector, restore } = installSeams({
    sinkPath: 'scripts/llm-eval/runs/pairwise-products-eval-sink.jsonl',
  })

  const runCorrelationIds: string[] = []
  const task = productsTask({ createAgentModel, runProductsAgent })
  const armLabels = armSpecs.map((arm) => {
    if (arm.kind === 'prompt') return `prompt-v${arm.version}`
    if (arm.kind === 'model') return arm.model
    throw new Error(`Unknown arm kind: ${(arm as { kind: string }).kind}`)
  })
  const [armA, armB] = armLabels

  async function runArmTask(
    armSpec: ArmSpec,
    item: { id: string; input: unknown; expectedOutput: unknown },
    taskFn: typeof task,
    armLabel: string,
    armSuffix: string,
  ): Promise<ProductsReplayOutput | null> {
    const savedVersions = process.env.LANGFUSE_PROMPT_VERSIONS
    const savedModel = process.env.OPENAI_MODEL_OVERRIDE
    const itemRunId = randomUUID()
    runCorrelationIds.push(itemRunId)
    try {
      if (armSpec.kind === 'prompt') {
        process.env.LANGFUSE_PROMPT_VERSIONS = `products-propose:${armSpec.version}`
      } else if (armSpec.kind === 'model') {
        process.env.OPENAI_MODEL_OVERRIDE = armSpec.model
      } else {
        throw new Error(`Unknown arm kind: ${(armSpec as { kind: string }).kind}`)
      }
      const result = await runWithAuditContext(
        { correlationId: itemRunId },
        () => taskFn(
          { id: item.id, input: item.input, expectedOutput: item.expectedOutput, humanApproval: {} },
          { name: armLabel, type: armSpec.kind, value: armSpec.kind === 'prompt' ? `products-propose:${armSpec.version}` : armSpec.model },
          { itemRunId },
        ),
      )
      if (result.ok) return result.output as ProductsReplayOutput
      console.error(`  Arm ${armSuffix.toUpperCase()} failed: ${result.error}`)
      return null
    } finally {
      if (savedVersions !== undefined) process.env.LANGFUSE_PROMPT_VERSIONS = savedVersions
      else delete process.env.LANGFUSE_PROMPT_VERSIONS
      if (savedModel !== undefined) process.env.OPENAI_MODEL_OVERRIDE = savedModel
      else delete process.env.OPENAI_MODEL_OVERRIDE
    }
  }

  const mappings: Record<string, { left: 'a' | 'b'; right: 'a' | 'b' }> = {}
  const traceIds: string[] = []
  const driftAgg = { pools: 0, paired: 0, onlyA: 0, onlyB: 0 }

  try {
    for (const item of selectedItems) {
      const input = item.input as { brand?: { slug?: string; name?: string }; evidence?: Record<string, { title: string | null }> }
      const slug = input.brand?.slug ?? 'unknown'

      console.log(`\nProcessing ${slug}...`)

      const experimentItem = { id: item.id, input: item.input ?? {}, expectedOutput: item.expectedOutput ?? {} }
      const outputA = await runArmTask(armSpecs[0]!, experimentItem, task, armLabels[0]!, 'a')
      const outputB = await runArmTask(armSpecs[1]!, experimentItem, task, armLabels[1]!, 'b')

      if (!outputA || !outputB) {
        console.log(`  Skipping ${slug} — missing output from one arm`)
        continue
      }

      const evidenceByUrl = new Map(
        Object.entries(input.evidence ?? {}).map(([url, ev]) => [url, { title: ev.title }]),
      )

      const pairResult = buildProductPairs(
        outputA as Parameters<typeof buildProductPairs>[0],
        outputB as Parameters<typeof buildProductPairs>[1],
        { slug, name: input.brand?.name ?? slug },
        evidenceByUrl,
      )

      driftAgg.pools += pairResult.drift.pools
      driftAgg.paired += pairResult.drift.paired
      driftAgg.onlyA += pairResult.drift.onlyA
      driftAgg.onlyB += pairResult.drift.onlyB

      // Enqueue each pair as a trace
      for (let n = 0; n < pairResult.pairs.length; n++) {
        const pair = pairResult.pairs[n]!
        const mapping = pairResult.mappings[n]!

        const trace = client.trace({
          name: `pairwise:products:${slug}:${n}`,
          input: pair.input,
          output: pair.output,
          metadata: { brandSlug: slug, armA, armB },
        })

        mappings[trace.id] = mapping
        traceIds.push(trace.id)

        if (!noEnqueue && queueId) {
          await enqueueTrace({ queueId, traceId: trace.id })
        }
      }

      console.log(`  ${pairResult.pairs.length} pairs, drift: ${pairResult.drift.rate.toFixed(2)}`)
    }
  } finally {
    restore()
  }

  await assertNoNewAuditRows({
    since,
    correlationIds: runCorrelationIds,
    spanIds: collector.all().map((r) => r.spanId),
  })

  const driftOutput = {
    pools: driftAgg.pools,
    paired: driftAgg.paired,
    onlyA: driftAgg.onlyA,
    onlyB: driftAgg.onlyB,
    rate: driftRate(driftAgg.paired, driftAgg.onlyA, driftAgg.onlyB),
  }

  const iso = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
  const runFileName = `pairwise-products-${iso}`
  const runJsonPath = `scripts/llm-eval/runs/${runFileName}.json`
  mkdirSync('scripts/llm-eval/runs', { recursive: true })
  writeFileSync(
    runJsonPath,
    JSON.stringify({
      dataset: 'pairwise-products',
      mappings,
      traceIds,
      armA,
      armB,
      drift: driftOutput,
      provisional: allowUnreviewed,
    }, null, 2),
  )

  await flushLangfuse()

  console.log(`\n${traceIds.length} pairs ${noEnqueue ? 'traced' : 'enqueued'}`)
  console.log(`Drift: paired=${driftOutput.paired} onlyA=${driftOutput.onlyA} onlyB=${driftOutput.onlyB} rate=${driftOutput.rate.toFixed(2)}`)
  console.log(`Run JSON: ${runJsonPath}`)
  console.log(`Arms: A=${armA}, B=${armB}`)
  console.log('Vote in Langfuse, then run: pnpm llm-eval pairwise report ' + runFileName)
}

async function cmdPairwiseReport(runName: string): Promise<void> {
  const { readFileSync } = await import('node:fs')
  const { pairwiseReport } = await import('@/lib/services/eval/pairwise')
  const { listQueueScores } = await import('@/lib/services/eval/langfuse-runs')

  const runJsonPath = `scripts/llm-eval/runs/${runName}.json`
  const runJson = JSON.parse(readFileSync(runJsonPath, 'utf8'))

  const scores = await listQueueScores({ name: 'preference' })
  const result = pairwiseReport({ runJson, scores })

  console.log(`Win rate: A=${result.aWins} (${(result.aWinRate * 100).toFixed(1)}%), B=${result.bWins} (${(result.bWinRate * 100).toFixed(1)}%), Tie=${result.ties}, Pending=${result.pending}`)

  // Print drift if present in run JSON
  if (runJson.drift) {
    const d = runJson.drift as { paired: number; onlyA: number; onlyB: number; rate: number }
    console.log(`Drift: paired=${d.paired} onlyA=${d.onlyA} onlyB=${d.onlyB} rate=${(d.rate * 100).toFixed(1)}%`)
  }

  if (runJson.provisional) {
    console.log('(provisional — unreviewed items included)')
    console.log('(selection drift includes the new description verify checks on both arms — not comparable to the DEV-1695 split rule)')
  }
}

async function cmdPromptPush(name: string, file?: string, label?: string): Promise<void> {
  await handlePromptPush({ name, file, label })
  await flushLangfuse()
}

async function cmdPromptPull(add: string[], check: boolean, allowVariableChange: boolean): Promise<void> {
  const exitCode = await handlePromptPull({ add, check, allowVariableChange })
  await flushLangfuse()
  process.exitCode = exitCode
}

async function cmdPromptPromote(name: string, version: number, allowVariableChange: boolean): Promise<void> {
  const exitCode = await handlePromptPromote({ name, version, allowVariableChange })
  await flushLangfuse()
  process.exitCode = exitCode
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const rawArgs = process.argv.slice(2)

  // Apply --env-file BEFORE loadScriptTarget so the scratch file's values
  // take precedence (loadScriptTarget also uses override: false).
  const envFile = extractEnvFile(rawArgs)
  if (envFile) {
    applyEnvFile(envFile)
  }

  const { target, argv: remainingArgv } = loadScriptTarget()
  const parsed = parseCliArgs(remainingArgv)

  switch (parsed.command) {
    case 'dataset-validate':
      await cmdDatasetValidate(parsed.allowUnreviewed)
      break
    case 'dataset-record':
      await cmdDatasetRecord(parsed.dataset, parsed.brand, parsed.urls)
      break
    case 'dataset-prelabel':
      await cmdDatasetPrelabel(parsed.dataset, parsed.item, parsed.file)
      break
    case 'dataset-harvest':
      await cmdDatasetHarvest(parsed.dataset, target, parsed.confirm, parsed.since, parsed.limit)
      break
    case 'dataset-capture':
      await cmdDatasetCapture(parsed.brands, target, parsed.confirm, parsed.datasets)
      break
    case 'dataset-review-enqueue':
      await cmdDatasetReviewEnqueue(parsed.dataset)
      break
    case 'dataset-review-push':
      await cmdDatasetReviewPush(parsed.dataset, parsed.approvedBy)
      break
    case 'run':
      await cmdRun(parsed.dataset, parsed.arms, parsed.allowUnreviewed)
      break
    case 'prompt-push':
      await cmdPromptPush(parsed.name, parsed.file, parsed.label)
      break
    case 'prompt-pull':
      await cmdPromptPull(parsed.add, parsed.check, parsed.allowVariableChange)
      break
    case 'prompt-promote':
      await cmdPromptPromote(parsed.name, parsed.version, parsed.allowVariableChange)
      break
    case 'pairwise-run':
      await cmdPairwiseRun(parsed.phase, parsed.target, parsed.sample, parsed.arms, parsed.noEnqueue, parsed.allowUnreviewed)
      break
    case 'pairwise-report':
      await cmdPairwiseReport(parsed.runName)
      break
  }
}

// Guard: only run when executed as a script, not when imported for testing.
// Vitest sets VITEST=true — checking it avoids main() firing during test imports.
if (!process.env.VITEST) {
  main().catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
}
