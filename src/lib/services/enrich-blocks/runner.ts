/**
 * DAG block runner: executes blocks in topological order, respecting
 * chunk/brand scope, satisfaction, force-overrides, and circuit breaker.
 * Blocks are injected via the registry — no phase runner imports allowed.
 */

import type { BlockName, EnrichPhaseName } from '@/lib/constants/enrich-phases'
import { mapWithConcurrency } from '../_shared/concurrency'
import { recordPhaseOutputs, isUsablePhaseOutput, isUsablePhaseCheckpoint, mergeSelectedPhaseOutputs, type PhaseOutputRow } from './phase-outputs'
import { checkPhaseSatisfaction, phaseHistoryFromOutputs } from '../enrich-phases/phase-satisfaction'
import { validateRecoveryPlan } from './plan'
import type { PhaseOutputStore } from './phase-outputs'
import type { PhaseResult } from '@/lib/types/curation'
import type {
  BatchBlock,
  BrandBlock,
  Block,
  BlockContext,
  BlockRegistry,
  BlockRunResult,
} from './registry'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type RunBlocksHooks = {
  flushTargetProgress?: (ctx: BlockContext) => Promise<void>
  emitBatchPhaseProgress?: (phase: string) => void
  markCurrentPhase?: (ctx: BlockContext, phase: string) => void
  logCurrentPhase?: (phase: string) => void
  isTargetTerminated?: (ctx: BlockContext) => boolean
  onTargetFailure?: (ctx: BlockContext, error: Error) => void | Promise<void>
  onHydrate?: (ctx: BlockContext, phase: EnrichPhaseName, row: PhaseOutputRow) => void | Promise<void>
  loadImagePool?: (ctx: BlockContext) => Promise<unknown>
  onPhaseResult?: (
    ctx: BlockContext,
    phase: string,
    result: PhaseResult,
  ) => void
}

export type RunBlocksConfig = {
  chunk: BlockContext[]
  registry: BlockRegistry
  order: readonly BlockName[]
  concurrency: number
  satisfaction: Map<string, Map<string, Date>>
  store: PhaseOutputStore
  force: Map<string, Set<string>>
  hooks: RunBlocksHooks
  /** Job id for phase-output recording. */
  jobId: string
  recoveryJobIds?: readonly string[]
}

type BlockEnv = {
  satisfaction: Map<string, Map<string, Date>>
  store: PhaseOutputStore
  force: Map<string, Set<string>>
  hooks: RunBlocksHooks
  jobId: string
  exited: Set<string>
  recoveryJobIds: readonly string[]
  savedOutputs: Map<string, Map<string, PhaseOutputRow>>
}

export async function runBlocks(config: RunBlocksConfig): Promise<void> {
  const {
    chunk,
    registry,
    order,
    concurrency,
    satisfaction,
    store,
    force,
    hooks,
    jobId,
  } = config
  const exited = new Set<string>()
  for (const ctx of chunk) {
    ctx.checkpoints = new Map()
    ctx.phaseOutputs = new Map()
    if (ctx.plan) validateRecoveryPlan({ version: 1, action: { kind: 'resume' }, targets: { [ctx.targetId]: ctx.plan } })
  }
  const savedOutputs = new Map<string, Map<string, PhaseOutputRow>>()
  const rows = await store.reader.forTargets(chunk.map((ctx) => ({ id: ctx.targetId, type: ctx.targetType as 'submission' | 'brand' })))
  for (const ctx of chunk) {
    const targetRows = rows.filter((row) => {
      if (row.target_id !== ctx.targetId || row.target_type !== ctx.targetType || !isUsablePhaseCheckpoint(row)) return false
      if (!config.recoveryJobIds) return true
      if (row.job_id !== jobId && !config.recoveryJobIds.includes(row.job_id)) return false
      return !ctx.plan?.selected.includes(row.phase as EnrichPhaseName) || row.persisted_at === null
    })
    if (!satisfaction.has(ctx.targetId)) satisfaction.set(ctx.targetId, phaseHistoryFromOutputs(targetRows))
    const latest = new Map<string, PhaseOutputRow>()
    for (const row of targetRows) {
      if (row.status !== 'succeeded' || !isUsablePhaseOutput(row.output)) continue
      const previous = latest.get(row.phase)
      if (!previous || row.created_at > previous.created_at) latest.set(row.phase, row)
    }
    savedOutputs.set(ctx.targetId, latest)
  }
  const env: BlockEnv = { satisfaction, store, force, hooks, jobId, exited, savedOutputs, recoveryJobIds: config.recoveryJobIds ?? [] }

  for (const blockName of order) {
    const block = registry[blockName]
    const remaining = chunk.filter((ctx) => !exited.has(ctx.targetId) && !hooks.isTargetTerminated?.(ctx))

    if (block.scope === 'chunk') {
      await runChunkBlock(blockName, block, remaining, env)
    } else {
      await runBrandBlock(blockName, block, remaining, concurrency, env)
    }
  }
}

// Chunk-scope: barrier — run once, apply per-context

async function runChunkBlock(
  blockName: BlockName,
  block: BatchBlock,
  remaining: BlockContext[],
  env: BlockEnv,
): Promise<void> {
  if (remaining.length === 0) return
  const toRun: BlockContext[] = []
  for (const ctx of remaining) {
    if (await shouldSkip(blockName, block, ctx, env)) continue
    toRun.push(ctx)
  }
  if (toRun.length === 0) return
  const results = await block.runBatch(toRun)
  if (
    results.size !== toRun.length ||
    toRun.some((ctx) => !results.has(ctx.targetId))
  ) {
    throw new Error(
      `Batch block ${blockName} returned results for the wrong targets`,
    )
  }
  for (const ctx of toRun) {
    const result = results.get(ctx.targetId)
    if (!result)
      throw new Error(
        `Batch block ${blockName} has no result for ${ctx.targetId}`,
      )
    await applyResult(blockName, block, ctx, result, env)
  }
}

// Brand-scope: fan-out with concurrency + breaker drain

async function runBrandBlock(
  blockName: BlockName,
  block: BrandBlock,
  remaining: BlockContext[],
  concurrency: number,
  env: BlockEnv,
): Promise<void> {
  if (remaining.length === 0) return

  let breakerError: Error | null = null

  await mapWithConcurrency(remaining, concurrency, async (ctx) => {
    if (breakerError) return // skip new items; in-flight ones drain
    if (await shouldSkip(blockName, block, ctx, env)) return

    try {
      const result = await block.run(ctx)
      await applyResult(blockName, block, ctx, result, env)
    } catch (err) {
      if (isBreaker(err)) {
        breakerError = err as Error
      } else {
        throw err
      }
    }
  })

  if (breakerError) throw breakerError
}

// Per-context: precondition + satisfaction gate

async function shouldSkip(
  blockName: BlockName,
  block: Block,
  ctx: BlockContext,
  env: BlockEnv,
): Promise<boolean> {
  if (env.hooks.isTargetTerminated?.(ctx)) return true
  if (block.precondition && !await block.precondition(ctx)) return true
  const selected = ctx.plan
    ? block.phases.filter((phase) => ctx.plan!.selected.includes(phase))
    : [...block.phases]
  const history = env.satisfaction.get(ctx.targetId) ?? new Map()
  const needsExecution = (phase: EnrichPhaseName) => checkPhaseSatisfaction(
    phase, history as Map<EnrichPhaseName, Date>,
    ctx.plan?.forced.includes(phase) || env.force.get(ctx.targetId)?.has(phase),
    undefined, env.recoveryJobIds.length ? ctx.plan?.selected : undefined,
  ) === 'unsatisfied'
  if (block.requiredBy && !block.requiredBy.some((phase) =>
    (!ctx.plan || ctx.plan.selected.includes(phase)) && needsExecution(phase),
  )) return true
  ctx.executePhases = selected.filter(needsExecution)
  // Saved upstream inputs may be read without authorizing their patches or execution.
  for (const phase of block.phases.filter((phase) => !selected.includes(phase))) {
    const row = env.savedOutputs.get(ctx.targetId)?.get(phase)
    if (row) await env.hooks.onHydrate?.(ctx, phase, row)
  }
  for (const phase of selected.filter((phase) => !ctx.executePhases!.includes(phase))) {
    const row = env.savedOutputs.get(ctx.targetId)?.get(phase)
    if (row && isUsablePhaseOutput(row.output)) {
      if (row.persisted_at === null && (isOwnedCheckpoint(row, env))) {
        ctx.checkpoints?.set(phase, row)
        ctx.phaseOutputs?.set(phase, row.output)
      }
      if (row.output.carry) ctx.state[blockName] = row.output.carry
      await env.hooks.onHydrate?.(ctx, phase, row)
    }
    pushSkippedResults([phase], ctx, env.hooks)
  }
  if (block.phases.length > 0 && ctx.executePhases.length === 0) return true
  const inputError = block.inputError?.(ctx)
  if (!inputError) return false
  env.exited.add(ctx.targetId)
  for (const phase of ctx.executePhases) {
    env.hooks.onPhaseResult?.(ctx, phase, {
      phase, status: 'failed', changedFields: [], durationMs: 0, error: inputError,
    })
  }
  await env.hooks.onTargetFailure?.(ctx, new Error(inputError))
  return true
}

// Post-run: record outputs, check postcondition, emit results

async function applyResult(
  blockName: BlockName,
  block: Block,
  ctx: BlockContext,
  result: BlockRunResult,
  env: BlockEnv,
): Promise<void> {
  if (result.output && block.phases.length !== 1) {
    throw new Error(
      `Block ${blockName} must attribute outputs to individual phases`,
    )
  }
  const singlePhase = ctx.executePhases?.at(0) ?? block.phases.at(0)
  const outputs =
    result.phaseOutputs ??
    (result.output && singlePhase
      ? [
          {
            phaseResult: {
              phase: singlePhase,
              status: result.exit?.status ?? 'succeeded',
              changedFields: Object.keys(result.output.patch),
              durationMs: 0,
            } satisfies PhaseResult,
            output: result.output,
          },
        ]
      : [])
  const reported = new Set<string>()
  for (const entry of outputs) {
    if (
      !(ctx.executePhases ?? block.phases).some((phase) => phase === entry.phaseResult.phase) ||
      reported.has(entry.phaseResult.phase)
    ) {
      throw new Error(
        `Block ${blockName} returned an unowned or duplicate phase`,
      )
    }
    mergeSelectedPhaseOutputs([entry.phaseResult.phase as EnrichPhaseName], new Map([[entry.phaseResult.phase, entry.output]]))
    reported.add(entry.phaseResult.phase)
  }
  if (outputs.length && env.jobId) {
    const checkpoints = await recordPhaseOutputs(env.store, {
      jobId: env.jobId,
      target: {
        id: ctx.targetId,
        type: ctx.targetType as 'brand' | 'submission',
      },
      entries: outputs.map((entry) => ({
        phase: entry.phaseResult.phase,
        status: entry.phaseResult.status,
        output: entry.output,
      })),
    })
    for (const row of checkpoints) {
      if (row.status === 'succeeded') ctx.checkpoints?.set(row.phase, row)
    }
  }
  for (const entry of outputs) {
    if (entry.phaseResult.status === 'succeeded') {
      ctx.phaseOutputs?.set(entry.phaseResult.phase, entry.output)
      const history = env.satisfaction.get(ctx.targetId) ?? new Map<string, Date>()
      history.set(entry.phaseResult.phase, new Date())
      env.satisfaction.set(ctx.targetId, history)
    }
    if (entry.phaseResult.status === 'succeeded' && entry.output.carry) {
      ctx.state[blockName] = entry.output.carry
    }
    env.hooks.onPhaseResult?.(ctx, entry.phaseResult.phase, entry.phaseResult)
  }

  if (result.exit) {
    env.exited.add(ctx.targetId)
    env.hooks.onPhaseResult?.(
      ctx,
      result.exit.phaseResult.phase,
      result.exit.phaseResult,
    )
    return
  }

  if (block.postcondition) {
    const exit = block.postcondition(ctx, result)
    if (exit) {
      env.exited.add(ctx.targetId)
      env.hooks.onPhaseResult?.(ctx, exit.phaseResult.phase, exit.phaseResult)
      return
    }
  }
}

function pushSkippedResults(
  phases: readonly EnrichPhaseName[],
  ctx: BlockContext,
  hooks: RunBlocksHooks,
): void {
  for (const phase of phases) {
    hooks.onPhaseResult?.(ctx, phase, {
      phase,
      status: 'skipped',
      detail: 'phase output already satisfied',
      changedFields: [],
      durationMs: 0,
    })
  }
}

function isBreaker(error: unknown): boolean {
  return error instanceof Error && error.name === 'LlmCircuitBreakerError'
}

function isOwnedCheckpoint(row: PhaseOutputRow, env: BlockEnv): boolean {
  return row.job_id === env.jobId || env.recoveryJobIds.includes(row.job_id)
}
