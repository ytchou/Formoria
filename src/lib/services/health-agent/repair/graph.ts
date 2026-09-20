/**
 * Repair agent — a LangGraph `StateGraph`.
 *
 * investigate → validate → resume | finalize
 *
 * The graph dispatches a Claude Code session to the repo worker for each
 * problem, validates the patch with lint/tsc/vitest, and optionally resumes
 * the same session once if validation fails. Two failed validations escalate
 * to `needs_human`.
 *
 * Follows `src/lib/services/enrich-phases/products/graph.ts`:
 * - `Annotation.Root` with a `lastValue` reducer
 * - `createRunContext` for mutable per-run state outside graph channels
 * - `GraphRecursionError` caught with `instanceof`
 * - `withNodeSpan('repair/<node>', …)` for every node
 * - Flat result with `agentOutcome` field
 *
 * deps = { runJob, fetchPrompt }
 *
 * No provider SDK and no LangChain chat model: the investigator is Claude
 * Code CLI dispatched through the repo worker; the prompt is fetched from
 * Langfuse by name.
 */

import { Annotation, END, START, StateGraph, GraphRecursionError } from '@langchain/langgraph'

import { withNodeSpan } from '@/lib/services/enrich-phases/agents/runtime'
import type { PromptMeta } from '@/lib/langfuse/prompt'
import type { ChangedFile } from '@/repo-worker/jobs'
import { MAX_REPAIR_CYCLES } from './budget'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Recursion limit. The longest path — investigate, validate, resume-investigate,
 * validate, finalize — is five nodes. Eight leaves a margin for conditional
 * routing without masking a stuck loop.
 */
export const HEALTH_REPAIR_RECURSION_LIMIT = 8

/** Maximum investigations per run. Matches grouping.ts. */
const _MAX_INVESTIGATIONS = 3

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

type RepairProblem = {
  fingerprint: string
  source: string
  title: string
  evidence: Record<string, unknown>
  changedFiles: string[]
  mergePolicy: 'automatic' | 'human'
}

export type RepairInput = {
  problems: RepairProblem[]
  ref: string
}

export type RepairOutput = {
  agentOutcome: 'patched' | 'noise' | 'needs_human' | 'fallback'
  changedFiles?: ChangedFile[]
  diagnosis?: string
  noiseReason?: string
  error?: string
  promptMeta?: { name: string; version: number; source: string }
  sessionId?: string
  decisions: Array<{ step: string; action: string; reason: string; ms: number }>
}

export type RepairDeps = {
  runJob: (request: Record<string, unknown>) => Promise<Record<string, unknown>>
  fetchPrompt: (
    name: string,
    variables?: Record<string, string>,
  ) => Promise<PromptMeta>
}

type RepairRunOptions = {
  signal?: AbortSignal
  deadlineMs?: number
}

// ---------------------------------------------------------------------------
// Graph state
// ---------------------------------------------------------------------------

function lastValue<T>(initial: () => T) {
  return Annotation<T>({ reducer: (_left: T, right: T) => right, default: initial })
}

const RepairState = Annotation.Root({
  /** Current Claude session ID for resume. */
  sessionId: lastValue<string | undefined>(() => undefined),
  /** Files changed by the investigator. */
  changedFiles: lastValue<ChangedFile[]>(() => []),
  /** Claude structured output from the investigator. */
  investigatorOutput: lastValue<Record<string, unknown> | null>(() => null),
  /** Number of validate cycles completed. */
  cyclesCompleted: lastValue<number>(() => 0),
  /** Whether the last validation passed. */
  validationPassed: lastValue<boolean>(() => false),
  /** Agent outcome. */
  agentOutcome: lastValue<RepairOutput['agentOutcome']>(() => 'patched'),
  /** Diagnosis text for needs_human. */
  diagnosis: lastValue<string | undefined>(() => undefined),
  /** Noise reason if the investigator declares the finding noise. */
  noiseReason: lastValue<string | undefined>(() => undefined),
  /** Error message. */
  error: lastValue<string | undefined>(() => undefined),
})

type RepairStateType = typeof RepairState.State
type RepairUpdate = Partial<RepairStateType>

// ---------------------------------------------------------------------------
// Run context — mutable per-run state outside graph channels
// ---------------------------------------------------------------------------

type RepairRunContext = {
  input: RepairInput
  deps: RepairDeps
  decisions: RepairOutput['decisions']
  promptMeta?: RepairOutput['promptMeta']
  wallClockStart: number
  signal: AbortSignal | undefined
  record: (step: string, action: string, reason: string, startedAt: number) => void
}

function createRunContext(
  input: RepairInput,
  deps: RepairDeps,
  options: RepairRunOptions = {},
): RepairRunContext {
  const ctx: RepairRunContext = {
    input,
    deps,
    decisions: [],
    wallClockStart: Date.now(),
    signal: options.signal,
    record(step, action, reason, startedAt) {
      ctx.decisions.push({ step, action, reason, ms: Date.now() - startedAt })
    },
  }
  return ctx
}

// ---------------------------------------------------------------------------
// Investigate node
// ---------------------------------------------------------------------------

function isClaudeAuthError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message.toLowerCase()
  return (
    msg.includes('401') ||
    msg.includes('unauthorized') ||
    msg.includes('invalid') && msg.includes('token') ||
    msg.includes('credential')
  )
}

async function investigateNode(
  ctx: RepairRunContext,
  state: RepairStateType,
): Promise<RepairUpdate> {
  const start = Date.now()

  // Fetch the investigator prompt from Langfuse
  const promptResult = await ctx.deps.fetchPrompt('health-investigator', {
    problems: JSON.stringify(ctx.input.problems),
  })
  ctx.promptMeta = promptResult.prompt

  const promptText = promptResult.text

  // Build the repair job request
  const request: Record<string, unknown> = {
    ref: ctx.input.ref,
    commands: [],
    editableFiles: ctx.input.problems.flatMap((p) => p.changedFiles),
    claude: {
      prompt: promptText,
      allowedTools: ['Read', 'Glob', 'Grep', 'Edit', 'Write'],
      maxTurns: 20,
      jsonSchema: {},
      ...(state.sessionId ? { resumeSessionId: state.sessionId } : {}),
    },
  }

  const jobResult = await ctx.deps.runJob(request)

  const claudeOutput = jobResult.claude as
    | { structuredOutput: unknown; sessionId?: string; costUsd?: number }
    | undefined

  const sessionId = claudeOutput?.sessionId ?? state.sessionId
  const changedFiles = (jobResult.changedFiles ?? []) as ChangedFile[]
  const structuredOutput = claudeOutput?.structuredOutput as Record<string, unknown> | null

  // Determine if the investigator declared this noise
  if (structuredOutput && isNoiseVerdict(structuredOutput)) {
    const noiseReason = extractNoiseReason(structuredOutput)
    ctx.record('investigate', 'noise', noiseReason, start)
    return {
      sessionId,
      changedFiles: [],
      investigatorOutput: structuredOutput,
      agentOutcome: 'noise',
      noiseReason,
    }
  }

  // Determine if there are changed files → a patch was produced
  if (changedFiles.length === 0 && !structuredOutput) {
    ctx.record('investigate', 'no_patch', 'investigator produced no changes', start)
    return {
      sessionId,
      changedFiles: [],
      investigatorOutput: null,
      agentOutcome: 'needs_human',
      diagnosis: 'Investigator produced no changes',
    }
  }

  ctx.record(
    'investigate',
    `patch with ${changedFiles.length} files`,
    sessionId ? `session=${sessionId}` : 'no session',
    start,
  )

  return {
    sessionId,
    changedFiles,
    investigatorOutput: structuredOutput,
  }
}

// ---------------------------------------------------------------------------
// Validate node
// ---------------------------------------------------------------------------

async function validateNode(
  ctx: RepairRunContext,
  state: RepairStateType,
): Promise<RepairUpdate> {
  const start = Date.now()

  const request: Record<string, unknown> = {
    ref: ctx.input.ref,
    commands: [
      { id: 'lint', run: 'pnpm lint', timeoutMs: 60_000 },
      { id: 'tsc', run: 'pnpm exec tsc --noEmit', timeoutMs: 120_000 },
      { id: 'vitest', run: 'pnpm exec vitest run --changed', timeoutMs: 180_000 },
    ],
    editableFiles: [],
  }

  const jobResult = await ctx.deps.runJob(request)
  const results = (jobResult.results ?? []) as Array<{
    id: string
    exitCode: number
    stdout: string
    stderr: string
  }>

  const failures = results
    .filter((r) => r.exitCode !== 0)
    .map((r) => r.id)

  const passed = failures.length === 0
  const cyclesCompleted = state.cyclesCompleted + 1

  ctx.record(
    'validate',
    passed ? 'passed' : 'failed',
    passed ? `cycle ${cyclesCompleted}` : `cycle ${cyclesCompleted}: ${failures.join(', ')}`,
    start,
  )

  return {
    validationPassed: passed,
    cyclesCompleted,
    ...(passed ? { agentOutcome: 'patched' as const } : {}),
    ...(!passed && cyclesCompleted >= MAX_REPAIR_CYCLES
      ? {
          agentOutcome: 'needs_human' as const,
          diagnosis: `Validation failed after ${cyclesCompleted} cycles: ${failures.join(', ')}`,
        }
      : {}),
  }
}

// ---------------------------------------------------------------------------
// Finalize node
// ---------------------------------------------------------------------------

function finalizeNode(
  ctx: RepairRunContext,
  state: RepairStateType,
): RepairUpdate {
  const start = Date.now()
  ctx.record(
    'finalize',
    state.agentOutcome,
    state.error ?? state.diagnosis ?? 'complete',
    start,
  )
  return {}
}

// ---------------------------------------------------------------------------
// Verdict helpers
// ---------------------------------------------------------------------------

function isNoiseVerdict(output: Record<string, unknown>): boolean {
  // The investigator returns needs_human with no changed files when it
  // determines the finding is noise (false positive).
  if (output.status === 'needs_human') {
    const findings = output.findings as Array<Record<string, unknown>> | undefined
    if (!findings || findings.length === 0) return true
    return findings.every((f) => f.status === 'needs_human')
  }
  return false
}

function extractNoiseReason(output: Record<string, unknown>): string {
  const findings = output.findings as Array<Record<string, unknown>> | undefined
  if (findings && findings.length > 0) {
    const summaries = findings
      .map((f) => f.summary)
      .filter((s): s is string => typeof s === 'string')
    if (summaries.length > 0) return summaries.join('; ')
  }
  return 'Investigator classified as noise'
}

// ---------------------------------------------------------------------------
// Graph assembly
// ---------------------------------------------------------------------------

/**
 * Build the compiled repair graph. Exported so tests can inspect the shape
 * without invoking it.
 */
export function buildRepairGraph(deps: RepairDeps) {
  // Create a minimal context for graph construction (nodes close over it later)
  const ctx = createRunContext({ problems: [], ref: 'staging' }, deps)
  return buildRepairGraphWithContext(ctx)
}

function buildRepairGraphWithContext(ctx: RepairRunContext) {
  return new StateGraph(RepairState)
    .addNode('investigate', (state) =>
      withNodeSpan('repair/investigate', () => investigateNode(ctx, state)),
    )
    .addNode('validate', (state) =>
      withNodeSpan('repair/validate', () => validateNode(ctx, state)),
    )
    .addNode('finalize', (state) =>
      withNodeSpan('repair/finalize', () => finalizeNode(ctx, state)),
    )
    .addEdge(START, 'investigate')
    .addConditionalEdges(
      'investigate',
      (state): 'validate' | 'finalize' => {
        // Noise or needs_human from investigate → skip validation
        if (state.agentOutcome === 'noise' || state.agentOutcome === 'needs_human') {
          return 'finalize'
        }
        return 'validate'
      },
      ['validate', 'finalize'],
    )
    .addConditionalEdges(
      'validate',
      (state): 'investigate' | 'finalize' => {
        if (state.validationPassed) return 'finalize'
        if (state.cyclesCompleted >= MAX_REPAIR_CYCLES) return 'finalize'
        // Resume investigation
        return 'investigate'
      },
      ['investigate', 'finalize'],
    )
    .addEdge('finalize', END)
    .compile()
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Run the repair agent for a set of problems. Never throws: every failure
 * path resolves to `fallback` or `needs_human`.
 */
export async function runRepairAgent(
  input: RepairInput,
  deps: RepairDeps,
  options: RepairRunOptions = {},
): Promise<RepairOutput> {
  const ctx = createRunContext(input, deps, options)

  if (options.signal?.aborted) {
    return {
      agentOutcome: 'fallback',
      error: 'aborted',
      decisions: ctx.decisions,
    }
  }

  try {
    const state = (await buildRepairGraphWithContext(ctx).invoke(
      {},
      {
        recursionLimit: HEALTH_REPAIR_RECURSION_LIMIT,
        ...(options.signal ? { signal: options.signal } : {}),
      },
    )) as RepairStateType

    return {
      agentOutcome: state.agentOutcome,
      ...(state.agentOutcome === 'patched' && state.changedFiles.length > 0
        ? { changedFiles: state.changedFiles }
        : {}),
      ...(state.diagnosis ? { diagnosis: state.diagnosis } : {}),
      ...(state.noiseReason ? { noiseReason: state.noiseReason } : {}),
      ...(state.error ? { error: state.error } : {}),
      ...(ctx.promptMeta ? { promptMeta: ctx.promptMeta } : {}),
      ...(state.sessionId ? { sessionId: state.sessionId } : {}),
      decisions: ctx.decisions,
    }
  } catch (error) {
    if (error instanceof GraphRecursionError) {
      ctx.record('graph', 'stopped', 'recursion_limit', ctx.wallClockStart)
      return {
        agentOutcome: 'fallback',
        error: 'recursion_limit',
        decisions: ctx.decisions,
      }
    }

    const aborted =
      options.signal?.aborted ||
      (error instanceof Error &&
        (error.name === 'AbortError' || error.name === 'TimeoutError'))
    if (aborted) {
      ctx.record('graph', 'stopped', 'aborted', ctx.wallClockStart)
      return {
        agentOutcome: 'fallback',
        error: 'aborted',
        decisions: ctx.decisions,
      }
    }

    // Claude auth error detection
    if (isClaudeAuthError(error)) {
      ctx.record('graph', 'stopped', 'credential:claude', ctx.wallClockStart)
      return {
        agentOutcome: 'fallback',
        error: 'credential:claude',
        decisions: ctx.decisions,
      }
    }

    // Unknown error — still never throw
    const message = error instanceof Error ? error.message : String(error)
    ctx.record('graph', 'stopped', message, ctx.wallClockStart)
    return {
      agentOutcome: 'fallback',
      error: message,
      decisions: ctx.decisions,
    }
  }
}
