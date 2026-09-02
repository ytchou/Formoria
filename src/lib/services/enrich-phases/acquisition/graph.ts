/**
 * Acquisition agent graph. Orchestrates the gather → plan → execute → critique
 * → recover → finalize flow using LangGraph's StateGraph.
 *
 * All external dependencies (fetch, render, search, scrape, model) are injected
 * so the graph is fully testable with fakes.
 */

import { HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import type { Runnable } from '@langchain/core/runnables'
import { fetchLangfusePrompt } from '@/lib/langfuse/prompt'
import type { FetchMetadata } from '../scraper/fetch-guards'
import type { RenderProvider } from '../scraper/render/types'
import type { MultiScrapeResult, ScrapeBrandUrlsOptions } from '../scraper/index'
import type { SurfaceDirective } from '../scraper/strategies/types'
import type { EnrichBrand } from '../types'
import {
  AcquisitionPlan,
  CritiqueVerdictSchema,
  planToDirectives,
  boundedPlan,
  type AcquisitionPlanType,
  type CritiqueVerdict,
} from './plan'
import {
  budgetFor,
  assertBudget,
  type AcquisitionBudget,
  type BudgetState,
  type EvidencePack,
  type ProbeResult,
} from './budget'
import type { SearchResult } from './tools'
import { invokeAudited, type AuditBridgeContext } from './audit-bridge'
import {
  ACQUISITION_PLAN_SYSTEM_PROMPT,
  ACQUISITION_CRITIQUE_SYSTEM_PROMPT,
} from '@/lib/prompts/acquisition'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AcquisitionInput = {
  brand: Pick<EnrichBrand, 'id' | 'slug' | 'name'>
  knownUrls: string[]
  jobId?: string
}

export type AcquisitionOutput = {
  agentOutcome: 'planned' | 'recovered' | 'fallback' | 'blocked'
  plan?: AcquisitionPlanType
  directives?: Map<string, SurfaceDirective>
  scrapeResult?: MultiScrapeResult
  budget?: { allowed: AcquisitionBudget; used: AcquisitionBudget }
  decisions: Array<{ step: string; action: string; reason: string; ms: number }>
  error?: string
}

export type AcquisitionDeps = {
  fetchHtml: (url: string) => Promise<FetchMetadata>
  renderProvider?: RenderProvider
  searchBrand: (query: string) => Promise<SearchResult>
  scrapeBrandUrls: (urls: string[], options: ScrapeBrandUrlsOptions) => Promise<MultiScrapeResult>
}

type RunOptions = {
  model?: Runnable
  signal?: AbortSignal
  /**
   * When present, every model turn goes through the audit bridge (auditedCall
   * span + brand_ai_results row + Langfuse generation). Absent in unit tests,
   * where the scripted model is invoked directly.
   */
  audit?: Omit<AuditBridgeContext, 'phase'> & { phase?: string }
  /** Test-only: override the computed budget to force edge-case paths. */
  budgetOverride?: AcquisitionBudget
}

type ModelResponse = { content: unknown }

async function callModel(
  model: Runnable,
  messages: BaseMessage[],
  options: RunOptions,
): Promise<ModelResponse> {
  if (!options.audit) return (await model.invoke(messages)) as ModelResponse
  return (await invokeAudited(
    model as unknown as Parameters<typeof invokeAudited>[0],
    messages,
    { ...options.audit, phase: options.audit.phase ?? 'acquisition' },
  )) as ModelResponse
}

// Models sometimes wrap JSON in a ```json fence even under json_object mode.
function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  return (fenced?.[1] ?? text).trim()
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

type GraphState = {
  input: AcquisitionInput
  probeResults: ProbeResult[]
  budget: BudgetState
  plan: AcquisitionPlanType | null
  planAttempts: number
  directives: Map<string, SurfaceDirective>
  scrapeResult: MultiScrapeResult | null
  verdict: CritiqueVerdict | null
  recoveryDone: boolean
  agentOutcome: AcquisitionOutput['agentOutcome']
  decisions: AcquisitionOutput['decisions']
  error?: string
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

async function gatherNode(
  state: GraphState,
  deps: AcquisitionDeps,
): Promise<GraphState> {
  const start = Date.now()
  const probeResults: ProbeResult[] = []

  // Probe known URLs with bounded concurrency (≤4)
  const urls = state.input.knownUrls.slice(0, 6)
  const batches: string[][] = []
  for (let i = 0; i < urls.length; i += 4) {
    batches.push(urls.slice(i, i + 4))
  }

  for (const batch of batches) {
    const results = await Promise.allSettled(
      batch.map(async (url) => {
        const result = await deps.fetchHtml(url)
        const text = result.text ?? ''
        const bodyText = text.replace(/<[^>]*>/gu, '').replace(/\s+/gu, ' ').trim()
        return {
          url,
          textLength: bodyText.length,
          needsRendering: !text.trim() || (bodyText.length < 20 && text.includes('<script')),
        }
      }),
    )
    for (const r of results) {
      if (r.status === 'fulfilled') probeResults.push(r.value)
    }
  }

  // Compute budget from evidence
  const pack: EvidencePack = {
    knownUrls: state.input.knownUrls,
    probeResults,
  }
  const allowed = budgetFor(pack)
  const budget: BudgetState = {
    allowed,
    used: { probes: probeResults.length, renders: 0, search: 0, turns: 0, wallClockMs: 0 },
  }

  return {
    ...state,
    probeResults,
    budget,
    decisions: [
      ...state.decisions,
      {
        step: 'gather',
        action: `probed ${probeResults.length} URLs`,
        reason: `${probeResults.filter((r) => r.needsRendering).length} need rendering`,
        ms: Date.now() - start,
      },
    ],
  }
}

async function planNode(
  state: GraphState,
  model: Runnable,
  options: RunOptions = {},
): Promise<GraphState> {
  const start = Date.now()

  try {
    assertBudget(state.budget, 'turns')
  } catch {
    return { ...state, agentOutcome: 'fallback', error: 'budget_exhausted_before_plan' }
  }

  const systemPrompt = await fetchLangfusePrompt(
    'acquisition-plan',
    ACQUISITION_PLAN_SYSTEM_PROMPT,
  )

  const userContent = JSON.stringify({
    brand: state.input.brand,
    knownUrls: state.input.knownUrls,
    probeResults: state.probeResults,
    budget: state.budget.allowed,
  })

  const messages: BaseMessage[] = [
    new SystemMessage(systemPrompt),
    new HumanMessage(userContent),
  ]

  const response = await callModel(model, messages, options)
  state.budget.used.turns++

  // Parse the plan from the model response
  const content = typeof response.content === 'string'
    ? response.content
    : JSON.stringify(response.content)

  let parsed: unknown
  try {
    parsed = JSON.parse(extractJson(content))
  } catch {
    return {
      ...state,
      planAttempts: state.planAttempts + 1,
      decisions: [...state.decisions, {
        step: 'plan',
        action: 'parse_failed',
        reason: 'model returned non-JSON',
        ms: Date.now() - start,
      }],
    }
  }

  const result = AcquisitionPlan.safeParse(parsed)
  if (!result.success) {
    return {
      ...state,
      planAttempts: state.planAttempts + 1,
      decisions: [...state.decisions, {
        step: 'plan',
        action: 'validation_failed',
        reason: result.error.message.slice(0, 200),
        ms: Date.now() - start,
      }],
    }
  }

  const plan = boundedPlan(result.data)
  const directives = planToDirectives(plan)

  return {
    ...state,
    plan,
    directives,
    decisions: [...state.decisions, {
      step: 'plan',
      action: 'plan_created',
      reason: `${plan.surfaces.length} surfaces, ${plan.fanOut.length} fanOut`,
      ms: Date.now() - start,
    }],
  }
}

async function executeNode(
  state: GraphState,
  deps: AcquisitionDeps,
): Promise<GraphState> {
  const start = Date.now()
  if (!state.plan) return state

  const urls = state.plan.surfaces
    .filter((s) => s.fetch !== 'skip')
    .map((s) => s.url)

  const scrapeResult = await deps.scrapeBrandUrls(urls, {
    directives: state.directives,
    renderProvider: deps.renderProvider,
    brandName: state.input.brand.name,
  })

  return {
    ...state,
    scrapeResult,
    decisions: [...state.decisions, {
      step: 'execute',
      action: `scraped ${urls.length} URLs`,
      reason: `${scrapeResult.statuses.filter((s) => s.ok).length} succeeded`,
      ms: Date.now() - start,
    }],
  }
}

async function critiqueNode(
  state: GraphState,
  model: Runnable,
  options: RunOptions = {},
): Promise<GraphState> {
  const start = Date.now()

  try {
    assertBudget(state.budget, 'turns')
  } catch {
    // If budget exhausted at critique, accept what we have
    return {
      ...state,
      verdict: { verdict: 'sufficient', reason: 'budget exhausted, accepting results' },
    }
  }

  const systemPrompt = await fetchLangfusePrompt(
    'acquisition-critique',
    ACQUISITION_CRITIQUE_SYSTEM_PROMPT,
  )

  const userContent = JSON.stringify({
    brand: state.input.brand,
    scrapeResult: state.scrapeResult ? {
      dataKeys: Object.keys(state.scrapeResult.data),
      statuses: state.scrapeResult.statuses,
    } : null,
    plan: state.plan,
  })

  const messages: BaseMessage[] = [
    new SystemMessage(systemPrompt),
    new HumanMessage(userContent),
  ]

  const response = await callModel(model, messages, options)
  state.budget.used.turns++

  const content = typeof response.content === 'string'
    ? response.content
    : JSON.stringify(response.content)

  let verdict: CritiqueVerdict
  try {
    const parsed = JSON.parse(extractJson(content))
    const result = CritiqueVerdictSchema.safeParse(parsed)
    verdict = result.success
      ? result.data
      : { verdict: 'sufficient', reason: 'verdict parse failed, accepting results' }
  } catch {
    verdict = { verdict: 'sufficient', reason: 'verdict parse failed, accepting results' }
  }

  return {
    ...state,
    verdict,
    decisions: [...state.decisions, {
      step: 'critique',
      action: verdict.verdict,
      reason: verdict.reason.slice(0, 100),
      ms: Date.now() - start,
    }],
  }
}

async function recoverNode(
  state: GraphState,
  deps: AcquisitionDeps,
): Promise<GraphState> {
  const start = Date.now()

  if (!state.plan) return { ...state, recoveryDone: true }

  // Fan-out: scrape the fanOut URLs
  const fanOutUrls = state.plan.fanOut.filter((u) =>
    !state.plan!.surfaces.some((s) => s.url === u),
  )

  if (fanOutUrls.length > 0) {
    const scrapeResult = await deps.scrapeBrandUrls(fanOutUrls, {
      renderProvider: deps.renderProvider,
      brandName: state.input.brand.name,
    })

    // Merge results
    if (state.scrapeResult) {
      state.scrapeResult.statuses.push(...scrapeResult.statuses)
      Object.assign(state.scrapeResult.data, scrapeResult.data)
    } else {
      state.scrapeResult = scrapeResult
    }
  }

  return {
    ...state,
    recoveryDone: true,
    decisions: [...state.decisions, {
      step: 'recover',
      action: `fan-out ${fanOutUrls.length} URLs`,
      reason: state.verdict?.recoveryAction ?? 'recovery',
      ms: Date.now() - start,
    }],
  }
}

// ---------------------------------------------------------------------------
// Graph orchestration
// ---------------------------------------------------------------------------

/**
 * Runs the acquisition agent for a single brand. This is a linear state machine
 * (not a full LangGraph StateGraph) to keep the implementation simple and testable.
 *
 * Flow: gather → plan → execute → critique → (recover → critique)? → finalize
 */
export async function runAcquisition(
  input: AcquisitionInput,
  deps: AcquisitionDeps,
  options: RunOptions = {},
): Promise<AcquisitionOutput> {
  const model = options.model
  if (!model) {
    return {
      agentOutcome: 'blocked',
      decisions: [],
      error: 'no_model_provided',
    }
  }

  let state: GraphState = {
    input,
    probeResults: [],
    budget: {
      allowed: { probes: 0, renders: 0, search: 0, turns: 0, wallClockMs: 0 },
      used: { probes: 0, renders: 0, search: 0, turns: 0, wallClockMs: 0 },
    },
    plan: null,
    planAttempts: 0,
    directives: new Map(),
    scrapeResult: null,
    verdict: null,
    recoveryDone: false,
    agentOutcome: 'planned',
    decisions: [],
  }

  // 1. Gather
  state = await gatherNode(state, deps)

  // Test-only budget override
  if (options.budgetOverride) {
    state.budget.allowed = { ...options.budgetOverride }
  }

  // Check if we have any budget to work with
  if (state.budget.allowed.turns === 0) {
    return {
      agentOutcome: 'fallback',
      budget: { allowed: state.budget.allowed, used: state.budget.used },
      decisions: state.decisions,
      error: 'no_budget',
    }
  }

  // 2. Plan (with one retry on failure)
  state = await planNode(state, model, options)
  if (!state.plan && state.planAttempts < 2) {
    state = await planNode(state, model, options)
  }
  if (!state.plan) {
    return {
      agentOutcome: 'fallback',
      budget: { allowed: state.budget.allowed, used: state.budget.used },
      decisions: state.decisions,
      error: 'plan_failed',
    }
  }
  if (state.agentOutcome === 'fallback') {
    return {
      agentOutcome: 'fallback',
      budget: { allowed: state.budget.allowed, used: state.budget.used },
      decisions: state.decisions,
      error: state.error,
    }
  }

  // 3. Execute
  state = await executeNode(state, deps)

  // 4. Critique
  state = await critiqueNode(state, model, options)

  // 5. If thin and no recovery yet, recover then re-critique
  if (state.verdict?.verdict === 'thin' && !state.recoveryDone) {
    state = await recoverNode(state, deps)
    state.agentOutcome = 'recovered'

    // Re-critique after recovery (but don't loop again)
    state = await critiqueNode(state, model, options)
  }

  // Finalize
  return {
    agentOutcome: state.agentOutcome,
    plan: state.plan ?? undefined,
    directives: state.directives.size > 0 ? state.directives : undefined,
    scrapeResult: state.scrapeResult ?? undefined,
    budget: { allowed: state.budget.allowed, used: state.budget.used },
    decisions: state.decisions,
    error: state.error,
  }
}

/**
 * Builds the acquisition graph with all dependencies wired. This is the
 * production entry point — tests use `runAcquisition` directly with injected
 * fakes.
 */
export function buildAcquisitionGraph(deps: AcquisitionDeps) {
  // The ChatOpenAI model is created at call time by the caller, not here,
  // because the model configuration (API key, model name) is environment-
  // dependent and should not be baked into the graph builder.
  return {
    run: (input: AcquisitionInput, options: RunOptions) =>
      runAcquisition(input, deps, options),
  }
}
