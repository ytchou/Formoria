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
import type { PhaseOutput } from './phase-outputs'

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/** chunk = barrier (run once for the whole chunk); brand = per-context fan-out */
export type BlockScope = 'chunk' | 'brand'

export type BlockExit = {
  status: 'skipped' | 'failed'
  phaseResult: PhaseResult
  error?: Error
}

export type BlockRunResult = {
  output?: PhaseOutput
  exit?: BlockExit
}

export type BlockContext = {
  brandId: string
  targetId: string
  targetType: string
  /** Shared mutable state for this target across all blocks. */
  state: Record<string, unknown>
}

export type Block = {
  scope: BlockScope
  phases: readonly EnrichPhaseName[]
  run: (ctx: BlockContext) => Promise<BlockRunResult>
  precondition?: (ctx: BlockContext) => boolean | Promise<boolean>
  postcondition?: (
    ctx: BlockContext,
    result: BlockRunResult,
  ) => BlockExit | undefined
}

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
