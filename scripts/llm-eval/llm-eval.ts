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
import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs as nodeParseArgs } from 'node:util'

import { config as dotenvConfig } from 'dotenv'

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
import type { PromptName } from '@/lib/langfuse/prompt'

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
  | {
      command: 'run'
      dataset: string
      arms: ArmSpec[]
      envFile?: string
      allowUnreviewed: boolean
    }
  | { command: 'prompt-push'; name: string; file?: string; label?: string; allowVariableChange: boolean }
  | { command: 'prompt-pull'; add: string[]; check: boolean; allowVariableChange: boolean }
  | { command: 'prompt-promote'; name: string; version: number }
  | {
      command: 'pairwise-run'
      phase: string
      target: string
      sample: number
      arms: ArmSpec[]
      envFile?: string
      noEnqueue: boolean
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
      return { command: 'prompt-promote', name, version }
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
      '  llm-eval dataset review enqueue --dataset <name>\n' +
      '  llm-eval dataset review push --dataset <name> --approved-by <user>\n' +
      '  llm-eval run --dataset <name> --arm <spec> [--arm <spec>] [--env-file <path>] [--allow-unreviewed]\n' +
      '  llm-eval prompt push <name> [--file <path>] [--label production] [--allow-variable-change]\n' +
      '  llm-eval prompt pull [--add <name>]... [--check] [--allow-variable-change]\n' +
      '  llm-eval prompt promote <name> <version>\n' +
      '  llm-eval pairwise run --phase <phase> [--target <target>] [--sample <n>] --arm <spec> --arm <spec> [--no-enqueue]\n' +
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
    return 1
  }

  if (result.snapshot && !check) {
    writeFileFn(
      LANGFUSE_SNAPSHOT_PATH,
      JSON.stringify(result.snapshot, null, 2) + '\n',
    )
    logFn('Snapshot updated')
  }

  return 0
}

export async function handlePromptPromote({
  name,
  version,
  deps,
}: {
  name: string
  version: number
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
  })

  if (!result.ok) {
    logFn(`promote failed: ${result.error}`)
    return 1
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

  const items = rawItems
    .filter((i) => i.status === 'ACTIVE')
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

  const { installSeams, assertNoNewAuditRows } = await import(
    '@/lib/services/eval/zero-write'
  )
  const { fetchLangfusePromptWithMeta } = await import('@/lib/langfuse/prompt')
  const { createProfiledOpenAIClient, profileChatParams } = await import(
    '@/lib/services/llm-audit'
  )
  const { runWithAuditContext, getAuditContext } = await import(
    '@/lib/audit/context'
  )

  const { writeFileSync, mkdirSync } = await import('node:fs')
  const { dirname } = await import('node:path')

  const callModel = async (
    input: { system: string; user: string; phase: string; prompt?: { name: string; version: number; source: 'langfuse' | 'snapshot' } | null },
    options: { model?: string },
    _itemRunId: string,
  ) => {
    const openai = createProfiledOpenAIClient(
      adapter.profileKey as Parameters<typeof createProfiledOpenAIClient>[0],
      { phase: input.phase, ...(input.prompt ? { prompt: input.prompt } : {}) },
      { model: options.model },
    )
    const result = await openai.chat({
      system: input.system,
      user: input.user,
      json: true,
      schema: adapter.requestSchema as { name: string; schema: Record<string, unknown> },
      ...profileChatParams(adapter.profileKey as Parameters<typeof profileChatParams>[0]),
    })
    return { ok: result.response.ok, content: result.content ?? '' }
  }

  const result = await runExperiment({
    dataset,
    arms,
    adapter,
    items,
    allowUnreviewed,
    deps: {
      callModel,
      createTrace: (params: { name: string; id: string; metadata?: unknown }) => {
        const lf = getLangfuse()
        if (!lf) return null
        return lf.trace(params)
      },
      writeFile: (path: string, content: string) => {
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, content)
      },
      now: () => new Date(),
      flushLangfuse,
      fetchPrompt: (name: string, variables?: Record<string, string>) =>
        fetchLangfusePromptWithMeta(name as PromptName, variables),
      installSeams,
      assertNoNewAuditRows,
      runWithAuditContext,
      getAuditContext,
    },
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
  const { setAuditWriteSeam } = await import('@/lib/audit/emit')
  const { assertNoNewAuditRows } = await import('@/lib/services/eval/zero-write')
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

  const client = getLangfuse()
  if (!client) {
    console.error('[record] Langfuse not configured')
    process.exitCode = 1
    return
  }

  // Install zero-write seam before any reads
  const since = new Date()
  setAuditWriteSeam(async () => null)

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
    .select('curation_job_id, url, title, image_url, supplier, url_class, search_position, created_at')
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

  const body = await recordPool({
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
  })

  // Write to Langfuse
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await client.createDatasetItem({ datasetName: dataset, ...body } as any)
  await flushLangfuse()

  // Assert zero writes
  await assertNoNewAuditRows({ since })

  // Dump run JSON
  const runJsonPath = `scripts/llm-eval/runs/record-${brandSlug}.json`
  mkdirSync('scripts/llm-eval/runs', { recursive: true })
  writeFileSync(runJsonPath, JSON.stringify(body, null, 2))

  console.log(`[record] Item "${body.id}" written to dataset "${dataset}"`)
  console.log(`[record] Run JSON: ${runJsonPath}`)
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

async function cmdPairwiseRun(
  phase: string,
  _target: string,
  sample: number,
  armSpecs: ArmSpec[],
  noEnqueue: boolean = false,
): Promise<void> {
  if (phase === 'products') {
    return cmdPairwiseRunProducts(armSpecs, noEnqueue, sample)
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
    const label =
      arm.kind === 'prompt'
        ? `prompt-v${arm.version}`
        : arm.model
    armLabels.push(label)
    const outputs = new Map<string, unknown>()

    const savedVersions = process.env.LANGFUSE_PROMPT_VERSIONS
    const savedModel = process.env.OPENAI_MODEL_OVERRIDE
    try {
      if (arm.kind === 'prompt') {
        process.env.LANGFUSE_PROMPT_VERSIONS = `descriptions:${arm.version}`
      } else {
        process.env.OPENAI_MODEL_OVERRIDE = arm.model
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

  // Load ACTIVE+reviewed items from the products dataset
  const datasetName = 'products-agent-ranking-golden'
  const { items: rawItems } = await client.getDataset(datasetName)
  const items = rawItems.filter((i) => {
    if (i.status !== 'ACTIVE') return false
    return isReviewed(i)
  })

  if (items.length === 0) {
    console.error('No ACTIVE+reviewed items found in products dataset')
    process.exitCode = 1
    return
  }

  const selectedItems = sample > 0 ? items.slice(0, sample) : items
  console.log(`[products] ${selectedItems.length} ACTIVE+reviewed items loaded${sample > 0 ? ` (sampled from ${items.length})` : ''}`)

  const since = new Date()
  const { restore } = installSeams({
    sinkPath: 'scripts/llm-eval/runs/pairwise-products-eval-sink.jsonl',
  })

  const task = productsTask({ createAgentModel, runProductsAgent })
  const armLabels = armSpecs.map((arm) =>
    arm.kind === 'prompt' ? `prompt-v${arm.version}` : arm.model,
  )
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
    try {
      if (armSpec.kind === 'prompt') {
        process.env.LANGFUSE_PROMPT_VERSIONS = `products-propose:${armSpec.version}`
      } else {
        process.env.OPENAI_MODEL_OVERRIDE = armSpec.model
      }
      const result = await taskFn(
        { id: item.id, input: item.input, expectedOutput: item.expectedOutput, humanApproval: {} },
        { name: armLabel, type: armSpec.kind, value: armSpec.kind === 'prompt' ? `products-propose:${armSpec.version}` : armSpec.model },
        { itemRunId: `pairwise-${armSuffix}-${item.id}` },
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

  restore()
  await assertNoNewAuditRows({ since })

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

async function cmdPromptPromote(name: string, version: number): Promise<void> {
  const exitCode = await handlePromptPromote({ name, version })
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

  const { argv: remainingArgv } = loadScriptTarget()
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
      await cmdPromptPromote(parsed.name, parsed.version)
      break
    case 'pairwise-run':
      await cmdPairwiseRun(parsed.phase, parsed.target, parsed.sample, parsed.arms, parsed.noEnqueue)
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
