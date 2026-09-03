/**
 * Editorial agent — a LangGraph `StateGraph`.
 *
 * descriptions → [listing gate] → stockists → faq → validate → (repair)? →
 * finalize
 *
 * This is a WRAPPER agent: the generate nodes call the existing phase functions
 * so their multi-step LLM flows and their DB writes (stockists rows, FAQ rows)
 * are untouched. What the graph adds on top is the cross-output pass — one code
 * validation over the combined patch and, when it finds something, ONE repair
 * turn. `repair` is reachable only from `validate` and leads straight to
 * `finalize`, so "at most one repair turn" is a property of the edges rather
 * than of a counter someone can forget to increment.
 *
 * Every dependency is injected through `EditorialDeps`, so the graph is
 * exercised end to end with fakes and no service mock
 * (`scripts/check-test-boundaries.mjs` refuses those). The real validators,
 * repair call and evidence tool live in `./validators.ts`; `buildEditorialDeps`
 * there is what the orchestrator wires in.
 */

import { Annotation, END, START, StateGraph, GraphRecursionError } from '@langchain/langgraph'
import type { PhaseResult } from '@/lib/types/curation'
import type { EnrichmentTarget } from '../../_shared/enrichment-target'
import type { EnrichBrand, EnrichPatch, EnrichPhase, EnrichScrapedData } from '../types'
import type { ListingVerdict, BrandFactsResult, BrandFactsAttempt } from '../../brand-facts'
import type { DescriptionRewriteResult, DescriptionAttempt } from '../../description-rewrite'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Super-step ceiling. The longest path — descriptions → stockists → faq →
 * validate → repair → finalize — is six steps; the slack backstops a future
 * node rather than licensing a loop, because no edge leads backwards.
 */
export const EDITORIAL_RECURSION_LIMIT = 8

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type EditorialInput = {
  brand: EnrichBrand
  phases: EnrichPhase[]
  scrapedData?: EnrichScrapedData | null
  serpSnippets: string[]
  overwrite?: boolean
  dryRun?: boolean
  target?: EnrichmentTarget
  jobId?: string
  pendingPatch?: EnrichPatch
  explicitPhases?: readonly string[]
}

export type CrossOutputFailure = {
  field: string
  reason: string
}

type DescriptionsPhaseOutput = {
  phaseResult: PhaseResult
  patch: Record<string, unknown>
  descriptionRewrite: DescriptionRewriteResult | null
  brandFacts: BrandFactsResult | null
  attempts: DescriptionAttempt[]
  factsAttempts: BrandFactsAttempt[]
  listingVerdict: ListingVerdict | null
}

type StockistsPhaseOutput = {
  phaseResult: PhaseResult
  patch: Record<string, unknown>
}

type FaqPhaseOutput = {
  phaseResult: PhaseResult
  patch: Record<string, unknown>
}

export type EditorialDeps = {
  runDescriptions: (input: EditorialInput) => Promise<DescriptionsPhaseOutput>
  runStockists: (input: EditorialInput) => Promise<StockistsPhaseOutput>
  runFaq: (input: EditorialInput) => Promise<FaqPhaseOutput>
  /** Cross-output validator: checks all outputs together for consistency issues. */
  validateCrossOutput: (patch: Record<string, unknown>, phaseResults: PhaseResult[]) => CrossOutputFailure[]
  /** One LLM repair call with cross-output failures. Returns only changed fields. */
  repairCrossOutput: (patch: Record<string, unknown>, failures: CrossOutputFailure[]) => Promise<Record<string, unknown>>
  /** Tool: returns a chunk of scraped text from the persisted evidence pack. */
  requestEvidence?: (pageUrl: string, query: string) => Promise<string>
}

export type EditorialRunOptions = {
  /** Wall-clock / caller abort. Threaded into `graph.invoke`. */
  signal?: AbortSignal
}

export type EditorialOutput = {
  agentOutcome: 'generated' | 'repaired' | 'fallback'
  phaseResults: PhaseResult[]
  patch: Record<string, unknown>
  listingVerdict: ListingVerdict | null
  descriptionRewrite: DescriptionRewriteResult | null
  brandFacts: BrandFactsResult | null
  attempts: DescriptionAttempt[]
  factsAttempts: BrandFactsAttempt[]
  decisions: Array<{ step: string; action: string; reason: string; ms: number }>
  error?: string
}

type Decision = EditorialOutput['decisions'][number]

// ---------------------------------------------------------------------------
// Graph state
// ---------------------------------------------------------------------------

/** Last-value channel: a node's update replaces the previous value. */
function lastValue<T>(initial: () => T) {
  return Annotation<T>({ reducer: (_left: T, right: T) => right, default: initial })
}

const EditorialState = Annotation.Root({
  phaseResults: lastValue<PhaseResult[]>(() => []),
  patch: lastValue<Record<string, unknown>>(() => ({})),
  listingVerdict: lastValue<ListingVerdict | null>(() => null),
  descriptionRewrite: lastValue<DescriptionRewriteResult | null>(() => null),
  brandFacts: lastValue<BrandFactsResult | null>(() => null),
  attempts: lastValue<DescriptionAttempt[]>(() => []),
  factsAttempts: lastValue<BrandFactsAttempt[]>(() => []),
  crossFailures: lastValue<CrossOutputFailure[]>(() => []),
  agentOutcome: lastValue<EditorialOutput['agentOutcome']>(() => 'generated'),
})

type EditorialStateType = typeof EditorialState.State

// ---------------------------------------------------------------------------
// Run context
// ---------------------------------------------------------------------------

/**
 * Mutable per-run state deliberately NOT held in graph channels.
 *
 * A throw inside a node unwinds out of `invoke()` with no final state. Without
 * this ledger the decision trace operators read, and everything the phases had
 * already produced, would be lost precisely on the runs worth diagnosing —
 * `lastKnown` is what keeps the fallback output as informative as today's.
 */
export type EditorialRunContext = {
  input: EditorialInput
  deps: EditorialDeps
  options: EditorialRunOptions
  decisions: Decision[]
  lastKnown: Partial<EditorialStateType>
  signal: AbortSignal | undefined
  record: (step: string, action: string, reason: string, startedAt: number) => void
  commit: (update: Partial<EditorialStateType>) => Partial<EditorialStateType>
}

export function createEditorialRunContext(
  input: EditorialInput,
  deps: EditorialDeps,
  options: EditorialRunOptions = {},
): EditorialRunContext {
  const ctx: EditorialRunContext = {
    input,
    deps,
    options,
    decisions: [],
    lastKnown: {},
    signal: options.signal,
    record(step, action, reason, startedAt) {
      ctx.decisions.push({ step, action, reason, ms: Date.now() - startedAt })
    },
    commit(update) {
      Object.assign(ctx.lastKnown, update)
      return update
    },
  }
  return ctx
}

function phaseReason(result: PhaseResult): string {
  return result.detail ?? result.error ?? 'ok'
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

/**
 * The facts, founding and listing-gate steps all live inside `runDescriptions`,
 * which is why this is one node rather than three: splitting them here would
 * fork the phase's own retry logic.
 */
async function descriptionsNode(
  state: EditorialStateType,
  ctx: EditorialRunContext,
): Promise<Partial<EditorialStateType>> {
  const start = Date.now()

  if (!ctx.input.phases.includes('descriptions')) {
    ctx.record('descriptions', 'skipped', 'not in phases', start)
    return {}
  }

  const result = await ctx.deps.runDescriptions(ctx.input)
  ctx.record('descriptions', result.phaseResult.status, phaseReason(result.phaseResult), start)

  return ctx.commit({
    phaseResults: [...state.phaseResults, result.phaseResult],
    patch: { ...state.patch, ...result.patch },
    listingVerdict: result.listingVerdict,
    descriptionRewrite: result.descriptionRewrite,
    brandFacts: result.brandFacts,
    attempts: result.attempts,
    factsAttempts: result.factsAttempts,
  })
}

/**
 * Listing gate: a submission the listing check rejected never reaches
 * publication, so stockists and FAQ would be pure waste. Approved brands log
 * and continue.
 */
function shouldStopAtListingGate(
  state: EditorialStateType,
  ctx: EditorialRunContext,
): boolean {
  if (state.listingVerdict?.verdict !== 'reject') return false
  const isSubmission =
    ctx.input.target?.type === 'submission' ||
    ctx.input.brand.status == null ||
    ctx.input.brand.status === ''
  return isSubmission
}

async function stockistsNode(
  state: EditorialStateType,
  ctx: EditorialRunContext,
): Promise<Partial<EditorialStateType>> {
  const start = Date.now()

  if (!ctx.input.phases.includes('stockists')) {
    ctx.record('stockists', 'skipped', 'not in phases', start)
    return {}
  }

  const result = await ctx.deps.runStockists(ctx.input)
  ctx.record('stockists', result.phaseResult.status, phaseReason(result.phaseResult), start)

  return ctx.commit({
    phaseResults: [...state.phaseResults, result.phaseResult],
    patch: { ...state.patch, ...result.patch },
  })
}

async function faqNode(
  state: EditorialStateType,
  ctx: EditorialRunContext,
): Promise<Partial<EditorialStateType>> {
  const start = Date.now()

  if (!ctx.input.phases.includes('faq')) {
    ctx.record('faq', 'skipped', 'not in phases', start)
    return {}
  }

  const result = await ctx.deps.runFaq(ctx.input)
  ctx.record('faq', result.phaseResult.status, phaseReason(result.phaseResult), start)

  return ctx.commit({
    phaseResults: [...state.phaseResults, result.phaseResult],
    patch: { ...state.patch, ...result.patch },
  })
}

/** Code validators over the combined patch. No model call happens here. */
function validateNode(
  state: EditorialStateType,
  ctx: EditorialRunContext,
): Partial<EditorialStateType> {
  const start = Date.now()
  const failures = ctx.deps.validateCrossOutput(state.patch, state.phaseResults)

  ctx.record(
    'validate',
    failures.length > 0 ? 'failures_found' : 'passed',
    failures.length > 0
      ? failures.map((failure) => `${failure.field}: ${failure.reason}`).join('; ')
      : 'all checks passed',
    start,
  )

  return ctx.commit({ crossFailures: failures })
}

/**
 * The one repair turn. Reached only through the branch out of `validate`, and
 * its only outgoing edge is `finalize` — the repaired patch is never
 * re-validated into a second turn.
 */
async function repairNode(
  state: EditorialStateType,
  ctx: EditorialRunContext,
): Promise<Partial<EditorialStateType>> {
  const start = Date.now()
  const repaired = await ctx.deps.repairCrossOutput(state.patch, state.crossFailures)

  ctx.record(
    'repair',
    `repaired ${Object.keys(repaired).length} field(s)`,
    state.crossFailures.map((failure) => failure.field).join(', '),
    start,
  )

  return ctx.commit({
    patch: { ...state.patch, ...repaired },
    agentOutcome: 'repaired',
  })
}

function finalizeNode(
  state: EditorialStateType,
  ctx: EditorialRunContext,
): Partial<EditorialStateType> {
  ctx.record('finalize', state.agentOutcome, `${state.phaseResults.length} phase result(s)`, Date.now())
  return {}
}

// ---------------------------------------------------------------------------
// Graph assembly
// ---------------------------------------------------------------------------

export function buildEditorialGraph(ctx: EditorialRunContext) {
  return new StateGraph(EditorialState)
    .addNode('descriptions', (state) => descriptionsNode(state, ctx))
    .addNode('stockists', (state) => stockistsNode(state, ctx))
    .addNode('faq', (state) => faqNode(state, ctx))
    .addNode('validate', (state) => validateNode(state, ctx))
    .addNode('repair', (state) => repairNode(state, ctx))
    .addNode('finalize', (state) => finalizeNode(state, ctx))
    .addEdge(START, 'descriptions')
    .addConditionalEdges(
      'descriptions',
      (state): 'stockists' | 'finalize' => {
        if (!shouldStopAtListingGate(state, ctx)) return 'stockists'
        ctx.record('listing_gate', 'rejected', 'submission listing verdict is reject', Date.now())
        return 'finalize'
      },
      ['stockists', 'finalize'],
    )
    .addEdge('stockists', 'faq')
    .addEdge('faq', 'validate')
    .addConditionalEdges(
      'validate',
      (state): 'repair' | 'finalize' =>
        state.crossFailures.length > 0 ? 'repair' : 'finalize',
      ['repair', 'finalize'],
    )
    .addEdge('repair', 'finalize')
    .addEdge('finalize', END)
    .compile()
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function outputFrom(
  state: Partial<EditorialStateType>,
  ctx: EditorialRunContext,
  overrides: Partial<EditorialOutput> = {},
): EditorialOutput {
  return {
    agentOutcome: state.agentOutcome ?? 'generated',
    phaseResults: state.phaseResults ?? [],
    patch: state.patch ?? {},
    listingVerdict: state.listingVerdict ?? null,
    descriptionRewrite: state.descriptionRewrite ?? null,
    brandFacts: state.brandFacts ?? null,
    attempts: state.attempts ?? [],
    factsAttempts: state.factsAttempts ?? [],
    decisions: ctx.decisions,
    ...overrides,
  }
}

function fallbackOutput(ctx: EditorialRunContext, error: string): EditorialOutput {
  return outputFrom(ctx.lastKnown, ctx, { agentOutcome: 'fallback', error })
}

/**
 * Runs the editorial agent for a single brand. Never throws: every failure path
 * resolves to `agentOutcome: 'fallback'` so `curation-operations` drops to the
 * individual phase calls rather than failing the target.
 *
 * `EDITORIAL_AGENT=off` short-circuits before the graph is built — the same
 * pattern as `ACQUISITION_AGENT` / `PRODUCTS_AGENT`.
 */
export async function runEditorialAgent(
  input: EditorialInput,
  deps: EditorialDeps,
  options: EditorialRunOptions = {},
): Promise<EditorialOutput> {
  const ctx = createEditorialRunContext(input, deps, options)

  if (process.env.EDITORIAL_AGENT === 'off') {
    return outputFrom({}, ctx, { agentOutcome: 'fallback' })
  }
  if (options.signal?.aborted) {
    return fallbackOutput(ctx, 'aborted')
  }

  try {
    const state = (await buildEditorialGraph(ctx).invoke(
      { agentOutcome: 'generated' },
      {
        recursionLimit: EDITORIAL_RECURSION_LIMIT,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      },
    )) as EditorialStateType

    return outputFrom(state, ctx)
  } catch (error) {
    if (error instanceof GraphRecursionError) {
      ctx.record('graph', 'stopped', 'recursion_limit', Date.now())
      return fallbackOutput(ctx, 'recursion_limit')
    }
    const aborted =
      options.signal?.aborted ||
      (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))
    if (aborted) {
      ctx.record('graph', 'stopped', 'aborted', Date.now())
      return fallbackOutput(ctx, 'aborted')
    }
    const message = error instanceof Error ? error.message : String(error)
    ctx.record('graph', 'threw', message.slice(0, 160), Date.now())
    return fallbackOutput(ctx, message)
  }
}
