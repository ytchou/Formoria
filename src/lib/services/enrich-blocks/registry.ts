/**
 * Block registry: type definitions for the enrichment block DAG and a factory
 * to build a typed registry from injected block implementations.
 *
 * Blocks are the coarser scheduling unit above phases. The DAG runner
 * (runner.ts) executes them in BLOCK_ORDER, alternating between chunk-scope
 * barriers and per-brand fan-out.
 */

import type { BlockName, EnrichPhaseName } from '@/lib/constants/enrich-phases'
import type { PhaseResult } from '@/lib/types/curation'
import type { PhaseOutput, PhaseOutputRow } from './phase-outputs'
import type { TargetPlan } from './plan'

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

type BlockExit = {
  status: 'skipped' | 'failed'
  phaseResult: PhaseResult
  error?: Error
}

export type BlockRunResult = {
  /** A single-phase block may return its output directly. */
  output?: PhaseOutput
  phaseOutputs?: Array<{ phaseResult: PhaseResult; output: PhaseOutput }>
  exit?: BlockExit
}

export type BlockContext = {
  brandId: string
  targetId: string
  targetType: string
  plan?: TargetPlan
  executePhases?: EnrichPhaseName[]
  checkpoints?: Map<string, PhaseOutputRow>
  phaseOutputs?: Map<string, PhaseOutput>
  /** Shared mutable state for this target across all blocks. */
  state: Record<string, unknown>
}

type BlockConditions = {
  phases: readonly EnrichPhaseName[]
  requiredBy?: readonly EnrichPhaseName[]
  inputError?: (ctx: BlockContext) => string | undefined
  precondition?: (ctx: BlockContext) => boolean | Promise<boolean>
  postcondition?: (
    ctx: BlockContext,
    result: BlockRunResult,
  ) => BlockExit | undefined
}

export type BrandBlock = BlockConditions & {
  scope: 'brand'
  run: (ctx: BlockContext) => Promise<BlockRunResult>
}

export type BatchBlock = BlockConditions & {
  scope: 'chunk'
  runBatch: (contexts: BlockContext[]) => Promise<Map<string, BlockRunResult>>
}

export type Block = BrandBlock | BatchBlock

export type BlockRegistry = Record<BlockName, Block>

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a block registry from a complete set of block implementations.
 * Task 7 calls this with closures over the existing phase runners.
 */
export function buildBlockRegistry(
  deps: Record<BlockName, Block>,
): BlockRegistry {
  return deps
}
