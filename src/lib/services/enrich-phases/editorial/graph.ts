/**
 * Editorial agent graph. Wraps the per-brand editorial phases (descriptions,
 * stockists, faq) into a unified flow: generate → validate → repair → finalize.
 *
 * This is a WRAPPER agent — graph nodes call existing phase functions,
 * preserving their multi-step LLM flows. DB writes for stockists and faq
 * happen inside their respective phase functions.
 *
 * All phase runners are injected via `EditorialDeps` so the graph is fully
 * testable with fakes.
 */

import type { PhaseResult } from '@/lib/types/curation'
import type { EnrichmentTarget } from '../../_shared/enrichment-target'
import type { EnrichBrand, EnrichPatch, EnrichPhase, EnrichScrapedData } from '../types'
import type { ListingVerdict, BrandFactsResult, BrandFactsAttempt } from '../../brand-facts'
import type { DescriptionRewriteResult, DescriptionAttempt } from '../../description-rewrite'

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

type CrossOutputFailure = {
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

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

type GraphState = {
  input: EditorialInput
  phaseResults: PhaseResult[]
  patch: Record<string, unknown>
  listingVerdict: ListingVerdict | null
  descriptionRewrite: DescriptionRewriteResult | null
  brandFacts: BrandFactsResult | null
  attempts: DescriptionAttempt[]
  factsAttempts: BrandFactsAttempt[]
  crossFailures: CrossOutputFailure[]
  agentOutcome: EditorialOutput['agentOutcome']
  decisions: EditorialOutput['decisions']
  error?: string
}

function emptyState(input: EditorialInput): GraphState {
  return {
    input,
    phaseResults: [],
    patch: {},
    listingVerdict: null,
    descriptionRewrite: null,
    brandFacts: null,
    attempts: [],
    factsAttempts: [],
    crossFailures: [],
    agentOutcome: 'generated',
    decisions: [],
  }
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

/**
 * Node 1-3: factsNode + foundingNode + listingGateNode are all inside
 * `runDescriptions`, which calls extractBrandFacts, researchFoundingFacts,
 * and checks the listing verdict internally. We delegate to the dep directly.
 */
async function descriptionsNode(
  state: GraphState,
  deps: EditorialDeps,
): Promise<GraphState> {
  const start = Date.now()

  if (!state.input.phases.includes('descriptions')) {
    return {
      ...state,
      decisions: [...state.decisions, {
        step: 'descriptions',
        action: 'skipped',
        reason: 'not in phases',
        ms: Date.now() - start,
      }],
    }
  }

  const result = await deps.runDescriptions(state.input)

  return {
    ...state,
    phaseResults: [...state.phaseResults, result.phaseResult],
    patch: { ...state.patch, ...result.patch },
    listingVerdict: result.listingVerdict,
    descriptionRewrite: result.descriptionRewrite,
    brandFacts: result.brandFacts,
    attempts: result.attempts,
    factsAttempts: result.factsAttempts,
    decisions: [...state.decisions, {
      step: 'descriptions',
      action: result.phaseResult.status,
      reason: result.phaseResult.detail ?? result.phaseResult.error ?? 'ok',
      ms: Date.now() - start,
    }],
  }
}

/**
 * Listing gate: if listing verdict = reject on a submission, early return.
 * Approved brands log only and continue.
 */
function shouldStopAtListingGate(state: GraphState): boolean {
  if (state.listingVerdict?.verdict !== 'reject') return false
  // Submissions are rejected; approved brands continue
  const isSubmission = state.input.target?.type === 'submission' ||
    state.input.brand.status == null ||
    state.input.brand.status === ''
  return isSubmission
}

/** Node 5: stockists phase — calls existing runStockistsPhase. */
async function stockistsNode(
  state: GraphState,
  deps: EditorialDeps,
): Promise<GraphState> {
  const start = Date.now()

  if (!state.input.phases.includes('stockists')) {
    return {
      ...state,
      decisions: [...state.decisions, {
        step: 'stockists',
        action: 'skipped',
        reason: 'not in phases',
        ms: Date.now() - start,
      }],
    }
  }

  const result = await deps.runStockists(state.input)

  return {
    ...state,
    phaseResults: [...state.phaseResults, result.phaseResult],
    patch: { ...state.patch, ...result.patch },
    decisions: [...state.decisions, {
      step: 'stockists',
      action: result.phaseResult.status,
      reason: result.phaseResult.detail ?? result.phaseResult.error ?? 'ok',
      ms: Date.now() - start,
    }],
  }
}

/** Node 6: faq phase — calls existing runFaqPhase. */
async function faqNode(
  state: GraphState,
  deps: EditorialDeps,
): Promise<GraphState> {
  const start = Date.now()

  if (!state.input.phases.includes('faq')) {
    return {
      ...state,
      decisions: [...state.decisions, {
        step: 'faq',
        action: 'skipped',
        reason: 'not in phases',
        ms: Date.now() - start,
      }],
    }
  }

  const result = await deps.runFaq(state.input)

  return {
    ...state,
    phaseResults: [...state.phaseResults, result.phaseResult],
    patch: { ...state.patch, ...result.patch },
    decisions: [...state.decisions, {
      step: 'faq',
      action: result.phaseResult.status,
      reason: result.phaseResult.detail ?? result.phaseResult.error ?? 'ok',
      ms: Date.now() - start,
    }],
  }
}

/** Node 7: cross-output validation on ALL outputs. */
function validateNode(
  state: GraphState,
  deps: EditorialDeps,
): GraphState {
  const start = Date.now()
  const failures = deps.validateCrossOutput(state.patch, state.phaseResults)

  return {
    ...state,
    crossFailures: failures,
    decisions: [...state.decisions, {
      step: 'validate',
      action: failures.length > 0 ? 'failures_found' : 'passed',
      reason: failures.length > 0
        ? failures.map((f) => `${f.field}: ${f.reason}`).join('; ')
        : 'all checks passed',
      ms: Date.now() - start,
    }],
  }
}

/** Node 8: one repair LLM call with cross-output failures. Runs at most once. */
async function repairNode(
  state: GraphState,
  deps: EditorialDeps,
): Promise<GraphState> {
  const start = Date.now()

  if (state.crossFailures.length === 0) return state

  const repaired = await deps.repairCrossOutput(state.patch, state.crossFailures)

  return {
    ...state,
    patch: { ...state.patch, ...repaired },
    agentOutcome: 'repaired',
    decisions: [...state.decisions, {
      step: 'repair',
      action: `repaired ${Object.keys(repaired).length} field(s)`,
      reason: state.crossFailures.map((f) => f.field).join(', '),
      ms: Date.now() - start,
    }],
  }
}

/** Node 9: finalize — build the output. */
function finalizeNode(state: GraphState): EditorialOutput {
  return {
    agentOutcome: state.agentOutcome,
    phaseResults: state.phaseResults,
    patch: state.patch,
    listingVerdict: state.listingVerdict,
    descriptionRewrite: state.descriptionRewrite,
    brandFacts: state.brandFacts,
    attempts: state.attempts,
    factsAttempts: state.factsAttempts,
    decisions: state.decisions,
    error: state.error,
  }
}

// ---------------------------------------------------------------------------
// Graph orchestration
// ---------------------------------------------------------------------------

/**
 * Runs the editorial agent for a single brand. Linear state machine:
 * descriptions → [listing gate] → stockists → faq → validate → repair → finalize.
 *
 * When EDITORIAL_AGENT=off, returns a fallback output so the caller falls
 * through to existing individual phase calls.
 */
export async function runEditorialAgent(
  input: EditorialInput,
  deps: EditorialDeps,
): Promise<EditorialOutput> {
  // Env gate: same pattern as ACQUISITION_AGENT / PRODUCTS_AGENT
  if (process.env.EDITORIAL_AGENT === 'off') {
    return {
      agentOutcome: 'fallback',
      phaseResults: [],
      patch: {},
      listingVerdict: null,
      descriptionRewrite: null,
      brandFacts: null,
      attempts: [],
      factsAttempts: [],
      decisions: [],
    }
  }

  let state = emptyState(input)

  try {
    // 1-3. Descriptions (includes facts, founding, listing gate internally)
    state = await descriptionsNode(state, deps)

    // 4. Listing gate — reject submissions early
    if (shouldStopAtListingGate(state)) {
      state.decisions.push({
        step: 'listing_gate',
        action: 'rejected',
        reason: 'submission listing verdict is reject',
        ms: 0,
      })
      return finalizeNode(state)
    }

    // 5. Stockists
    state = await stockistsNode(state, deps)

    // 6. FAQ
    state = await faqNode(state, deps)

    // 7. Validate cross-output
    state = validateNode(state, deps)

    // 8. Repair (at most once)
    if (state.crossFailures.length > 0) {
      state = await repairNode(state, deps)
    }

    // 9. Finalize
    return finalizeNode(state)
  } catch (err) {
    return {
      agentOutcome: 'fallback',
      phaseResults: state.phaseResults,
      patch: state.patch,
      listingVerdict: state.listingVerdict,
      descriptionRewrite: state.descriptionRewrite,
      brandFacts: state.brandFacts,
      attempts: state.attempts,
      factsAttempts: state.factsAttempts,
      decisions: state.decisions,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
