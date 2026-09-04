/**
 * Acquisition agent — a LangGraph `StateGraph`.
 *
 * gather → plan → execute → images → critique → (recover → imagesRecover →
 * critique)? → finalize
 *
 * The plan step is a bounded tool loop of its own: the model is bound to
 * `probe_static`, `probe_rendered`, `extract_links` and `submit_plan`, and runs
 * against a compiled sub-graph so the loop's `recursionLimit` bounds the
 * conversation without eating the outer graph's step allowance. A loop that hits
 * the limit, or two rejected `submit_plan` payloads, drops to `planFallback` —
 * one json-mode call — and a failure there is `agentOutcome: 'fallback'`, never a
 * thrown phase.
 *
 * All external dependencies (fetch, render, search, scrape, classify, model) are
 * injected, so the graph is exercised end to end with fakes and no service mock
 * (`scripts/check-test-boundaries.mjs` refuses those).
 *
 * Budget note: `turns` counts model STAGES (one for the whole plan stage, one
 * per critique) — not model calls. The plan stage's inner tool loop AND its
 * json-mode fallback are bounded by `recursionLimit` plus the probes and renders
 * allowances instead, because `budgetFor` sizes `turns` at 3 for a healthy
 * static site: plan, critique, and the critique that re-reads a recovery. The
 * loop's real call count is reported in the plan decision.
 */

import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages'
import { Annotation, END, START, StateGraph, GraphRecursionError } from '@langchain/langgraph'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { fetchLangfusePrompt } from '@/lib/langfuse/prompt'
import type { FetchMetadata } from '../scraper/fetch-guards'
import type { RenderProvider } from '../scraper/render/types'
import type { MultiScrapeResult, ScrapeBrandUrlsOptions } from '../scraper/index'
import type { SurfaceDirective } from '../scraper/strategies/types'
import {
  needsRendering,
  type CatalogDiscoveryResult,
  type CatalogSource,
  type DiscoverCatalogOptions,
} from '../catalog-discovery'
import { buildCandidatePool, type CandidateImage } from '../candidate-pool'
import type { ClassifiedImage } from '../classify-images'
import { rank, resolveSourceUrl, type RankableImage } from '../image-ranking'
import { HERO_TARGET_RATIO } from '@/lib/constants/brand-images'
import { MAX_IMAGE_POOL_BYTES, compactToBytes } from '../../phase-results'
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
  RESERVED_TAIL_MS,
  IMAGE_BATCH_EXTENSION_MS,
  NODE_ALLOWANCE_MS,
  ceilingMs,
  type AcquisitionBudget,
  type BudgetKind,
  type BudgetState,
  type EvidencePack,
  type ProbeResult,
} from './budget'
import { createAcquisitionTools, type ProvenanceAllowlist, type SearchResult } from './tools'
import {
  callModel,
  contentText,
  extractJson,
  withSchema,
  withSignal,
  type AgentAuditContext,
  type AgentModel,
  type AgentModelResponse,
} from '../agents/runtime'
import {
  ACQUISITION_PLAN_SYSTEM_PROMPT,
  ACQUISITION_CRITIQUE_SYSTEM_PROMPT,
} from '@/lib/prompts/acquisition'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Super-step ceiling for both the plan tool loop and the outer graph. The outer
 * graph's longest path (gather → plan → execute → images → critique → recover →
 * imagesRecover → critique → finalize) is nine steps, so this bounds the tool
 * loop in practice and backstops the outer graph.
 */
export const ACQUISITION_RECURSION_LIMIT = 12

/** Rejected `submit_plan` payloads before the loop gives up on tool calling. */
const MAX_BAD_SUBMITS = 2

/** Gallery slots after the hero. */
const MAX_GALLERY = 9

/** Fewer classified keeps than this after recovery is "thin" for image search. */
const MIN_KEEPS = 3

/** A probe below this many characters is not usable evidence (mirrors budgetFor). */
const THIN_TEXT_LENGTH = 200

// MAX_IMAGE_POOL_BYTES imported from phase-results.ts (single source of truth).

/** Audit phase for agent turns — matches `PhaseResult` and `current_phase`. */
const DEFAULT_AUDIT_PHASE = 'acquire'

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
  classifiedImages?: ClassifiedImage[]
  /** Best image for the 4:3 hero frame, or null when nothing survived ranking. */
  hero?: RankableImage | null
  /** The next nine ranked images. No per-page or logo cap. */
  gallery?: RankableImage[]
  /** Ranked pool for downstream consumers (products agent). Capped at 16 KB. */
  imagePool?: RankableImage[]
  /** Per-URL ownership verdicts from the critique; drives quarantine revocation. */
  urlVerdicts?: CritiqueVerdict['urlVerdicts']
  /** Page titles from fetched first-party pages, for the names phase. */
  nameCandidates?: string[]
  /** Pages that yielded at least one image candidate. */
  acquisitionPageUrls?: string[]
  /** A search or render provider threw AND no evidence was collected (Gate A). */
  providerFailure?: boolean
  /** Catalog discovery result from priority product URLs in the plan. */
  catalogResult?: CatalogDiscoveryResult
  budget?: { allowed: AcquisitionBudget; used: AcquisitionBudget }
  decisions: Array<{
    step: string
    action: string
    reason: string
    ms: number
    startedAtMs: number
    allowanceMs: number
    remainingMs: number
  }>
  error?: string
}

export type AcquisitionDeps = {
  fetchHtml: (url: string) => Promise<FetchMetadata>
  renderProvider?: RenderProvider
  searchBrand?: (query: string) => Promise<SearchResult>
  /** Image search for a brand whose own pages yielded too few usable images. */
  searchImages?: (input: { brandName: string; websiteHost: string | null }) => Promise<string[]>
  scrapeBrandUrls: (urls: string[], options: ScrapeBrandUrlsOptions) => Promise<MultiScrapeResult>
  /** Download image candidates to Supabase storage. Returns stored URLs (null for failures). */
  downloadAndStoreImages?: (candidates: CandidateImage[], brandId: string) => Promise<(string | null)[]>
  /** Run vision classification on stored images. Returns classified images with scores/tags. */
  classifyImages?: (brandId: string, dryRun?: boolean) => Promise<ClassifiedImage[]>
  /** Discover product catalog from brand URLs. Injected so tests can provide a fake. */
  discoverCatalog?: (options: DiscoverCatalogOptions) => Promise<CatalogDiscoveryResult>
  /** Channel sources (official site, marketplaces) handed to catalog discovery. */
  catalogSources?: CatalogSource[]
}

export type RunOptions = {
  model?: AgentModel
  signal?: AbortSignal
  /**
   * When present, every model turn goes through the shared runtime's audited
   * call (auditedCall span + brand_ai_results row + Langfuse generation).
   * Absent in unit tests, where the scripted model is invoked directly.
   */
  audit?: Omit<AgentAuditContext, 'phase'> & { phase?: string }
  /** Test-only: override the computed budget to force edge-case paths. */
  budgetOverride?: AcquisitionBudget
  /** When true, skip vision classification (images are still collected as candidates). */
  dryRun?: boolean
  /** Scale factor applied to the wall-clock budget and ceiling. Default 1. */
  budgetScale?: number
}

type Decision = AcquisitionOutput['decisions'][number]

// ---------------------------------------------------------------------------
// Run context
// ---------------------------------------------------------------------------

/**
 * Mutable per-run state that is deliberately NOT in the graph channels.
 *
 * Two things need it. Tools run inside a `ToolNode` and cannot read graph state,
 * but they must spend the same budget the nodes report. And a `GraphRecursionError`
 * or an abort unwinds out of `invoke()` with no final state, which would throw
 * away the decision trace that operators read — the ledger survives the throw.
 */
type RunContext = {
  input: AcquisitionInput
  deps: AcquisitionDeps
  options: RunOptions
  budget: BudgetState
  scale: number
  lastState: AcquisitionStateType | null
  allowlist: ProvenanceAllowlist
  decisions: Decision[]
  probeResults: ProbeResult[]
  pageTitles: Map<string, string>
  submittedPlan: AcquisitionPlanType | null
  badSubmits: number
  planModelCalls: number
  providerThrew: boolean
  wallClockStart: number
  signal: AbortSignal | undefined
  record: (step: string, action: string, reason: string, startedAt: number, extra?: Record<string, unknown>) => void
  remainingMs: () => number
  wallClockExhausted: () => boolean
  nodeSignal: (node: string) => AbortSignal | undefined
  invokeModel: (model: AgentModel, messages: BaseMessage[], nodeSignalOverride?: AbortSignal) => Promise<AgentModelResponse>
}

function createRunContext(
  input: AcquisitionInput,
  deps: AcquisitionDeps,
  options: RunOptions,
): RunContext {
  const wallClockStart = Date.now()
  const scale = options.budgetScale ?? 1
  const ctx: RunContext = {
    input,
    deps,
    options,
    budget: {
      allowed: { probes: 0, renders: 0, search: 0, turns: 0, wallClockMs: 0 },
      used: { probes: 0, renders: 0, search: 0, turns: 0, wallClockMs: 0 },
    },
    scale,
    lastState: null,
    allowlist: {
      knownUrls: new Set(input.knownUrls),
      discoveredUrls: new Set<string>(),
    },
    decisions: [],
    probeResults: [],
    pageTitles: new Map(),
    submittedPlan: null,
    badSubmits: 0,
    planModelCalls: 0,
    providerThrew: false,
    wallClockStart,
    // Until `gather` computes the real allowance, the ceiling is the deadline.
    signal: withSignal(options.signal, AbortSignal.timeout(ceilingMs(scale))),
    remainingMs() {
      return Math.max(0, ctx.budget.allowed.wallClockMs - (Date.now() - ctx.wallClockStart))
    },
    record(step, action, reason, startedAt, _extra) {
      const remaining = ctx.remainingMs()
      const isTailNode = step === 'critique' || step === 'finalize'
      const nodeKey = step === 'plan_stage' ? 'plan' : step
      let allowanceMs: number
      if (isTailNode) {
        allowanceMs = Math.min(
          ctx.budget.allowed.wallClockMs > 0 ? ctx.budget.allowed.wallClockMs : RESERVED_TAIL_MS,
          RESERVED_TAIL_MS,
        )
      } else if (nodeKey === 'images') {
        // Dynamic; use the node allowance table with stored count heuristic
        allowanceMs = NODE_ALLOWANCE_MS.images(0)
      } else if (nodeKey in NODE_ALLOWANCE_MS) {
        allowanceMs = NODE_ALLOWANCE_MS[nodeKey as keyof typeof NODE_ALLOWANCE_MS] as number
      } else {
        allowanceMs = remaining
      }
      ctx.decisions.push({
        step,
        action,
        reason,
        ms: Date.now() - startedAt,
        startedAtMs: startedAt - ctx.wallClockStart,
        allowanceMs,
        remainingMs: remaining,
      })
    },
    wallClockExhausted() {
      ctx.budget.used.wallClockMs = Date.now() - ctx.wallClockStart
      return (
        ctx.budget.allowed.wallClockMs > 0 &&
        ctx.remainingMs() <= RESERVED_TAIL_MS
      )
    },
    nodeSignal(node: string) {
      const isTailNode = node === 'critique' || node === 'finalize'
      const remaining = ctx.remainingMs()
      let allowance: number
      if (isTailNode) {
        allowance = Math.min(
          ctx.budget.allowed.wallClockMs > 0 ? ctx.budget.allowed.wallClockMs : RESERVED_TAIL_MS,
          RESERVED_TAIL_MS,
        )
      } else {
        const nodeKey = node === 'plan_stage' ? 'plan' : node
        let nodeAllowance: number
        if (nodeKey === 'images') {
          nodeAllowance = NODE_ALLOWANCE_MS.images(0)
        } else if (nodeKey in NODE_ALLOWANCE_MS) {
          nodeAllowance = NODE_ALLOWANCE_MS[nodeKey as keyof typeof NODE_ALLOWANCE_MS] as number
        } else {
          nodeAllowance = remaining
        }
        allowance = Math.max(1, Math.min(nodeAllowance, remaining - RESERVED_TAIL_MS))
      }
      return withSignal(options.signal, AbortSignal.timeout(Math.max(1, allowance)))
    },
    async invokeModel(model, messages, nodeSignalOverride) {
      const sig = nodeSignalOverride ?? ctx.signal
      if (!options.audit) return model.invoke(messages, sig ? { signal: sig } : undefined)
      return callModel(model, messages, {
        ...options.audit,
        phase: options.audit.phase ?? DEFAULT_AUDIT_PHASE,
        ...(sig ? { signal: sig } : {}),
      })
    },
  }
  return ctx
}

/** `true` when the spend was recorded, `false` when the kind is exhausted. */
function trySpend(budget: BudgetState, kind: BudgetKind): boolean {
  try {
    assertBudget(budget, kind)
  } catch {
    return false
  }
  budget.used[kind] += 1
  return true
}

// ---------------------------------------------------------------------------
// Graph state
// ---------------------------------------------------------------------------

/** Last-value channel: a node's update replaces the previous value. */
function lastValue<T>(initial: () => T) {
  return Annotation<T>({ reducer: (_left: T, right: T) => right, default: initial })
}

const AcquisitionState = Annotation.Root({
  plan: lastValue<AcquisitionPlanType | null>(() => null),
  directives: lastValue<Map<string, SurfaceDirective>>(() => new Map()),
  scrapeResult: lastValue<MultiScrapeResult | null>(() => null),
  imageCandidates: lastValue<CandidateImage[]>(() => []),
  classifiedImages: lastValue<ClassifiedImage[]>(() => []),
  recoveryImageUrls: lastValue<string[]>(() => []),
  verdict: lastValue<CritiqueVerdict | null>(() => null),
  recoveryDone: lastValue<boolean>(() => false),
  agentOutcome: lastValue<AcquisitionOutput['agentOutcome']>(() => 'planned'),
  error: lastValue<string | undefined>(() => undefined),
  hero: lastValue<RankableImage | null>(() => null),
  gallery: lastValue<RankableImage[]>(() => []),
  imagePool: lastValue<RankableImage[]>(() => []),
  acquisitionPageUrls: lastValue<string[]>(() => []),
  catalogResult: lastValue<CatalogDiscoveryResult | undefined>(() => undefined),
})

type AcquisitionStateType = typeof AcquisitionState.State
type AcquisitionUpdate = Partial<typeof AcquisitionState.Update>

// ---------------------------------------------------------------------------
// gather
// ---------------------------------------------------------------------------

function titleOf(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  const title = match?.[1]?.replace(/\s+/gu, ' ').trim()
  return title ? title.slice(0, 120) : null
}

async function gatherNode(ctx: RunContext): Promise<AcquisitionUpdate> {
  const start = Date.now()
  const probeResults: ProbeResult[] = []

  // Probe known URLs with bounded concurrency (≤4)
  const urls = ctx.input.knownUrls.slice(0, 6)
  for (let i = 0; i < urls.length; i += 4) {
    const batch = urls.slice(i, i + 4)
    const results = await Promise.allSettled(
      batch.map(async (url) => {
        const result = await ctx.deps.fetchHtml(url)
        const text = result.text ?? ''
        const title = titleOf(text)
        if (title) ctx.pageTitles.set(url, title)
        const bodyText = text.replace(/<[^>]*>/gu, '').replace(/\s+/gu, ' ').trim()
        return { url, textLength: bodyText.length, needsRendering: needsRendering(text) }
      }),
    )
    for (const result of results) {
      if (result.status === 'fulfilled') probeResults.push(result.value)
    }
  }

  const pack: EvidencePack = { knownUrls: ctx.input.knownUrls, probeResults }
  ctx.probeResults = probeResults
  ctx.budget.allowed = ctx.options.budgetOverride
    ? { ...ctx.options.budgetOverride }
    : budgetFor(pack, { scale: ctx.scale })
  ctx.budget.used = {
    probes: probeResults.length,
    renders: 0,
    search: 0,
    turns: 0,
    wallClockMs: 0,
  }

  // The remaining wall clock is now known; tighten the deadline from the ceiling.
  // A zero allowance means "no deadline of its own" (same guard as
  // `wallClockExhausted`), so the ceiling signal set at construction stands.
  const remaining = ctx.budget.allowed.wallClockMs - (Date.now() - ctx.wallClockStart)
  if (ctx.budget.allowed.wallClockMs > 0) {
    ctx.signal = withSignal(ctx.options.signal, AbortSignal.timeout(Math.max(1, remaining)))
  }

  ctx.record(
    'gather',
    `probed ${probeResults.length} URLs`,
    `${probeResults.filter((r) => r.needsRendering).length} need rendering`,
    start,
  )

  if (ctx.budget.allowed.turns === 0) {
    return { agentOutcome: 'fallback', error: 'no_budget' }
  }
  return {}
}

// ---------------------------------------------------------------------------
// plan — bounded tool loop, then a single-call fallback
// ---------------------------------------------------------------------------

const PlanLoopState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (left: BaseMessage[], right: BaseMessage[]) => left.concat(right),
    default: () => [],
  }),
})

/**
 * An assistant message, or null. Written by hand rather than with LangChain's
 * `isAIMessage`, which calls `_getType()` unguarded and therefore throws on the
 * plain object a hand-rolled fake model returns.
 */
function asAIMessage(value: unknown): AIMessage | null {
  const candidate = value as { _getType?: () => string } | null | undefined
  if (typeof candidate?._getType !== 'function') return null
  return candidate._getType() === 'ai' ? (value as AIMessage) : null
}

function toAIMessage(response: AgentModelResponse): BaseMessage {
  const existing = asAIMessage(response)
  if (existing) return existing
  return new AIMessage({
    content: contentText(response),
    ...(response.tool_calls
      ? {
          tool_calls: response.tool_calls.map((call, index) => ({
            name: call.name,
            args: call.args,
            id: call.id ?? `call-${index}`,
            type: 'tool_call' as const,
          })),
        }
      : {}),
  })
}

/** Adopts a plan the model wrote as JSON instead of calling `submit_plan`. */
function adoptPlanFromText(ctx: RunContext, text: string): boolean {
  if (!text.trim()) return false
  try {
    const parsed = AcquisitionPlan.safeParse(JSON.parse(extractJson(text)))
    if (!parsed.success) return false
    ctx.submittedPlan = boundedPlan(parsed.data)
    return true
  } catch {
    return false
  }
}

function buildPlanLoopGraph(
  ctx: RunContext,
  boundModel: AgentModel,
  tools: StructuredToolInterface[],
) {
  return new StateGraph(PlanLoopState)
    .addNode('model', async (state) => {
      const response = await ctx.invokeModel(boundModel, state.messages)
      ctx.planModelCalls += 1
      return { messages: [toAIMessage(response)] }
    })
    .addNode('tools', new ToolNode(tools))
    .addEdge(START, 'model')
    .addConditionalEdges('model', (state): 'tools' | typeof END => {
      if (ctx.submittedPlan) return END
      const last = state.messages.at(-1)
      const toolCalls = asAIMessage(last)?.tool_calls
      if (toolCalls && toolCalls.length > 0) return 'tools'
      // The model answered with a plan instead of calling the tool. Take it.
      adoptPlanFromText(ctx, last ? contentText({ content: last.content }) : '')
      return END
    })
    .addConditionalEdges('tools', (state): 'model' | typeof END => {
      if (ctx.submittedPlan) return END
      const lastAi = [...state.messages]
        .reverse()
        .map((message) => asAIMessage(message))
        .find((message): message is AIMessage => message !== null)
      const attemptedSubmit = (lastAi?.tool_calls ?? []).some(
        (call) => call.name === 'submit_plan',
      )
      // A submit that produced no plan is a bad payload, whether the tool schema
      // or the plan's own cross-field rule refused it.
      if (attemptedSubmit) ctx.badSubmits += 1
      if (ctx.badSubmits >= MAX_BAD_SUBMITS) return END
      return 'model'
    })
    .compile()
}

async function planPrompt(): Promise<string> {
  return withSchema(
    await fetchLangfusePrompt('acquisition-plan', ACQUISITION_PLAN_SYSTEM_PROMPT),
    'AcquisitionPlan',
    AcquisitionPlan,
  )
}

function planUserContent(ctx: RunContext): string {
  return JSON.stringify({
    brand: ctx.input.brand,
    knownUrls: ctx.input.knownUrls,
    probeResults: ctx.probeResults,
    budget: ctx.budget.allowed,
  })
}

async function planNode(ctx: RunContext): Promise<AcquisitionUpdate> {
  const start = Date.now()
  const model = ctx.options.model
  if (!model) return { agentOutcome: 'fallback', error: 'no_model_provided' }

  if (!trySpend(ctx.budget, 'turns')) {
    ctx.record('plan', 'skipped', 'budget_exhausted_before_plan', start)
    return { agentOutcome: 'fallback', error: 'budget_exhausted_before_plan' }
  }

  const systemPrompt = await planPrompt()
  const messages: BaseMessage[] = [
    new SystemMessage(systemPrompt),
    new HumanMessage(planUserContent(ctx)),
  ]

  // 1. Tool loop — only when the model can carry tools.
  if (model.bindTools) {
    const tools = createAcquisitionTools(
      { fetchHtml: ctx.deps.fetchHtml, ...(ctx.deps.renderProvider ? { renderProvider: ctx.deps.renderProvider } : {}) },
      {
        allowlist: ctx.allowlist,
        budget: ctx.budget,
        onProviderError: () => {
          ctx.providerThrew = true
        },
        onPageTitle: (url, title) => ctx.pageTitles.set(url, title),
        onPlanSubmitted: (plan) => {
          ctx.submittedPlan = plan
        },
      },
    )
    const boundModel = model.bindTools(tools)
    const planSignal = ctx.nodeSignal('plan_stage')
    try {
      await buildPlanLoopGraph(ctx, boundModel, tools).invoke(
        { messages },
        {
          recursionLimit: ACQUISITION_RECURSION_LIMIT,
          ...(planSignal ? { signal: planSignal } : {}),
        },
      )
    } catch (error) {
      // An aborted run is over; anything else degrades to the single call below
      // rather than failing the phase. A model that refuses tools alongside a
      // forced JSON response format lands here, and must still produce a plan.
      if (ctx.options.signal?.aborted) throw error
      ctx.record(
        'plan',
        'loop_stopped',
        error instanceof GraphRecursionError
          ? 'recursion_limit'
          : `loop_failed: ${error instanceof Error ? error.message.slice(0, 120) : 'unknown'}`,
        start,
      )
    }
  }

  // 2. Single-call fallback — today's json-mode plan, tried at most once. It
  //    spends NO further turn: the plan STAGE is one turn, charged above,
  //    however many model calls it takes to produce a plan. Charging this call
  //    a second turn spent the static-site allowance entirely on planning, and
  //    the critique then skipped as `budget_exhausted` on every such brand.
  if (!ctx.submittedPlan) {
    const response = await ctx.invokeModel(model, messages)
    ctx.planModelCalls += 1
    const adopted = adoptPlanFromText(ctx, contentText(response))
    ctx.record(
      'plan',
      'plan_fallback',
      adopted ? 'single call produced a plan' : 'single call did not produce a plan',
      start,
    )
  }

  const plan = ctx.submittedPlan
  if (!plan) {
    ctx.record('plan', 'plan_failed', `${ctx.planModelCalls} model calls, ${ctx.badSubmits} bad submits`, start)
    return { agentOutcome: 'fallback', error: 'plan_failed' }
  }

  ctx.record(
    'plan',
    'plan_created',
    `${plan.surfaces.length} surfaces, ${plan.fanOut.length} fanOut, ${ctx.planModelCalls} model calls`,
    start,
  )
  return { plan, directives: planToDirectives(plan) }
}

// ---------------------------------------------------------------------------
// execute
// ---------------------------------------------------------------------------

async function executeNode(
  state: AcquisitionStateType,
  ctx: RunContext,
): Promise<AcquisitionUpdate> {
  ctx.lastState = state
  const start = Date.now()
  if (!state.plan) return {}
  if (ctx.wallClockExhausted()) {
    ctx.record('execute', 'skipped', 'wall_clock_exhausted', start)
    return {}
  }

  const directives = new Map(state.directives)
  const urls: string[] = []
  let downgraded = 0

  for (const surface of state.plan.surfaces) {
    if (surface.fetch === 'skip') continue

    if (surface.fetch === 'render' && !trySpend(ctx.budget, 'renders')) {
      // Better a static read than no read: the cap bounds spend, not evidence.
      directives.set(surface.url, {
        ...(directives.get(surface.url) ?? { reason: surface.reason }),
        fetch: 'static',
        reason: `${surface.reason} (render budget exhausted)`,
      })
      downgraded += 1
    }

    // Executing the plan does NOT spend `probes`. That allowance sizes the
    // model's own exploration during planning; `scrapeBrandUrls` bounds this
    // fetch by `MAX_SCRAPE_URLS_PER_BRAND` on its own. Charging both made the
    // plan unexecutable whenever gather had used the allowance — the first
    // staging run scraped zero URLs on every brand for exactly this reason.
    urls.push(surface.url)
  }

  const scrapeResult = await ctx.deps.scrapeBrandUrls(urls, {
    directives,
    ...(ctx.deps.renderProvider ? { renderProvider: ctx.deps.renderProvider } : {}),
    brandName: ctx.input.brand.name,
  })

  ctx.record(
    'execute',
    `scraped ${urls.length} URLs`,
    `${scrapeResult.statuses.filter((s) => s.ok).length} succeeded, ${downgraded} downgraded`,
    start,
  )
  return { scrapeResult, directives }
}

// ---------------------------------------------------------------------------
// images
// ---------------------------------------------------------------------------

/** Extract image candidates from scrape results into a candidate pool. */
function collectImageCandidates(scrapeResult: MultiScrapeResult | null): CandidateImage[] {
  if (!scrapeResult) return []

  const data = scrapeResult.data
  const scraped: CandidateImage[] = []

  // Use imageSources when available (has pageUrl provenance)
  const sources =
    'imageSources' in data && Array.isArray(data.imageSources)
      ? (data.imageSources as Array<{ url: string; method: string; pageUrl: string; position: number }>)
      : []

  if (sources.length > 0) {
    for (const src of sources) {
      scraped.push({
        url: src.url,
        source: 'scrape',
        method: src.method,
        pageUrl: src.pageUrl,
        position: src.position,
      })
    }
  } else if ('galleryImageUrls' in data && Array.isArray(data.galleryImageUrls)) {
    for (const url of data.galleryImageUrls as string[]) {
      scraped.push({ url, source: 'scrape' })
    }
  }

  const jsonLdImages =
    'jsonLdImageUrls' in data && Array.isArray(data.jsonLdImageUrls)
      ? (data.jsonLdImageUrls as string[])
      : []

  return buildCandidatePool({
    scraped,
    jsonLdImages,
    googleImages: [], // google images are not available during acquisition
  })
}

/** Merge classified batches by id. The classifier is brand-scoped, so a second
 *  call returns the first batch again — concatenating double-counted every image. */
function mergeClassifiedById(
  existing: ClassifiedImage[],
  incoming: ClassifiedImage[],
): ClassifiedImage[] {
  const byId = new Map<string, ClassifiedImage>()
  for (const image of [...existing, ...incoming]) byId.set(image.id, image)
  return [...byId.values()]
}

async function storeAndClassify(
  ctx: RunContext,
  candidates: CandidateImage[],
): Promise<ClassifiedImage[]> {
  if (ctx.deps.downloadAndStoreImages) {
    await ctx.deps.downloadAndStoreImages(candidates, ctx.input.brand.id)
  }
  if (ctx.deps.classifyImages && !ctx.options.dryRun) {
    return ctx.deps.classifyImages(ctx.input.brand.id, ctx.options.dryRun)
  }
  return []
}

async function imagesNode(
  state: AcquisitionStateType,
  ctx: RunContext,
): Promise<AcquisitionUpdate> {
  ctx.lastState = state
  const start = Date.now()
  if (ctx.wallClockExhausted()) {
    ctx.record('images', 'skipped', 'wall_clock_exhausted', start)
    return {}
  }

  const candidates = collectImageCandidates(state.scrapeResult)
  if (candidates.length === 0) {
    ctx.record('images', 'no candidates', 'no images found in scrape results', start)
    return { imageCandidates: [], classifiedImages: [] }
  }

  const classifiedImages = await storeAndClassify(ctx, candidates)

  // Extend the wall-clock budget for stored images, capped at the ceiling.
  const storedCount = classifiedImages.length
  if (storedCount > 0) {
    const extension = IMAGE_BATCH_EXTENSION_MS * Math.ceil(storedCount / 10)
    ctx.budget.allowed.wallClockMs = Math.min(
      ceilingMs(ctx.scale),
      ctx.budget.allowed.wallClockMs + extension,
    )
  }

  ctx.record(
    'images',
    `${candidates.length} candidates, ${classifiedImages.length} classified`,
    ctx.options.dryRun ? 'dry-run: classify skipped' : 'download+classify complete',
    start,
  )
  return { imageCandidates: candidates, classifiedImages }
}

async function imagesRecoverNode(
  state: AcquisitionStateType,
  ctx: RunContext,
): Promise<AcquisitionUpdate> {
  ctx.lastState = state
  const start = Date.now()
  if (ctx.wallClockExhausted()) {
    ctx.record('images_recover', 'skipped', 'wall_clock_exhausted', start)
    return {}
  }

  const seen = new Set(state.imageCandidates.map((candidate) => candidate.url))
  const fresh: CandidateImage[] = []
  const fromRecoveryScrape = collectImageCandidates(state.scrapeResult)
  const fromImageSearch: CandidateImage[] = state.recoveryImageUrls.map((url) => ({
    url,
    source: 'scrape' as const,
    method: 'image_search',
  }))

  for (const candidate of [...fromRecoveryScrape, ...fromImageSearch]) {
    if (seen.has(candidate.url)) continue
    seen.add(candidate.url)
    fresh.push(candidate)
  }

  if (fresh.length === 0) {
    ctx.record('images_recover', 'no new candidates', 'recovery found no new images', start)
    return {}
  }

  const classified = await storeAndClassify(ctx, fresh)
  const merged = mergeClassifiedById(state.classifiedImages, classified)
  ctx.record(
    'images_recover',
    `${fresh.length} new candidates, ${classified.length} classified`,
    `${merged.length} unique after merge`,
    start,
  )
  return {
    imageCandidates: [...state.imageCandidates, ...fresh],
    classifiedImages: merged,
  }
}

// ---------------------------------------------------------------------------
// critique
// ---------------------------------------------------------------------------

/** Quarantine subjects — every URL the run treated as possibly first-party. */
function quarantineSubjects(state: AcquisitionStateType, ctx: RunContext): string[] {
  const urls = new Set<string>(ctx.input.knownUrls)
  for (const surface of state.plan?.surfaces ?? []) {
    if (surface.fetch !== 'skip') urls.add(surface.url)
  }
  for (const status of state.scrapeResult?.statuses ?? []) urls.add(status.url)
  return [...urls]
}

async function critiqueNode(
  state: AcquisitionStateType,
  ctx: RunContext,
): Promise<AcquisitionUpdate> {
  ctx.lastState = state
  const start = Date.now()
  const model = ctx.options.model
  if (!model) return { verdict: { verdict: 'sufficient', reason: 'no model' } }

  if (!trySpend(ctx.budget, 'turns')) {
    // Budget exhausted at critique: accept what we have rather than lose it.
    ctx.record('critique', 'skipped', 'budget_exhausted', start)
    return { verdict: { verdict: 'sufficient', reason: 'budget exhausted, accepting results' } }
  }

  const systemPrompt = withSchema(
    await fetchLangfusePrompt('acquisition-critique', ACQUISITION_CRITIQUE_SYSTEM_PROMPT),
    'CritiqueVerdict',
    CritiqueVerdictSchema,
  )

  const userContent = JSON.stringify({
    brand: ctx.input.brand,
    scrapeResult: state.scrapeResult
      ? { dataKeys: Object.keys(state.scrapeResult.data), statuses: state.scrapeResult.statuses }
      : null,
    plan: state.plan,
    quarantineSubjectUrls: quarantineSubjects(state, ctx),
  })

  let response: AgentModelResponse
  try {
    const critiqueSignal = ctx.nodeSignal('critique')
    response = await ctx.invokeModel(model, [
      new SystemMessage(systemPrompt),
      new HumanMessage(userContent),
    ], critiqueSignal)
  } catch (error) {
    // Critique timeout/abort → treat as budget exhausted, never rethrow.
    const isAbort =
      ctx.options.signal?.aborted ||
      (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))
    if (isAbort) {
      ctx.record('critique', '[CRITIQUE-TIMEOUT] skipped', 'budget_exhausted: critique timed out', start)
      return { verdict: { verdict: 'sufficient', reason: 'budget exhausted, accepting results' } }
    }
    // Non-abort errors still degrade gracefully.
    ctx.record('critique', '[CRITIQUE-TIMEOUT] skipped', `critique_error: ${error instanceof Error ? error.message.slice(0, 100) : 'unknown'}`, start)
    return { verdict: { verdict: 'sufficient', reason: 'critique error, accepting results' } }
  }

  let verdict: CritiqueVerdict
  try {
    const parsed = CritiqueVerdictSchema.safeParse(JSON.parse(extractJson(contentText(response))))
    verdict = parsed.success
      ? parsed.data
      : { verdict: 'sufficient', reason: 'verdict parse failed, accepting results' }
  } catch {
    verdict = { verdict: 'sufficient', reason: 'verdict parse failed, accepting results' }
  }

  ctx.record('critique', verdict.verdict, verdict.reason.slice(0, 100), start)

  if (verdict.verdict === 'fail') {
    return { verdict, agentOutcome: 'blocked', error: `critique_failed: ${verdict.reason}` }
  }
  return { verdict }
}

// ---------------------------------------------------------------------------
// recover
// ---------------------------------------------------------------------------

/** Merge recovery data into existing results with first-pass-wins semantics. */
function mergeRecoveryResult(
  existing: MultiScrapeResult | null,
  recovery: MultiScrapeResult,
): MultiScrapeResult {
  if (!existing) return recovery
  const mergedStatuses = [...existing.statuses, ...recovery.statuses]
  // First-pass-wins for scalar fields; concatenate for image arrays so
  // imagesRecoverNode can discover fresh candidates from the recovery scrape.
  const IMAGE_ARRAY_KEYS = new Set(['galleryImageUrls', 'imageSources', 'jsonLdImageUrls'])
  const mergedData = { ...recovery.data }
  for (const [key, value] of Object.entries(existing.data)) {
    if (IMAGE_ARRAY_KEYS.has(key) && Array.isArray(value)) {
      const recoveryArr = Array.isArray((mergedData as Record<string, unknown>)[key])
        ? ((mergedData as Record<string, unknown>)[key] as unknown[])
        : [];
      (mergedData as Record<string, unknown>)[key] = [...value, ...recoveryArr]
      continue
    }
    if (
      value !== null &&
      value !== undefined &&
      value !== '' &&
      !(Array.isArray(value) && value.length === 0)
    ) {
      (mergedData as Record<string, unknown>)[key] = value
    }
  }
  return { data: mergedData as MultiScrapeResult['data'], statuses: mergedStatuses }
}

/** No known URLs, or every probe came back too short to be evidence. */
function knownUrlsAreThin(ctx: RunContext): boolean {
  if (ctx.input.knownUrls.length === 0) return true
  return ctx.probeResults.every((probe) => probe.textLength < THIN_TEXT_LENGTH)
}

/** URLs a high-confidence "not owned" verdict revoked. */
function revokedUrls(verdict: CritiqueVerdict | null): Set<string> {
  return new Set(
    (verdict?.urlVerdicts ?? [])
      .filter((entry) => !entry.owned && entry.confidence === 'high')
      .map((entry) => entry.url),
  )
}

/**
 * The best name available before the names phase arbitrates: a confirmed
 * first-party page title, then the stored brand name, then the slug
 * (design decision #38 — the name actually used is recorded).
 */
function bestBrandName(state: AcquisitionStateType, ctx: RunContext): string {
  const revoked = revokedUrls(state.verdict)
  for (const [url, title] of ctx.pageTitles) {
    if (!revoked.has(url)) return title
  }
  return ctx.input.brand.name ?? ctx.input.brand.slug
}

function websiteHostOf(state: AcquisitionStateType, ctx: RunContext): string | null {
  const candidate =
    ctx.input.knownUrls[0] ??
    state.plan?.surfaces.find((surface) => surface.fetch !== 'skip')?.url
  if (!candidate) return null
  try {
    return new URL(candidate).host
  } catch {
    return null
  }
}

function keepCount(images: ClassifiedImage[]): number {
  return images.filter((image) => image.disposition !== 'reject').length
}

async function recoverNode(
  state: AcquisitionStateType,
  ctx: RunContext,
): Promise<AcquisitionUpdate> {
  ctx.lastState = state
  const start = Date.now()
  if (!state.plan) return { recoveryDone: true }

  const action = state.verdict?.recoveryAction ?? 'fanout'
  let scrapeResult = state.scrapeResult
  let didRecover = false
  let description = 'no-op'

  if (action === 'search') {
    if (!ctx.deps.searchBrand) {
      description = 'search_refused'
      ctx.record('recover', description, 'no search provider injected', start)
    } else if (!knownUrlsAreThin(ctx)) {
      description = 'search_refused'
      ctx.record('recover', description, 'known URLs already returned usable text', start)
    } else if (!trySpend(ctx.budget, 'search')) {
      description = 'search_refused'
      ctx.record('recover', description, 'budget_exhausted: search', start)
    } else {
      const found = await ctx.deps.searchBrand(ctx.input.brand.name ?? ctx.input.brand.slug)
      const newUrls = found.urls.filter(
        (url) => !state.plan!.surfaces.some((surface) => surface.url === url),
      )
      for (const url of newUrls) ctx.allowlist.discoveredUrls.add(url)
      if (newUrls.length > 0) {
        const recovered = await ctx.deps.scrapeBrandUrls(newUrls.slice(0, 3), {
          ...(ctx.deps.renderProvider ? { renderProvider: ctx.deps.renderProvider } : {}),
          brandName: ctx.input.brand.name,
        })
        scrapeResult = mergeRecoveryResult(scrapeResult, recovered)
        didRecover = true
      }
      description = `search found ${found.urls.length} URLs, scraped ${Math.min(newUrls.length, 3)}`
      ctx.record('recover', description, 'search', start)
    }
  } else if (action === 'render') {
    const renderUrls: string[] = []
    if (ctx.deps.renderProvider) {
      const staticUrls = state.plan.surfaces
        .filter((surface) => surface.fetch === 'static')
        .map((surface) => surface.url)
        .slice(0, 3)
      // Each recovery render is charged before it is queued; the cap truncates
      // the list rather than refusing the whole recovery.
      for (const url of staticUrls) {
        if (!trySpend(ctx.budget, 'renders')) break
        renderUrls.push(url)
      }
    }

    if (renderUrls.length > 0 && ctx.deps.renderProvider) {
      const renderDirectives = new Map<string, SurfaceDirective>()
      for (const url of renderUrls) {
        renderDirectives.set(url, { fetch: 'render', reason: 'recovery render' })
      }
      const recovered = await ctx.deps.scrapeBrandUrls(renderUrls, {
        directives: renderDirectives,
        renderProvider: ctx.deps.renderProvider,
        brandName: ctx.input.brand.name,
      })
      scrapeResult = mergeRecoveryResult(scrapeResult, recovered)
      didRecover = true
    }
    description = `render recovery on ${renderUrls.length} URLs`
    ctx.record('recover', description, 'render', start)
  } else {
    const fanOutUrls = state.plan.fanOut.filter(
      (url) => !state.plan!.surfaces.some((surface) => surface.url === url),
    )
    if (fanOutUrls.length > 0) {
      const recovered = await ctx.deps.scrapeBrandUrls(fanOutUrls, {
        ...(ctx.deps.renderProvider ? { renderProvider: ctx.deps.renderProvider } : {}),
        brandName: ctx.input.brand.name,
      })
      scrapeResult = mergeRecoveryResult(scrapeResult, recovered)
      didRecover = true
    }
    description = `fan-out ${fanOutUrls.length} URLs`
    ctx.record('recover', description, 'fanout', start)
  }

  // Image recovery: too few usable images is its own kind of thin.
  let recoveryImageUrls: string[] = []
  if (ctx.deps.searchImages && keepCount(state.classifiedImages) < MIN_KEEPS) {
    const searchStart = Date.now()
    const brandName = bestBrandName(state, ctx)
    try {
      recoveryImageUrls = await ctx.deps.searchImages({
        brandName,
        websiteHost: websiteHostOf(state, ctx),
      })
      ctx.record(
        'recover',
        `search_images ${recoveryImageUrls.length} URLs`,
        `name used: ${brandName}`,
        searchStart,
      )
    } catch (error) {
      ctx.providerThrew = true
      ctx.record(
        'recover',
        'search_images_failed',
        error instanceof Error ? error.message.slice(0, 120) : 'image search failed',
        searchStart,
      )
    }
  }

  return {
    recoveryDone: true,
    recoveryImageUrls,
    ...(scrapeResult ? { scrapeResult } : {}),
    ...(didRecover ? { agentOutcome: 'recovered' as const } : {}),
  }
}

// ---------------------------------------------------------------------------
// finalize
// ---------------------------------------------------------------------------

// sourceUrlOf is now `resolveSourceUrl` in image-ranking.ts (shared with acquire.ts).

function boundedImagePool(pool: RankableImage[]): RankableImage[] {
  return compactToBytes(pool, MAX_IMAGE_POOL_BYTES)
}

async function finalizeNode(
  state: AcquisitionStateType,
  ctx: RunContext,
): Promise<AcquisitionUpdate> {
  ctx.lastState = state
  const start = Date.now()
  ctx.budget.used.wallClockMs = Date.now() - ctx.wallClockStart // records the final wall-clock usage

  const pool: RankableImage[] = state.classifiedImages.map((image) => ({
    ...image,
    sourceUrl: resolveSourceUrl(image),
  }))
  const ranked = rank(pool, HERO_TARGET_RATIO) as RankableImage[]
  const hero = ranked[0] ?? null
  const gallery = ranked.slice(1, 1 + MAX_GALLERY)

  const acquisitionPageUrls = [
    ...new Set(
      state.imageCandidates
        .map((candidate) => candidate.pageUrl)
        .filter((url): url is string => typeof url === 'string' && url.length > 0),
    ),
  ]

  let catalogResult: CatalogDiscoveryResult | undefined
  const entryUrls = state.plan?.catalog.entryUrls ?? []
  const priorityProductUrls = state.plan?.catalog.priorityProductUrls ?? []
  const catalogSources = ctx.deps.catalogSources ?? []
  // A plan that lists no product URL is not a brand without a catalog: the
  // brand's OWN purchase channels are sources in their own right, and gating
  // discovery on the plan alone left the products phase with an empty pool for
  // every brand whose plan happened to name only the home page.
  const hasCatalogInput =
    entryUrls.length > 0 || priorityProductUrls.length > 0 || catalogSources.length > 0
  if (ctx.deps.discoverCatalog && hasCatalogInput) {
    try {
      catalogResult = await ctx.deps.discoverCatalog({
        sources: catalogSources,
        entryUrls,
        priorityProductUrls,
        ...(ctx.deps.renderProvider ? { renderProvider: ctx.deps.renderProvider } : {}),
      })
    } catch {
      // Catalog discovery is non-critical; swallow and continue.
    }
  }

  const catalogNote = catalogResult
    ? 'catalog discovered'
    : hasCatalogInput
      ? 'catalog skipped'
      : 'catalog skipped: no sources'

  ctx.record(
    'finalize',
    `${ranked.length} ranked images`,
    `hero ${hero ? 'picked' : 'none'}, gallery ${gallery.length}, ${catalogNote}`,
    start,
  )

  return {
    hero,
    gallery,
    imagePool: boundedImagePool(ranked),
    acquisitionPageUrls,
    ...(catalogResult ? { catalogResult } : {}),
  }
}

// ---------------------------------------------------------------------------
// Graph assembly
// ---------------------------------------------------------------------------

// The planning node is `plan_stage`, not `plan`: LangGraph refuses a node whose
// name equals a state channel, and `plan` is a channel this graph writes.
export function buildAcquisitionGraph(ctx: RunContext) {
  return new StateGraph(AcquisitionState)
    .addNode('gather', () => gatherNode(ctx))
    .addNode('plan_stage', () => planNode(ctx))
    .addNode('execute', (state) => executeNode(state, ctx))
    .addNode('images', (state) => imagesNode(state, ctx))
    .addNode('critique', (state) => critiqueNode(state, ctx))
    .addNode('recover', (state) => recoverNode(state, ctx))
    .addNode('imagesRecover', (state) => imagesRecoverNode(state, ctx))
    .addNode('finalize', (state) => finalizeNode(state, ctx))
    .addEdge(START, 'gather')
    .addConditionalEdges('gather', (state): 'plan_stage' | typeof END =>
      state.agentOutcome === 'fallback' ? END : 'plan_stage',
    )
    .addConditionalEdges('plan_stage', (state): 'execute' | typeof END =>
      state.plan ? 'execute' : END,
    )
    .addEdge('execute', 'images')
    .addEdge('images', 'critique')
    .addConditionalEdges(
      'critique',
      (state): 'recover' | 'finalize' | typeof END => {
        if (state.verdict?.verdict === 'fail') return END
        if (state.verdict?.verdict === 'thin' && !state.recoveryDone && !ctx.wallClockExhausted()) {
          return 'recover'
        }
        return 'finalize'
      },
    )
    .addEdge('recover', 'imagesRecover')
    .addEdge('imagesRecover', 'critique')
    .addEdge('finalize', END)
    .compile()
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function outputFrom(
  state: AcquisitionStateType | null,
  ctx: RunContext,
  overrides: Partial<AcquisitionOutput> = {},
): AcquisitionOutput {
  const evidenceEmpty =
    !state?.scrapeResult || state.scrapeResult.statuses.every((status) => !status.ok)

  return {
    agentOutcome: state?.agentOutcome ?? 'fallback',
    ...(state?.plan ? { plan: state.plan } : {}),
    ...(state?.directives && state.directives.size > 0 ? { directives: state.directives } : {}),
    ...(state?.scrapeResult ? { scrapeResult: state.scrapeResult } : {}),
    classifiedImages: state?.classifiedImages ?? [],
    hero: state?.hero ?? null,
    gallery: state?.gallery ?? [],
    ...(state?.imagePool && state.imagePool.length > 0 ? { imagePool: state.imagePool } : {}),
    ...(state?.verdict?.urlVerdicts ? { urlVerdicts: state.verdict.urlVerdicts } : {}),
    nameCandidates: [...new Set(ctx.pageTitles.values())],
    acquisitionPageUrls: state?.acquisitionPageUrls ?? [],
    providerFailure: ctx.providerThrew && evidenceEmpty,
    ...(state?.catalogResult ? { catalogResult: state.catalogResult } : {}),
    budget: { allowed: ctx.budget.allowed, used: ctx.budget.used },
    decisions: ctx.decisions,
    ...(state?.error ? { error: state.error } : {}),
    ...overrides,
  }
}

/**
 * Runs the acquisition agent for a single brand. Never throws: every failure
 * path resolves to `agentOutcome: 'fallback' | 'blocked'` so the caller can drop
 * to the legacy scrape rather than fail the phase.
 */
export async function runAcquisition(
  input: AcquisitionInput,
  deps: AcquisitionDeps,
  options: RunOptions = {},
): Promise<AcquisitionOutput> {
  const ctx = createRunContext(input, deps, options)
  const scale = ctx.scale

  if (!options.model) {
    return outputFrom(null, ctx, { agentOutcome: 'blocked', error: 'no_model_provided' })
  }
  if (options.signal?.aborted) {
    return outputFrom(null, ctx, { agentOutcome: 'fallback', error: 'aborted' })
  }

  // The ceiling signal bounds the entire run; the per-node signals are tighter.
  const ceilingSignal = withSignal(options.signal, AbortSignal.timeout(ceilingMs(scale)))

  try {
    const state = (await buildAcquisitionGraph(ctx).invoke(
      { agentOutcome: 'planned' },
      {
        recursionLimit: ACQUISITION_RECURSION_LIMIT,
        ...(ceilingSignal ? { signal: ceilingSignal } : {}),
      },
    )) as AcquisitionStateType

    return outputFrom(state, ctx)
  } catch (error) {
    const lastOutcome = ctx.lastState ? 'planned' : 'fallback'
    if (error instanceof GraphRecursionError) {
      ctx.record('graph', 'stopped', 'recursion_limit', ctx.wallClockStart)
      return outputFrom(ctx.lastState, ctx, { agentOutcome: lastOutcome as AcquisitionOutput['agentOutcome'], error: 'recursion_limit' })
    }
    const aborted =
      options.signal?.aborted ||
      ctx.signal?.aborted ||
      (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))
    if (aborted) {
      ctx.record('graph', 'stopped', 'aborted', ctx.wallClockStart)
      return outputFrom(ctx.lastState, ctx, { agentOutcome: lastOutcome as AcquisitionOutput['agentOutcome'], error: 'aborted' })
    }
    const message = error instanceof Error ? error.message : String(error)
    ctx.record('graph', 'threw', message.slice(0, 160), ctx.wallClockStart)
    return outputFrom(ctx.lastState, ctx, { agentOutcome: lastOutcome as AcquisitionOutput['agentOutcome'], error: `threw: ${message.slice(0, 180)}` })
  }
}
