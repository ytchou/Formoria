import { randomUUID } from 'node:crypto'

import type { PromptMeta } from '@/lib/langfuse/prompt'
import type { PhaseAdapter } from './phase-adapters'
import type { AuditCollector } from './zero-write'
import { runName as makeRunName, traceName as makeTraceName } from './langfuse-runs'
import { p95, mean, thresholdSweep, expectedCalibrationError, type CalibrationPoint } from './scorers'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExperimentItem = {
  id: string
  input: unknown
  expectedOutput: unknown
  humanApproval: {
    reviewedVia?: { queueId: string; scoreId: string } | string | undefined
    at?: string
  }
}

export type ExperimentArm = {
  name: string
  type: 'model' | 'prompt' | 'custom'
  value: string
}

export type ItemResult = {
  itemId: string
  itemRunId: string
  ok: boolean
  scores: Record<string, number>
  error?: string
  /** Null when any of the item's calls has an unknown price. */
  costUsd: number | null
  latencyMs: number
  output?: unknown
  expected?: unknown
  promptMeta?: PromptMeta['prompt']
}

type ArmSummary = {
  scorerMeans: Record<string, number>
  /** Null when any item's cost is unknown. */
  costPerItem: number | null
  p95LatencyMs: number
}

export type ArmResult = {
  arm: string
  items: ItemResult[]
  summary: ArmSummary
  promptMeta?: PromptMeta['prompt']
}

type ExperimentSummary = {
  total: number
  succeeded: number
  failed: number
}

export type ExperimentResult = {
  summary: ExperimentSummary
  armResults: ArmResult[]
  markdown: string
  exitCode: number
  provisional?: boolean
}

type CallModelResult = {
  ok: boolean
  content: string
}

type CallModelFn = (
  input: { system: string; user: string; phase: string; prompt?: { name: string; version: number; source: 'langfuse' | 'snapshot' } | null },
  options: { model?: string },
  itemRunId: string,
) => Promise<CallModelResult>

type WriteFileFn = (path: string, content: string) => void

type FetchPromptFn = (
  name: string,
  variables?: Record<string, string>,
) => Promise<PromptMeta>

type AuditContextSeed = { correlationId: string; langfuseTrace?: unknown }

export type ExperimentDeps = {
  callModel: CallModelFn
  writeFile: WriteFileFn
  now: () => Date
  flushLangfuse: () => Promise<void> | void
  fetchPrompt: FetchPromptFn
  installSeams: (opts: { sinkPath: string }) => { collector: AuditCollector; restore: () => void }
  assertNoNewAuditRows: (opts: { since: Date; correlationIds: string[]; spanIds: string[] }) => Promise<void> | void
  runWithAuditContext: <T>(seed: AuditContextSeed, fn: () => T) => T
  getAuditContext: () => { correlationId: string | null }
  createTrace?: (params: { name: string; id: string; metadata?: unknown }) => unknown
}

// ---------------------------------------------------------------------------
// Concurrency limiter (no p-limit dependency)
// ---------------------------------------------------------------------------

function createLimiter(concurrency: number) {
  let active = 0
  const queue: Array<() => void> = []

  function next() {
    if (queue.length > 0 && active < concurrency) {
      active++
      const resolve = queue.shift()!
      resolve()
    }
  }

  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => {
        queue.push(resolve)
      })
    } else {
      active++
    }
    try {
      return await fn()
    } finally {
      active--
      next()
    }
  }
}

// ---------------------------------------------------------------------------
// runItems (exported for Task 11 composition)
// ---------------------------------------------------------------------------

type RunItemsParams = {
  items: ExperimentItem[]
  task: (item: ExperimentItem, itemRunId: string) => Promise<{
    ok: boolean
    output: unknown
    error?: string
    promptMeta?: PromptMeta['prompt']
  }>
  adapter: PhaseAdapter
  concurrency: number
  collector: AuditCollector
  runWithAuditContext: ExperimentDeps['runWithAuditContext']
  /** Creates a Langfuse trace per item for generation linking. */
  createItemTrace?: (itemId: string, itemRunId: string) => unknown
}

/**
 * Scores for a failed item: 0 on every scorer except nullable ones, which stay
 * absent (n/a) so an origin-only mean is not diluted by the failure rate.
 */
function zeroScoresFor(adapter: PhaseAdapter): Record<string, number> {
  const zeroScores: Record<string, number> = {}
  for (const scorer of adapter.scorers) {
    if (!scorer.nullable) zeroScores[scorer.name] = 0
  }
  return zeroScores
}

/**
 * The user message for a default-task item. Golden items store the exact
 * production user text as `{user, promptName}`; sending the whole object as
 * JSON gave the model a payload production never sends. Other object inputs
 * have no user text of their own and stay JSON.
 */
function userMessageOf(input: unknown): string {
  if (typeof input === 'string') return input
  const user = (input as { user?: unknown } | null)?.user
  return typeof user === 'string' ? user : JSON.stringify(input)
}

export async function runItems({
  items,
  task,
  adapter,
  concurrency,
  collector,
  runWithAuditContext,
  createItemTrace,
}: RunItemsParams): Promise<ItemResult[]> {
  const limit = createLimiter(concurrency)

  const results = await Promise.all(
    items.map((item) =>
      limit(async () => {
        const itemRunId = randomUUID()

        let lastError: string | undefined
        let taskResult: { ok: boolean; output: unknown; error?: string; promptMeta?: PromptMeta['prompt'] } | null = null

        // Create a Langfuse trace for this item so emitLangfuseGeneration can link to it
        const langfuseTrace = createItemTrace?.(item.id, itemRunId) ?? undefined

        // Wall-clock timing wraps the entire retry loop
        const wallStart = Date.now()

        // One retry per item on failure (2 total attempts)
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            taskResult = await runWithAuditContext(
              { correlationId: itemRunId, ...(langfuseTrace ? { langfuseTrace } : {}) },
              () => task(item, itemRunId),
            )
            if (taskResult.ok) break
            lastError = taskResult.error ?? 'unknown error'
          } catch (e) {
            lastError = e instanceof Error ? e.message : String(e)
            taskResult = null
          }
        }

        const wallMs = Date.now() - wallStart

        // Join cost/latency from collector by correlationId. An explicit null
        // costUsd is a priced call whose price is unknown, so the item's cost is
        // unknown too; an absent one (started rows, unpriced calls) adds nothing.
        const auditRecords = collector.byCorrelation(itemRunId)
        const totalCost = auditRecords.some((r) => r.costUsd === null)
          ? null
          : auditRecords.reduce((sum, r) => sum + (r.costUsd ?? 0), 0)
        const totalLatency = auditRecords.length > 0
          ? auditRecords.reduce((sum, r) => sum + (r.latencyMs ?? 0), 0)
          : wallMs

        if (taskResult?.ok) {
          // Score against expected
          const expected = adapter.expectedOf(item)
          const scores: Record<string, number> = {}
          for (const scorer of adapter.scorers) {
            const score = scorer.fn(taskResult.output, expected)
            // null = n/a for this item: leave the key absent
            if (score !== null) scores[scorer.name] = score
          }

          return {
            itemId: item.id,
            itemRunId,
            ok: true,
            scores,
            costUsd: totalCost,
            latencyMs: totalLatency,
            output: taskResult.output,
            expected,
            ...(taskResult.promptMeta !== undefined ? { promptMeta: taskResult.promptMeta } : {}),
          }
        }

        // Failed: score 0 on every non-nullable evaluator
        const zeroScores = zeroScoresFor(adapter)

        return {
          itemId: item.id,
          itemRunId,
          ok: false,
          scores: zeroScores,
          error: lastError,
          costUsd: totalCost,
          latencyMs: totalLatency,
          ...(taskResult?.promptMeta !== undefined ? { promptMeta: taskResult.promptMeta } : {}),
        }
      }),
    ),
  )

  return results
}

// ---------------------------------------------------------------------------
// runExperiment (scored mode)
// ---------------------------------------------------------------------------

export async function runExperiment({
  dataset,
  arms,
  adapter,
  items,
  allowUnreviewed = false,
  concurrency = 4,
  deps,
}: {
  dataset: string
  arms: ExperimentArm[]
  adapter: PhaseAdapter
  items: ExperimentItem[]
  allowUnreviewed?: boolean
  concurrency?: number
  deps: ExperimentDeps
}): Promise<ExperimentResult> {
  // Validate human approval
  if (!allowUnreviewed) {
    const unreviewed = items.filter((item) => !item.humanApproval?.reviewedVia)
    if (unreviewed.length > 0) {
      const ids = unreviewed.map((item) => item.id).join(', ')
      throw new Error(
        `Items without humanApproval.reviewedVia: ${ids}. ` +
        `Pass allowUnreviewed: true to proceed with provisional results.`,
      )
    }
  }

  // Unique arm names per run, so results, traces and the run file never collide.
  const runArms = uniqueArmNames(arms)

  // Fail before any model call when a jev arm has nowhere to go.
  if (runArms.some(isJevArm) && !adapter.decide) {
    throw new Error(`adapter for ${dataset} has no decide hook`)
  }

  const since = deps.now()
  const iso = since.toISOString()

  // Install zero-write seams
  const sinkPath = `scripts/llm-eval/runs/${dataset}-${iso}.jsonl`
  const { collector, restore } = deps.installSeams({ sinkPath })

  try {
    const armResults: ArmResult[] = []

    for (const arm of runArms) {
      // Set per-arm environment
      const prevModel = process.env.OPENAI_MODEL_OVERRIDE
      const prevPromptVersions = process.env.LANGFUSE_PROMPT_VERSIONS

      try {
        if (arm.type === 'model') {
          process.env.OPENAI_MODEL_OVERRIDE = arm.value
        } else if (arm.type === 'prompt') {
          process.env.LANGFUSE_PROMPT_VERSIONS = arm.value
        } else if (arm.type === 'custom') {
          // Custom arms manage their own execution — no env setup
        } else {
          throw new Error(`Unknown arm type: ${(arm as { type: string }).type}`)
        }

        // Fetch system prompt (skip when adapter has no promptName, e.g. custom arms)
        const promptResult = adapter.promptName
          ? await deps.fetchPrompt(adapter.promptName, adapter.variables)
          : { text: '', prompt: { name: '', version: 0, source: 'snapshot' as const } }

        // Pin check: a prompt arm requires Langfuse as the source —
        // the snapshot fallback ignores version pins.
        if (arm.type === 'prompt' && promptResult.prompt.source !== 'langfuse') {
          const zeroScores = zeroScoresFor(adapter)
          armResults.push({
            arm: arm.name,
            items: items.map((item) => ({
              itemId: item.id,
              itemRunId: randomUUID(),
              ok: false,
              scores: { ...zeroScores },
              error: `prompt pin ${arm.value} resolved from ${promptResult.prompt.source}, not langfuse`,
              costUsd: 0,
              latencyMs: 0,
              promptMeta: promptResult.prompt,
            })),
            summary: {
              scorerMeans: zeroScores,
              costPerItem: 0,
              p95LatencyMs: 0,
            },
            promptMeta: promptResult.prompt,
          })
          continue
        }

        // Define the task for each item
        const defaultTask = async (
          item: ExperimentItem,
          itemRunId: string,
        ): Promise<{ ok: boolean; output: unknown; error?: string; promptMeta?: PromptMeta['prompt'] }> => {
          const result = await deps.callModel(
            {
              system: promptResult.text,
              user: userMessageOf(item.input),
              phase: adapter.profileKey,
              prompt: promptResult.prompt,
            },
            { model: arm.type === 'model' ? arm.value : undefined },
            itemRunId,
          )

          if (!result.ok) {
            return { ok: false, output: null, error: 'Model call failed', promptMeta: promptResult.prompt }
          }

          // Parse through adapter.parseOutput before unwrap
          const parsed = adapter.parseOutput(result.content)
          if (!parsed.ok) {
            return { ok: false, output: null, error: 'Output parsing failed', promptMeta: promptResult.prompt }
          }

          const unwrapped = adapter.unwrap(parsed.data)
          if (unwrapped === undefined || unwrapped === null) {
            return { ok: false, output: null, error: 'Unwrap returned empty (no results)', promptMeta: promptResult.prompt }
          }
          return { ok: true, output: unwrapped, promptMeta: promptResult.prompt }
        }

        // A jev arm goes to adapter.decide. Otherwise use adapter.task when
        // present, and fall back to the default callModel path.
        const task = isJevArm(arm)
          ? (item: ExperimentItem, itemRunId: string) =>
              adapter.decide!(item, { itemRunId })
          : adapter.task
            ? (item: ExperimentItem, itemRunId: string) =>
                adapter.task!(item, arm, { itemRunId, model: arm.type === 'model' ? arm.value : undefined })
            : defaultTask

        // Build per-item trace factory for Langfuse generation linking
        const createItemTrace = deps.createTrace
          ? (itemId: string, itemRunId: string) =>
              deps.createTrace!({
                name: makeTraceName(dataset, arm.name, itemId),
                id: itemRunId,
                metadata: {
                  arm: arm.name,
                  promptVersions: process.env.LANGFUSE_PROMPT_VERSIONS ?? null,
                },
              })
          : undefined

        // Run items
        const itemResults = await runItems({
          items,
          task,
          adapter,
          concurrency,
          collector,
          runWithAuditContext: deps.runWithAuditContext,
          createItemTrace,
        })

        // Aggregate per-arm metrics
        const scorerMeans: Record<string, number> = {}
        for (const scorer of adapter.scorers) {
          // n/a items (key absent) are excluded; an all-n/a scorer has no mean
          // and the markdown table prints n/a for it.
          const values = itemResults.flatMap((r) => r.scores[scorer.name] ?? [])
          if (values.length > 0) {
            scorerMeans[scorer.name] = mean(values)
          }
        }

        const costs = itemResults.map((r) => r.costUsd)
        const knownCosts = costs.filter((c): c is number => c !== null)
        const latencies = itemResults.map((r) => r.latencyMs)

        // Derive promptMeta for the arm from the first item that has one
        const armPromptMeta = itemResults.find((r) => r.promptMeta !== undefined)?.promptMeta

        armResults.push({
          arm: arm.name,
          items: itemResults,
          summary: {
            scorerMeans,
            costPerItem:
              knownCosts.length < costs.length ? null : costs.length > 0 ? mean(knownCosts) : 0,
            p95LatencyMs: p95(latencies),
          },
          ...(armPromptMeta !== undefined ? { promptMeta: armPromptMeta } : {}),
        })
      } finally {
        // Restore per-arm environment
        if (prevModel !== undefined) {
          process.env.OPENAI_MODEL_OVERRIDE = prevModel
        } else {
          delete process.env.OPENAI_MODEL_OVERRIDE
        }
        if (prevPromptVersions !== undefined) {
          process.env.LANGFUSE_PROMPT_VERSIONS = prevPromptVersions
        } else {
          delete process.env.LANGFUSE_PROMPT_VERSIONS
        }
      }
    }

    // Flush Langfuse before the assertion so traces are available for diagnosis
    // if the assertion fails (mirrors cmdDatasetRecord in llm-eval.ts)
    await deps.flushLangfuse()

    // Assert zero-write — scoped to this run's own identity
    const allItemRunIds = armResults.flatMap((a) => a.items.map((i) => i.itemRunId))
    const allSpanIds = collector.all().map((r) => r.spanId)
    if (allItemRunIds.length > 0) {
      await deps.assertNoNewAuditRows({ since, correlationIds: allItemRunIds, spanIds: allSpanIds })
    }

    // Compute summary
    const allItems = armResults.flatMap((a) => a.items)
    const failed = allItems.filter((i) => !i.ok).length
    const succeeded = allItems.filter((i) => i.ok).length

    const summary: ExperimentSummary = {
      total: allItems.length,
      succeeded,
      failed,
    }

    // Build markdown table
    let markdown = buildMarkdownTable(armResults, adapter)

    // Append summarize output if the adapter provides one
    if (adapter.summarize) {
      const summarizeOutput = adapter.summarize(armResults)
      if (summarizeOutput) {
        markdown += '\n\n' + summarizeOutput
      }
    }

    // Threshold sweep for arms whose outputs carry a probability (jev arms)
    const sweeps = buildThresholdSweeps(armResults, adapter)
    if (sweeps) {
      markdown += '\n\n' + sweeps
    }

    // Write run JSON
    const rn = makeRunName(dataset, runArms.map((a) => a.name).join('+'), iso)
    const runData = {
      dataset,
      arms: runArms.map((a) => ({
        name: a.name,
        type: a.type,
        value: a.value,
        ...(armResults.find((ar) => ar.arm === a.name)?.promptMeta !== undefined
          ? { promptMeta: armResults.find((ar) => ar.arm === a.name)!.promptMeta }
          : {}),
      })),
      items: armResults.flatMap((ar) =>
        ar.items.map((ir) => {
          // Reduce output to {evaluations, selected, agentOutcome} for JSON
          const reducedOutput = ir.output && typeof ir.output === 'object'
            ? {
                evaluations: (ir.output as Record<string, unknown>).evaluations,
                selected: (ir.output as Record<string, unknown>).selected,
                agentOutcome: (ir.output as Record<string, unknown>).agentOutcome,
              }
            : undefined
          return {
            arm: ar.arm,
            itemId: ir.itemId,
            ok: ir.ok,
            scores: ir.scores,
            ...(ir.error ? { error: ir.error } : {}),
            costUsd: ir.costUsd,
            latencyMs: ir.latencyMs,
            ...(reducedOutput ? { output: reducedOutput } : {}),
          }
        }),
      ),
      scores: armResults.map((ar) => ({
        arm: ar.arm,
        ...ar.summary,
      })),
      summary,
      iso,
    }

    deps.writeFile(
      `scripts/llm-eval/runs/${rn}.json`,
      JSON.stringify(runData, null, 2),
    )

    return {
      summary,
      armResults,
      markdown,
      exitCode: failed > 0 ? 1 : 0,
      ...(allowUnreviewed ? { provisional: true } : {}),
    }
  } finally {
    restore()
  }
}

// ---------------------------------------------------------------------------
// Arm names and threshold sweeps
// ---------------------------------------------------------------------------

function isJevArm(arm: ExperimentArm): boolean {
  return arm.type === 'custom' && arm.value.startsWith('jev:')
}

/** Suffixes repeated arm names with `#2`, `#3`, ... in order of appearance. */
function uniqueArmNames(arms: ExperimentArm[]): ExperimentArm[] {
  const used = new Set<string>()
  return arms.map((arm) => {
    let name = arm.name
    for (let n = 2; used.has(name); n++) name = `${arm.name}#${n}`
    used.add(name)
    return name === arm.name ? arm : { ...arm, name }
  })
}

/**
 * One threshold sweep, plus its ECE, per arm whose successful outputs carry a
 * numeric `probability`. `correct` is the adapter's first (primary agreement)
 * scorer above 0; items where that scorer is n/a are skipped.
 */
function buildThresholdSweeps(armResults: ArmResult[], adapter: PhaseAdapter): string {
  const primary = adapter.scorers[0]?.name
  if (!primary) return ''
  const sections: string[] = []
  for (const ar of armResults) {
    const points: CalibrationPoint[] = []
    for (const ir of ar.items) {
      if (!ir.ok || !ir.output || typeof ir.output !== 'object') continue
      const p = (ir.output as Record<string, unknown>).probability
      const score = ir.scores[primary]
      if (typeof p !== 'number' || score === undefined) continue
      // Above 0, not === 1: 0.5 from categoryAgreement means the L1 matched
      // and the L2 did not. The swept probability is P(L1), so an L1 match is
      // the event it predicts. Binary scorers (decisionAgreement) are 0 or 1.
      points.push({ p, correct: score > 0 })
    }
    if (points.length > 0) {
      const ece = expectedCalibrationError(points)
      sections.push(
        `### Threshold sweep: ${ar.arm} (correct = ${primary} > 0)\n\n${thresholdSweep(points)}\n\nECE: ${ece === null ? 'n/a' : ece.toFixed(3)}`,
      )
    }
  }
  return sections.join('\n\n')
}

// ---------------------------------------------------------------------------
// Markdown table builder
// ---------------------------------------------------------------------------

function buildMarkdownTable(
  armResults: ArmResult[],
  adapter: PhaseAdapter,
): string {
  const scorerNames = adapter.scorers.map((s) => s.name)

  const headers = ['arm', ...scorerNames, 'cost/item', 'p95 latency (ms)']
  const header = `| ${headers.join(' | ')} |`
  const separator = `| ${headers.map(() => '---').join(' | ')} |`

  const rows = armResults.map((ar) => {
    const scoreCols = scorerNames.map(
      (name) => ar.summary.scorerMeans[name]?.toFixed(3) ?? 'n/a',
    )
    const cost = ar.summary.costPerItem === null ? 'n/a' : `$${ar.summary.costPerItem.toFixed(4)}`
    return `| ${ar.arm} | ${scoreCols.join(' | ')} | ${cost} | ${ar.summary.p95LatencyMs.toFixed(0)} |`
  })

  return [header, separator, ...rows].join('\n')
}
