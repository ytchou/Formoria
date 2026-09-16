/**
 * DAG block runner: executes blocks in topological order, respecting
 * chunk/brand scope, satisfaction, force-overrides, and circuit breaker.
 * Blocks are injected via the registry — no phase runner imports allowed.
 */

import type { BlockName } from '@/lib/constants/enrich-phases'
import { mapWithConcurrency } from '../_shared/concurrency'
import { recordPhaseOutputs, latestPhaseOutputs } from './phase-outputs'
import type { PhaseOutputStore, PhaseOutput } from './phase-outputs'
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
}

type BlockEnv = {
  satisfaction: Map<string, Map<string, Date>>
  store: PhaseOutputStore
  force: Map<string, Set<string>>
  hooks: RunBlocksHooks
  jobId: string
  exited: Set<string>
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
  const env: BlockEnv = { satisfaction, store, force, hooks, jobId, exited }

  for (const blockName of order) {
    const block = registry[blockName]
    const remaining = chunk.filter((ctx) => !exited.has(ctx.targetId))

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
  if (block.precondition) {
    const ok = await block.precondition(ctx)
    if (!ok) {
      pushSkippedResults(block, ctx, env.hooks)
      return true
    }
  }

  if (
    block.phases.length > 0 &&
    isSatisfied(block, ctx, env.satisfaction, env.force)
  ) {
    await hydrateCarry(blockName, block, ctx, env.store)
    pushSkippedResults(block, ctx, env.hooks)
    return true
  }

  return false
}

function isSatisfied(
  block: Block,
  ctx: BlockContext,
  satisfaction: Map<string, Map<string, Date>>,
  force: Map<string, Set<string>>,
): boolean {
  const targetSat = satisfaction.get(ctx.targetId)
  if (!targetSat) return false

  const allSatisfied = block.phases.every((phase) => targetSat.has(phase))
  if (!allSatisfied) return false
  const targetForce = force.get(ctx.targetId)
  if (targetForce && block.phases.some((phase) => targetForce.has(phase))) {
    return false
  }

  return true
}

// Carry hydration from store (satisfaction-skip path)

async function hydrateCarry(
  blockName: BlockName,
  block: Block,
  ctx: BlockContext,
  store: PhaseOutputStore,
): Promise<void> {
  const outputs = await latestPhaseOutputs(store, {
    id: ctx.targetId,
    type: ctx.targetType as 'brand' | 'submission',
  })

  for (const phase of block.phases) {
    const row = outputs.get(phase)
    if (!row?.output) continue
    const parsed = row.output as unknown as PhaseOutput
    if (parsed?.carry) {
      ctx.state[blockName] = parsed.carry
      break
    }
  }
}

// Post-run: record outputs, check postcondition, emit results

async function applyResult(
  blockName: BlockName,
  block: Block,
  ctx: BlockContext,
  result: BlockRunResult,
  env: BlockEnv,
): Promise<void> {
  if (result.output && block.phases.length > 0) {
    await recordPhaseOutputs(env.store, {
      jobId: env.jobId,
      target: {
        id: ctx.targetId,
        type: ctx.targetType as 'brand' | 'submission',
      },
      entries: block.phases.map((phase) => ({
        phase,
        status: result.exit ? result.exit.status : 'succeeded',
        output: result.output!,
      })),
    })
  }

  if (result.output?.carry) {
    ctx.state[blockName] = result.output.carry
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

  for (const phase of block.phases) {
    env.hooks.onPhaseResult?.(ctx, phase, {
      phase,
      status: 'succeeded',
      changedFields: Object.keys(result.output?.patch ?? {}),
      durationMs: 0,
    })
  }
}

function pushSkippedResults(
  block: Block,
  ctx: BlockContext,
  hooks: RunBlocksHooks,
): void {
  for (const phase of block.phases) {
    hooks.onPhaseResult?.(ctx, phase, {
      phase,
      status: 'skipped',
      changedFields: [],
      durationMs: 0,
    })
  }
}

function isBreaker(error: unknown): boolean {
  return error instanceof Error && error.name === 'LlmCircuitBreakerError'
}
