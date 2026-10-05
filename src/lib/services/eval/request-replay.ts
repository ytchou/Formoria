/**
 * Orchestrator for `llm-eval replay` (DEV-1917, design D1, D3, D6, D8).
 *
 * Re-sends logged production requests (`brand_ai_results.request`) on a
 * challenger model and on an incumbent noise arm (each span's stored model),
 * scores both against the stored production answer and builds one table and
 * one blind panel packet per step.
 *
 * Zero-write (D3): the seams are installed before the first call, every client
 * is built without a `target` (so nothing is persisted to `brand_ai_results`),
 * and `assertNoNewAuditRows` checks the run's own ids at the end.
 */

import { randomUUID } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { LlmProfileKey } from '@/lib/constants/llm-models'
import { targetImageStorage, type EnrichmentTarget } from '../_shared/enrichment-target'
import type { CapturedCall, LlmAuditContext, LoggedRequest } from '../llm-audit'
import type { OpenAIChatResult } from '../openai-client'
import { runName } from './langfuse-runs'
import {
  buildPanelPacket,
  buildStepTable,
  DEFAULT_PANEL_MAX,
  type ReplayArmResult,
  type ReplaySpanResult,
  type StepTable,
} from './request-replay-report'
import { loadReplaySpans, supabaseReplayRowReader, type ReplayRowReader, type ReplaySpan } from './request-replay-load'
import {
  normalizeFresh,
  normalizeStored,
  rebuildImages,
  toChatInput,
  type ChatInput,
  type ImageRebuildDeps,
  type ImageSpan,
  type ImageTable,
} from './request-replay-request'
import { scoreReplayResponse, type NormalizedResponse } from './request-replay-score'
import { REPLAY_STEPS, type ReplayStep } from './request-replay-steps'
import { runItems, type ExperimentDeps, type ExperimentItem, type ItemResult } from './run-experiment'
import type { AuditCollector } from './zero-write'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The fields of a chat result replay reads; the audited client returns a superset. */
export type ReplayChatResult = Pick<OpenAIChatResult, 'ok' | 'status' | 'content' | 'toolCalls'>

type ReplayChatClient = { chat: (input: ChatInput) => Promise<ReplayChatResult> }

type RequestReplayTaskDeps = {
  /** `createProfiledOpenAIClient` from `llm-audit.ts`, or a fake in tests. */
  createProfiledOpenAIClient: (
    profileKey: LlmProfileKey,
    context: LlmAuditContext,
    options: { model: string },
  ) => ReplayChatClient
}

export type RequestReplayDeps = RequestReplayTaskDeps & {
  readRows: ReplayRowReader
  images: ImageRebuildDeps
  installSeams: (opts: { sinkPath: string }) => { collector: AuditCollector; restore: () => void }
  assertNoNewAuditRows: (opts: { since: Date; correlationIds: string[]; spanIds: string[] }) => Promise<void>
  runWithAuditContext: ExperimentDeps['runWithAuditContext']
  getAuditContext: () => { correlationId: string | null }
  /** `setChatCaptureSeam` from `llm-audit.ts`: observes each call's `paramFallback`. */
  setChatCaptureSeam: (fn: ((call: CapturedCall) => void) | null) => void
  /** `_resetLearnedParamShapes` from `openai-client.ts`, run before each arm (D8). */
  resetLearnedParamShapes: () => void
  writeFile: (path: string, content: string) => Promise<void>
  now: () => Date
}

type RunRequestReplayOptions = {
  /** Catalog step names; the run follows catalog order whatever the order here. */
  steps: readonly string[]
  challengerModel: string
  since?: string
  /** Max spans per step, newest first (D11). */
  limit?: number
  panelMax?: number
  seed?: string
}

type ImageCounts = { rebuiltSpans: number; rebuiltImages: number; skippedSpans: number }

type ReplayStepReport = StepTable & {
  step: string
  images: ImageCounts
  panel: { items: number; dir: string }
}

type RequestReplayResult = {
  tables: ReplayStepReport[]
  summary: string
  runFile: string
}

/** A replayable span's task input. */
type ReplayItemInput = { step: ReplayStep; phase: string; chatInput: ChatInput }

type TaskResult = { ok: boolean; output: unknown; error?: string }

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

/**
 * Re-sends one span's rebuilt request on `model`. The client is built without
 * a `target`: the zero-write path (D3), so no `brand_ai_results` row is written.
 */
export function requestReplayTask(deps: RequestReplayTaskDeps) {
  return async (item: ExperimentItem, model: string): Promise<TaskResult> => {
    const { step, phase, chatInput } = item.input as ReplayItemInput
    const client = deps.createProfiledOpenAIClient(step.profileKey, { phase }, { model })
    const result = await client.chat(chatInput)
    if (!result.ok) return { ok: false, output: null, error: `chat failed: HTTP ${result.status}` }
    return { ok: true, output: normalizeFresh(result) }
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

const RUNS_DIR = 'scripts/llm-eval/runs'
const DEFAULT_SEED = 'dev-1917'
const CONCURRENCY = 4
const OFF_SLOT_NOTE = 'off-slot call'

function resolveSteps(names: readonly string[]): ReplayStep[] {
  const valid = REPLAY_STEPS.map((step) => step.name)
  for (const name of names) {
    if (!valid.includes(name)) {
      throw new Error(`Unknown replay step: ${name} (valid: ${valid.join(', ')})`)
    }
  }
  return REPLAY_STEPS.filter((step) => names.includes(step.name))
}

/** The row a span is described by: its answer, else its newest row. */
function leadRow(span: ReplaySpan) {
  return span.answer ?? span.rows[span.rows.length - 1]!
}

function brandKeyOf(span: ReplaySpan): string {
  const lead = leadRow(span)
  const brandId = lead.brandId ?? lead.submissionBrandId
  if (brandId) return `brand:${brandId}`
  if (lead.submissionId) return `submission:${lead.submissionId}`
  return `span:${span.spanId}`
}

function targetOf(span: ReplaySpan): EnrichmentTarget {
  const lead = leadRow(span)
  return lead.submissionId ? { type: 'submission', id: lead.submissionId } : { type: 'brand', id: lead.brandId ?? '' }
}

/** Off-slot is reported on its own column, so a call that only went off-slot is not also a failure. */
function failureOf(result: ItemResult): string | null {
  if (result.ok) return null
  const error = result.error ?? 'unknown error'
  const rest = error
    .split('; ')
    .filter((part) => !part.startsWith(OFF_SLOT_NOTE))
    .join('; ')
  return rest === '' ? null : rest
}

function armResultOf(
  result: ItemResult,
  model: string,
  step: ReplayStep,
  expected: NormalizedResponse,
  fallbackRunIds: ReadonlySet<string>,
): ReplayArmResult {
  const output = result.ok ? (result.output as NormalizedResponse) : null
  return {
    model,
    output,
    score: output ? scoreReplayResponse(output, expected, step) : null,
    latencyMs: result.latencyMs,
    costUsd: result.costUsd,
    tokens:
      result.promptTokens === undefined
        ? null
        : {
            promptTokens: result.promptTokens,
            cachedPromptTokens: result.cachedPromptTokens,
            cacheWriteTokens: result.cacheWriteTokens,
            completionTokens: result.completionTokens ?? 0,
          },
    failure: failureOf(result),
    offSlot: result.error?.includes(OFF_SLOT_NOTE) ?? false,
    paramFallback: fallbackRunIds.has(result.itemRunId),
  }
}

type StepRun = {
  report: ReplayStepReport
  /** Every correlation id this step's calls ran under; empty when it made none. */
  correlationIds: string[]
}

type RunContext = {
  deps: RequestReplayDeps
  challengerModel: string
  collector: AuditCollector
  fallbackRunIds: ReadonlySet<string>
  panelMax: number
  seed: string
  runDir: string
}

async function replayStep(step: ReplayStep, spans: ReplaySpan[], ctx: RunContext): Promise<StepRun> {
  const { deps } = ctx
  const correlationIds: string[] = []
  const images: ImageCounts = { rebuiltSpans: 0, rebuiltImages: 0, skippedSpans: 0 }

  // Image loads are audited calls (`loadVisionImage`, `fetchVisionImage`);
  // one correlation id per step keeps them inside the zero-write check.
  const imageCorrelationId = randomUUID()
  const results: ReplaySpanResult[] = []
  const replayable: Array<{ result: ReplaySpanResult; item: ExperimentItem }> = []

  // Sequential: a step holds at most `--limit` spans with a handful of images
  // each; parallel loads would only matter well past the default limit of 50.
  for (const span of spans) {
    const lead = leadRow(span)
    const result: ReplaySpanResult = {
      spanId: span.spanId,
      step: step.name,
      brandKey: brandKeyOf(span),
      storedModel: lead.model,
      expected: null,
      evidence: lead.request,
      skip: null,
      challenger: null,
      incumbent: null,
    }
    results.push(result)

    if (!span.answer) {
      result.skip = 'prod-failed'
      continue
    }

    const request = span.answer.request as LoggedRequest
    // Loaded once here, before the arms; both arms reuse the result (D8).
    const imageSpan: ImageSpan = { request, target: targetOf(span) }
    const rebuilt = await deps.runWithAuditContext({ correlationId: imageCorrelationId }, () =>
      rebuildImages(imageSpan, deps.images),
    )
    if ('skip' in rebuilt) {
      result.skip = 'image'
      images.skippedSpans++
      continue
    }
    if (rebuilt.images && rebuilt.images.length > 0) {
      images.rebuiltSpans++
      images.rebuiltImages += rebuilt.images.length
    }

    const expected = normalizeStored(span.answer.rawResponse)
    result.expected = expected
    const input: ReplayItemInput = { step, phase: span.answer.phase, chatInput: toChatInput(request, rebuilt.images) }
    replayable.push({
      result,
      item: { id: span.spanId, input, expectedOutput: expected, humanApproval: {} },
    })
  }
  if (ctx.collector.byCorrelation(imageCorrelationId).length > 0) correlationIds.push(imageCorrelationId)

  if (replayable.length > 0) {
    const task = requestReplayTask(deps)
    const adapter = {
      // runItems' own agreement score; the full ReplayScore is rebuilt per arm below.
      scorers: [
        {
          name: 'agreement',
          fn: (output: unknown, expected: unknown) =>
            scoreReplayResponse(output as NormalizedResponse, expected as NormalizedResponse, step).agreement,
          nullable: true as const,
        },
      ],
      expectedOf: (item: { expectedOutput: unknown }) => item.expectedOutput,
    }

    // The challenger, then one incumbent arm per distinct stored model, so the
    // slot assertion compares every call against exactly one model (D8).
    const storedModels = [...new Set(replayable.map((r) => r.result.storedModel))]
    const arms: Array<{ role: 'challenger' | 'incumbent'; model: string; members: typeof replayable }> = [
      { role: 'challenger', model: ctx.challengerModel, members: replayable },
      ...storedModels.map((model) => ({
        role: 'incumbent' as const,
        model,
        members: replayable.filter((r) => r.result.storedModel === model),
      })),
    ]

    for (const arm of arms) {
      deps.resetLearnedParamShapes()
      const itemResults = await runItems({
        items: arm.members.map((m) => m.item),
        task: (item) => task(item, arm.model),
        adapter,
        concurrency: CONCURRENCY,
        collector: ctx.collector,
        runWithAuditContext: deps.runWithAuditContext,
        armModel: arm.model,
      })
      const byId = new Map(itemResults.map((r) => [r.itemId, r]))
      for (const member of arm.members) {
        const itemResult = byId.get(member.item.id)
        if (!itemResult) continue
        correlationIds.push(itemResult.itemRunId)
        member.result[arm.role] = armResultOf(
          itemResult,
          arm.model,
          step,
          member.item.expectedOutput as NormalizedResponse,
          ctx.fallbackRunIds,
        )
      }
    }
  }

  const table = buildStepTable(step.name, results)
  const dir = `${ctx.runDir}/${step.name}`
  const packet = await buildPanelPacket({
    spans: results,
    panelMax: ctx.panelMax,
    seed: ctx.seed,
    outDir: dir,
    writeFile: deps.writeFile,
  })

  return {
    report: { ...table, step: step.name, images, panel: { items: packet.items.length, dir } },
    correlationIds,
  }
}

function buildSummary(
  challengerModel: string,
  reports: ReplayStepReport[],
  loaded: { rowsRead: number; unclassified: number },
): string {
  const sum = (pick: (r: ReplayStepReport) => number) => reports.reduce((n, r) => n + pick(r), 0)
  const empty = reports.filter((r) => r.stats.spans === 0).map((r) => r.step)
  const underPowered = reports.filter((r) => r.stats.underPowered && r.stats.spans > 0).map((r) => r.step)
  const lines = [
    `## Replay summary — challenger ${challengerModel}`,
    '',
    `- rows read: ${loaded.rowsRead}; unclassified rows (no catalog step, never scored): ${loaded.unclassified}`,
    `- steps: ${reports.length}; empty (n=0): ${empty.length > 0 ? empty.join(', ') : 'none'}`,
    `- UNDER-POWERED (n < 30): ${underPowered.length > 0 ? underPowered.join(', ') : 'none'}`,
    `- spans: ${sum((r) => r.stats.spans)}; skips: image ${sum((r) => r.stats.skips.image)}, prod-failed ${sum((r) => r.stats.skips['prod-failed'])}`,
    `- failures: ${sum((r) => r.stats.failures)}; off-slot calls: ${sum((r) => r.stats.offSlot)}; paramFallback: ${sum((r) => r.stats.paramFallback)}`,
  ]
  for (const r of reports) {
    if (r.images.rebuiltSpans + r.images.skippedSpans === 0) continue
    lines.push(
      `- ${r.step} images: ${r.images.rebuiltImages} rebuilt across ${r.images.rebuiltSpans} span(s); ${r.images.skippedSpans} span(s) skipped`,
    )
  }
  for (const r of reports) {
    if (r.panel.items > 0) lines.push(`- ${r.step} panel packet: ${r.panel.items} item(s) in ${r.panel.dir}`)
  }
  return lines.join('\n')
}

export async function runRequestReplay(
  options: RunRequestReplayOptions,
  deps: RequestReplayDeps,
): Promise<RequestReplayResult> {
  const steps = resolveSteps(options.steps)

  const since = deps.now()
  const iso = since.toISOString()
  const rn = runName('replay', options.challengerModel, iso)
  const runFile = `${RUNS_DIR}/${rn}.json`

  // Seams go in before the first audited call (image loads included).
  const { collector, restore } = deps.installSeams({ sinkPath: `${RUNS_DIR}/${rn}.jsonl` })
  const fallbackRunIds = new Set<string>()
  try {
    deps.setChatCaptureSeam((call) => {
      if (!call.paramFallback || call.paramFallback.length === 0) return
      const correlationId = deps.getAuditContext().correlationId
      if (correlationId) fallbackRunIds.add(correlationId)
    })

    // One read for every step: steps share phases (descriptions, acquire,
    // products), and products rows average 82 KB.
    const loaded = await loadReplaySpans(
      { steps, ...(options.since ? { since: options.since } : {}), ...(options.limit !== undefined ? { limit: options.limit } : {}) },
      { readRows: deps.readRows },
    )

    const ctx: RunContext = {
      deps,
      challengerModel: options.challengerModel,
      collector,
      fallbackRunIds,
      panelMax: options.panelMax ?? DEFAULT_PANEL_MAX,
      seed: options.seed ?? DEFAULT_SEED,
      runDir: `${RUNS_DIR}/${rn}`,
    }

    const reports: ReplayStepReport[] = []
    const correlationIds: string[] = []
    for (const step of steps) {
      const run = await replayStep(
        step,
        loaded.spans.filter((span) => span.step.name === step.name),
        ctx,
      )
      reports.push(run.report)
      correlationIds.push(...run.correlationIds)
    }

    // Skipped when no step made a call: the assertion throws on empty ids (D3).
    if (correlationIds.length > 0) {
      await deps.assertNoNewAuditRows({
        since,
        correlationIds,
        spanIds: collector.all().map((record) => record.spanId),
      })
    }

    const summary = buildSummary(options.challengerModel, reports, loaded)
    await deps.writeFile(
      runFile,
      JSON.stringify(
        {
          challengerModel: options.challengerModel,
          options,
          iso,
          rowsRead: loaded.rowsRead,
          unclassified: loaded.unclassified,
          steps: reports.map((r) => ({ ...r.stats, images: r.images, panel: r.panel })),
        },
        null,
        2,
      ),
    )

    return { tables: reports, summary, runFile }
  } finally {
    deps.setChatCaptureSeam(null)
    restore()
  }
}

// ---------------------------------------------------------------------------
// Production deps
// ---------------------------------------------------------------------------

/** The image row's processed Storage object as a vision data URI, or null when it has none. */
async function storedDataUri(
  client: SupabaseClient,
  table: ImageTable,
  match: Record<string, string>,
  loadVisionDataUri: (image: { storage_path?: string | null }) => Promise<string | null>,
): Promise<string | null> {
  const { data, error } = await client.from(table).select('storage_path').match(match).maybeSingle()
  if (error) throw new Error(`[replay] ${table} read failed: ${error.message}`)
  const storagePath = (data as { storage_path?: string | null } | null)?.storage_path
  return storagePath ? loadVisionDataUri({ storage_path: storagePath }) : null
}

/**
 * The real deps. `client` is the service client for the `--target` the CLI
 * resolved; it is only read. Image Storage reads and the zero-write count use
 * `createServiceClient()`, which `loadScriptTarget` points at the same project.
 */
export async function createRequestReplayDeps(client: SupabaseClient): Promise<RequestReplayDeps> {
  const [zeroWrite, llmAudit, auditContext, openaiClient, imageDownload, fs, path] =
    await Promise.all([
      import('./zero-write'),
      import('../llm-audit'),
      import('@/lib/audit/context'),
      import('../openai-client'),
      import('../image-download'),
      import('node:fs/promises'),
      import('node:path'),
    ])
  const { loadVisionDataUri } = await import('../enrich-phases/classify-images')

  return {
    readRows: supabaseReplayRowReader(client),
    images: {
      loadStoredImage: (table, id) => storedDataUri(client, table, { id }, loadVisionDataUri),
      loadBySourceUrl: (table, targetId, sourceUrl) => {
        const { foreignKey } = targetImageStorage({
          type: table === 'submission_images' ? 'submission' : 'brand',
          id: targetId,
        })
        return storedDataUri(client, table, { [foreignKey]: targetId, source_url: sourceUrl }, loadVisionDataUri)
      },
      fetchVisionImage: (url) => imageDownload.fetchVisionImage(url),
    },
    createProfiledOpenAIClient: (profileKey, context, options) =>
      llmAudit.createProfiledOpenAIClient(profileKey, context, options),
    installSeams: zeroWrite.installSeams,
    assertNoNewAuditRows: (opts) => zeroWrite.assertNoNewAuditRows(opts),
    runWithAuditContext: auditContext.runWithAuditContext,
    getAuditContext: auditContext.getAuditContext,
    setChatCaptureSeam: llmAudit.setChatCaptureSeam,
    resetLearnedParamShapes: openaiClient._resetLearnedParamShapes,
    writeFile: async (file, content) => {
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, content)
    },
    now: () => new Date(),
  }
}
