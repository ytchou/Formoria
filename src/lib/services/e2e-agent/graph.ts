/**
 * E2E self-heal LangGraph — orchestrates the self-heal loop:
 *
 *   freeze → diagnose → repair → validate → report
 *
 * Follows the codebase's LangGraph pattern:
 * - `Annotation.Root` with `lastValue` reducers
 * - Run context captured in closure, not in graph channels
 * - `withNodeSpan` for every node
 * - `GraphRecursionError` caught — never throws
 *
 * Conditional edges:
 *   START → freeze
 *   freeze → diagnose
 *   diagnose → (noise/fallback → report, actionable → repair)
 *   repair → (no changes → report, has changes → validate)
 *   validate → (pass → report, fail + cycles < 2 → diagnose, fail + cycles ≥ 2 → report)
 *   report → END
 */

import {
  Annotation,
  END,
  START,
  StateGraph,
  GraphRecursionError,
} from '@langchain/langgraph'

import { withNodeSpan } from '@/lib/tracing/span'
import { freezeFailures as freezeModule } from './freeze'
import { diagnoseFailures } from './diagnose'
import { repairFailures } from './repair'
import { reportOutcome } from './report'

import type { RunResult as FreezeRunResult } from './freeze'
import type { DiagnoseOutcome } from './diagnose'
import type { RepairOutcome } from './repair'
import type { FrozenFailureSet } from '@/lib/services/e2e-selfheal/incident'
import type { RepoWorkerClient } from '@/lib/services/health-agent/repo-worker-client'
import type { ChangedFile } from '@/repo-worker/jobs'
import type {
  FrozenFailure as TypesFrozenFailure,
  RepairResult as TypesRepairResult,
  RunOutcome,
} from './types'
import type { PublishInput, PublishResult } from '@/lib/adapters/github/app-publish'
import type { TicketSpec, TicketResult } from '@/lib/adapters/linear/create-ticket'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Recursion limit. The longest path — freeze, diagnose, repair, validate,
 * diagnose, repair, validate, report — is 8 nodes.
 */
export const RECURSION_LIMIT = 12

/** Maximum diagnose→repair→validate cycles before escalating to needs_human. */
const MAX_CYCLES = 2

// ---------------------------------------------------------------------------
// DI deps
// ---------------------------------------------------------------------------

export type E2eSelfHealDeps = {
  createClient: (deadlineMs: number) => RepoWorkerClient
  fetchPrompt: (name: string) => Promise<string>
  publish: (input: PublishInput) => Promise<PublishResult>
  createTicket: (spec: TicketSpec) => Promise<TicketResult>
  postSlackMessage: (params: {
    channel: string
    text: string
    blocks?: Record<string, unknown>[]
    threadTs?: string
  }) => Promise<{ ok: boolean; ts?: string; error?: string }>
  cloneAndRunTests: (opts: {
    changedFiles: ChangedFile[]
    baseSha: string
    specFiles: string[]
  }) => Promise<{ passed: boolean; output: string }>
}

// ---------------------------------------------------------------------------
// Input / Result
// ---------------------------------------------------------------------------

export type SelfHealInput = {
  runResult: FreezeRunResult
  runId: string
  stagingSha: string
}

export type SelfHealResult = {
  outcome: RunOutcome
  cycle: number
}

// ---------------------------------------------------------------------------
// Graph state
// ---------------------------------------------------------------------------

function lastValue<T>(initial: () => T) {
  return Annotation<T>({
    reducer: (_left: T, right: T) => right,
    default: initial,
  })
}

const SelfHealState = Annotation.Root({
  frozenFailures: lastValue<FrozenFailureSet | null>(() => null),
  diagnosis: lastValue<DiagnoseOutcome | null>(() => null),
  repairResult: lastValue<RepairOutcome | null>(() => null),
  validation: lastValue<{ passed: boolean; output: string } | null>(
    () => null,
  ),
  outcome: lastValue<RunOutcome>(() => 'green'),
  cycle: lastValue<number>(() => 0),
})

type SelfHealStateType = typeof SelfHealState.State
type SelfHealUpdate = Partial<SelfHealStateType>

// ---------------------------------------------------------------------------
// Run context — captured in closure, not in graph channels
// ---------------------------------------------------------------------------

type SelfHealRunContext = {
  input: SelfHealInput
  deps: E2eSelfHealDeps
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

function freezeNode(ctx: SelfHealRunContext): SelfHealUpdate {
  const frozen = freezeModule(ctx.input.runResult)
  return { frozenFailures: frozen }
}

async function diagnoseNode(
  ctx: SelfHealRunContext,
  state: SelfHealStateType,
): Promise<SelfHealUpdate> {
  const result = await diagnoseFailures({
    createClient: ctx.deps.createClient,
    failures: state.frozenFailures!,
    fetchPrompt: ctx.deps.fetchPrompt,
    stagingSha: ctx.input.stagingSha,
  })

  if (!result) {
    return { diagnosis: null, outcome: 'fallback' as RunOutcome }
  }

  if (result.aggregate === 'noise') {
    return { diagnosis: result, outcome: 'noise' as RunOutcome }
  }

  return { diagnosis: result }
}

async function repairNode(
  ctx: SelfHealRunContext,
  state: SelfHealStateType,
): Promise<SelfHealUpdate> {
  const result = await repairFailures({
    createClient: ctx.deps.createClient,
    failures: state.frozenFailures!,
    diagnosis: state.diagnosis!.diagnosis,
    fetchPrompt: ctx.deps.fetchPrompt,
    stagingSha: ctx.input.stagingSha,
  })

  if (result.changedFiles.length === 0) {
    return { repairResult: result, outcome: 'needs_human' as RunOutcome }
  }

  return { repairResult: result }
}

async function validateNode(
  ctx: SelfHealRunContext,
  state: SelfHealStateType,
): Promise<SelfHealUpdate> {
  const repair = state.repairResult!
  const specFiles = [
    ...new Set(
      (state.frozenFailures?.failures ?? [])
        .map((f) => f.file)
        .filter((f): f is string => f !== null),
    ),
  ]

  const result = await ctx.deps.cloneAndRunTests({
    changedFiles: repair.changedFiles,
    baseSha: repair.baseSha ?? ctx.input.stagingSha,
    specFiles,
  })

  const cycle = state.cycle + 1

  if (result.passed) {
    return { validation: result, outcome: 'patched' as RunOutcome, cycle }
  }

  if (cycle >= MAX_CYCLES) {
    return { validation: result, outcome: 'needs_human' as RunOutcome, cycle }
  }

  return { validation: result, cycle }
}

async function reportNode(
  ctx: SelfHealRunContext,
  state: SelfHealStateType,
): Promise<SelfHealUpdate> {
  // Map incident.ts FrozenFailures → types.ts FrozenFailures for report
  const frozenFailures: TypesFrozenFailure[] = (
    state.frozenFailures?.failures ?? []
  ).map((f) => ({
    file: f.file ?? '(global)',
    title: f.title,
    error: f.reason ?? '',
    fingerprint: f.id,
  }))

  // Map RepairOutcome → types.ts RepairResult if there are changed files
  let repair: TypesRepairResult | undefined
  if (state.repairResult && state.repairResult.changedFiles.length > 0) {
    repair = {
      changedFiles: state.repairResult.changedFiles,
      branch: `e2e-selfheal/${ctx.input.runId}`,
      baseSha: state.repairResult.baseSha ?? ctx.input.stagingSha,
    }
  }

  await reportOutcome({
    publish: ctx.deps.publish,
    createTicket: ctx.deps.createTicket,
    postSlackMessage: ctx.deps.postSlackMessage,
    outcome: state.outcome,
    repair,
    frozenFailures,
    runId: ctx.input.runId,
    stagingSha: ctx.input.stagingSha,
  })

  return {}
}

// ---------------------------------------------------------------------------
// Graph assembly
// ---------------------------------------------------------------------------

function assembleGraph(ctx: SelfHealRunContext) {
  return new StateGraph(SelfHealState)
    .addNode('freeze', () =>
      withNodeSpan('e2e-selfheal/freeze', () => freezeNode(ctx)),
    )
    .addNode('diagnose', (state) =>
      withNodeSpan('e2e-selfheal/diagnose', () => diagnoseNode(ctx, state)),
    )
    .addNode('repair', (state) =>
      withNodeSpan('e2e-selfheal/repair', () => repairNode(ctx, state)),
    )
    .addNode('validate', (state) =>
      withNodeSpan('e2e-selfheal/validate', () => validateNode(ctx, state)),
    )
    .addNode('report', (state) =>
      withNodeSpan('e2e-selfheal/report', () => reportNode(ctx, state)),
    )
    .addEdge(START, 'freeze')
    .addEdge('freeze', 'diagnose')
    .addConditionalEdges(
      'diagnose',
      (state): 'repair' | 'report' => {
        if (state.outcome === 'noise' || state.outcome === 'fallback') {
          return 'report'
        }
        return 'repair'
      },
      ['repair', 'report'],
    )
    .addConditionalEdges(
      'repair',
      (state): 'validate' | 'report' => {
        if (state.outcome === 'needs_human') return 'report'
        return 'validate'
      },
      ['validate', 'report'],
    )
    .addConditionalEdges(
      'validate',
      (state): 'diagnose' | 'report' => {
        if (state.outcome === 'patched' || state.outcome === 'needs_human') {
          return 'report'
        }
        return 'diagnose'
      },
      ['diagnose', 'report'],
    )
    .addEdge('report', END)
    .compile()
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Build the compiled graph for shape inspection (tests).
 * Do not invoke the returned graph directly — use `runSelfHealGraph`.
 */
export function buildSelfHealGraph(deps: E2eSelfHealDeps) {
  const ctx: SelfHealRunContext = {
    input: { runResult: { failures: [] }, runId: '', stagingSha: '' },
    deps,
  }
  return assembleGraph(ctx)
}

/**
 * Create the self-heal graph and return a runner.
 */
export function createSelfHealGraph(deps: E2eSelfHealDeps) {
  return {
    invoke: (input: SelfHealInput) => runSelfHealGraph(input, deps),
  }
}

/**
 * Run the full self-heal loop. Never throws — every error path returns a
 * typed outcome in the result.
 */
export async function runSelfHealGraph(
  input: SelfHealInput,
  deps: E2eSelfHealDeps,
): Promise<SelfHealResult> {
  const ctx: SelfHealRunContext = { input, deps }

  try {
    const state = (await assembleGraph(ctx).invoke(
      {},
      { recursionLimit: RECURSION_LIMIT },
    )) as SelfHealStateType

    return { outcome: state.outcome, cycle: state.cycle }
  } catch (error) {
    if (error instanceof GraphRecursionError) {
      console.error('[e2e-selfheal] graph recursion limit hit')
      return { outcome: 'fallback', cycle: 0 }
    }

    console.error('[e2e-selfheal] graph error:', error)
    return { outcome: 'fallback', cycle: 0 }
  }
}
