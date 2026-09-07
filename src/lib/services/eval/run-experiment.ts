import { randomUUID } from 'node:crypto'

import type { PromptMeta } from '@/lib/langfuse/prompt'
import type { PhaseAdapter } from './phase-adapters'
import type { AuditCollector } from './zero-write'
import { runName as makeRunName, traceName as makeTraceName } from './langfuse-runs'
/**
 * Reused from scripts/enrichment/eval/search-eval/metrics.ts — no third implementation.
 * Imported with a relative path because no @/ alias covers scripts/.
 */
import { p95, mean } from '../../../../scripts/enrichment/eval/search-eval/metrics'

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
  type: 'model' | 'prompt'
  value: string
}

export type ItemResult = {
  itemId: string
  ok: boolean
  scores: Record<string, number>
  error?: string
  costUsd: number
  latencyMs: number
  output?: unknown
  expected?: unknown
  promptMeta?: PromptMeta['prompt']
}

type ArmSummary = {
  scorerMeans: Record<string, number>
  costPerItem: number
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

type ExperimentResult = {
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
  assertNoNewAuditRows: (opts: { since: Date }) => Promise<void> | void
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

        // Join cost/latency from collector by correlationId
        const auditRecords = collector.byCorrelation(itemRunId)
        const totalCost = auditRecords.reduce(
          (sum, r) => sum + (r.costUsd ?? 0),
          0,
        )
        const totalLatency = auditRecords.reduce(
          (sum, r) => sum + (r.latencyMs ?? 0),
          0,
        )

        if (taskResult?.ok) {
          // Score against expected
          const expected = adapter.expectedOf(item)
          const scores: Record<string, number> = {}
          for (const scorer of adapter.scorers) {
            scores[scorer.name] = scorer.fn(taskResult.output, expected)
          }

          return {
            itemId: item.id,
            ok: true,
            scores,
            costUsd: totalCost,
            latencyMs: totalLatency,
            output: taskResult.output,
            expected,
            ...(taskResult.promptMeta !== undefined ? { promptMeta: taskResult.promptMeta } : {}),
          }
        }

        // Failed: score 0 on every evaluator
        const zeroScores: Record<string, number> = {}
        for (const scorer of adapter.scorers) {
          zeroScores[scorer.name] = 0
        }

        return {
          itemId: item.id,
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

  const since = deps.now()
  const iso = since.toISOString()

  // Install zero-write seams
  const sinkPath = `scripts/llm-eval/runs/${dataset}-${iso}.jsonl`
  const { collector, restore } = deps.installSeams({ sinkPath })

  try {
    const armResults: ArmResult[] = []

    for (const arm of arms) {
      // Set per-arm environment
      const prevModel = process.env.OPENAI_MODEL_OVERRIDE
      const prevPromptVersions = process.env.LANGFUSE_PROMPT_VERSIONS

      try {
        if (arm.type === 'model') {
          process.env.OPENAI_MODEL_OVERRIDE = arm.value
        } else if (arm.type === 'prompt') {
          process.env.LANGFUSE_PROMPT_VERSIONS = arm.value
        }

        // Fetch system prompt
        const promptResult = await deps.fetchPrompt(
          adapter.promptName,
          adapter.variables,
        )

        // Pin check: a prompt arm requires Langfuse as the source —
        // the snapshot fallback ignores version pins.
        if (arm.type === 'prompt' && promptResult.prompt.source !== 'langfuse') {
          const zeroScores: Record<string, number> = {}
          for (const scorer of adapter.scorers) {
            zeroScores[scorer.name] = 0
          }
          armResults.push({
            arm: arm.name,
            items: items.map((item) => ({
              itemId: item.id,
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
              user: typeof item.input === 'string' ? item.input : JSON.stringify(item.input),
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

        // Use adapter.task when present, otherwise fall back to default callModel path
        const task = adapter.task
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
          const values = itemResults.map((r) => r.scores[scorer.name] ?? 0)
          scorerMeans[scorer.name] = mean(values)
        }

        const costs = itemResults.map((r) => r.costUsd)
        const latencies = itemResults.map((r) => r.latencyMs)

        // Derive promptMeta for the arm from the first item that has one
        const armPromptMeta = itemResults.find((r) => r.promptMeta !== undefined)?.promptMeta

        armResults.push({
          arm: arm.name,
          items: itemResults,
          summary: {
            scorerMeans,
            costPerItem: costs.length > 0 ? mean(costs) : 0,
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

    // Assert zero-write
    await deps.assertNoNewAuditRows({ since })

    // Flush Langfuse
    await deps.flushLangfuse()

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

    // Write run JSON
    const rn = makeRunName(dataset, arms.map((a) => a.name).join('+'), iso)
    const runData = {
      dataset,
      arms: arms.map((a) => ({
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
    return `| ${ar.arm} | ${scoreCols.join(' | ')} | $${ar.summary.costPerItem.toFixed(4)} | ${ar.summary.p95LatencyMs.toFixed(0)} |`
  })

  return [header, separator, ...rows].join('\n')
}
