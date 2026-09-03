/**
 * Acquisition agent graph. Orchestrates the gather → plan → execute → images →
 * critique → recover → imagesRecover → finalize flow as a linear state machine.
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
import { needsRendering, type CatalogDiscoveryResult } from '../catalog-discovery'
import type { DiscoverCatalogOptions } from '../catalog-discovery'
import { buildCandidatePool, type CandidateImage } from '../candidate-pool'
import type { ClassifiedImage } from '../classify-images'
import { rank } from '../image-ranking'
import { HERO_TARGET_RATIO } from '@/lib/constants/brand-images'
import type { EnrichBrand } from '../types'
import type { z } from 'zod'
import {
  AcquisitionPlan,
  CritiqueVerdictSchema,
  planToDirectives,
  boundedPlan,
  toStrictJsonSchema,
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
  ACQUISITION_SCHEMA_TRAILER,
} from '@/lib/prompts/acquisition'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AcquisitionInput = {
  brand: Pick<EnrichBrand, 'id' | 'slug' | 'name'>
  knownUrls: string[]
  jobId?: string
}

type ImagePoolEntry = {
  url: string
  score: number
  tags: string[]
  pageUrl?: string
  storageKey?: string
}

export type AcquisitionOutput = {
  agentOutcome: 'planned' | 'recovered' | 'fallback' | 'blocked'
  plan?: AcquisitionPlanType
  directives?: Map<string, SurfaceDirective>
  scrapeResult?: MultiScrapeResult
  classifiedImages?: ClassifiedImage[]
  /** Ranked image pool for downstream consumers (products agent). Capped at 16 KB. */
  imagePool?: ImagePoolEntry[]
  /** Catalog discovery result from priority product URLs in the plan. */
  catalogResult?: CatalogDiscoveryResult
  budget?: { allowed: AcquisitionBudget; used: AcquisitionBudget }
  decisions: Array<{ step: string; action: string; reason: string; ms: number }>
  error?: string
}

export type AcquisitionDeps = {
  fetchHtml: (url: string) => Promise<FetchMetadata>
  renderProvider?: RenderProvider
  searchBrand?: (query: string) => Promise<SearchResult>
  scrapeBrandUrls: (urls: string[], options: ScrapeBrandUrlsOptions) => Promise<MultiScrapeResult>
  /** Download image candidates to Supabase storage. Returns stored URLs (null for failures). */
  downloadAndStoreImages?: (candidates: CandidateImage[], brandId: string) => Promise<(string | null)[]>
  /** Run vision classification on stored images. Returns classified images with scores/tags. */
  classifyImages?: (brandId: string, dryRun?: boolean) => Promise<ClassifiedImage[]>
  /** Discover product catalog from brand URLs. Injected so tests can provide a fake. */
  discoverCatalog?: (options: DiscoverCatalogOptions) => Promise<CatalogDiscoveryResult>
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
  /** When true, skip vision classification (images are still collected as candidates). */
  dryRun?: boolean
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

// The prompts say "match the <name> JSON Schema" — this is what makes that
// sentence true. Without the schema inline the model invents field names
// (`mode` for `fetch`, extra `estimatedTimeMs`) and strict Zod rejects every plan.
function withSchema(prompt: string, name: string, schema: z.ZodType): string {
  return `${prompt}\n\n## ${name} JSON Schema\n\`\`\`json\n${JSON.stringify(toStrictJsonSchema(schema))}\n\`\`\`\n${ACQUISITION_SCHEMA_TRAILER}`
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
  imageCandidates: CandidateImage[]
  classifiedImages: ClassifiedImage[]
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
          needsRendering: needsRendering(text),
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

  const systemPrompt = withSchema(
    await fetchLangfusePrompt('acquisition-plan', ACQUISITION_PLAN_SYSTEM_PROMPT),
    'AcquisitionPlan',
    AcquisitionPlan,
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

  const nonSkipSurfaces = state.plan.surfaces.filter((s) => s.fetch !== 'skip')
  const urls = nonSkipSurfaces.map((s) => s.url)

  const scrapeResult = await deps.scrapeBrandUrls(urls, {
    directives: state.directives,
    renderProvider: deps.renderProvider,
    brandName: state.input.brand.name,
  })

  // Track budget usage: renders and probes
  const renderCount = nonSkipSurfaces.filter((s) => s.fetch === 'render').length
  const probeCount = nonSkipSurfaces.length

  return {
    ...state,
    scrapeResult,
    budget: {
      ...state.budget,
      used: {
        ...state.budget.used,
        renders: state.budget.used.renders + renderCount,
        probes: state.budget.used.probes + probeCount,
      },
    },
    decisions: [...state.decisions, {
      step: 'execute',
      action: `scraped ${urls.length} URLs`,
      reason: `${scrapeResult.statuses.filter((s) => s.ok).length} succeeded`,
      ms: Date.now() - start,
    }],
  }
}

// ---------------------------------------------------------------------------
// Image nodes
// ---------------------------------------------------------------------------

/** Extract image candidates from scrape results into a candidate pool. */
function collectImageCandidates(scrapeResult: MultiScrapeResult | null): CandidateImage[] {
  if (!scrapeResult) return []

  const data = scrapeResult.data
  const scraped: CandidateImage[] = []

  // Use imageSources when available (has pageUrl provenance)
  const sources = ('imageSources' in data && Array.isArray(data.imageSources))
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

  const jsonLdImages = ('jsonLdImageUrls' in data && Array.isArray(data.jsonLdImageUrls))
    ? (data.jsonLdImageUrls as string[])
    : []

  return buildCandidatePool({
    scraped,
    jsonLdImages,
    googleImages: [], // google images are not available during acquisition
  })
}

async function imagesNode(
  state: GraphState,
  deps: AcquisitionDeps,
  options: RunOptions = {},
): Promise<GraphState> {
  const start = Date.now()

  const candidates = collectImageCandidates(state.scrapeResult)

  if (candidates.length === 0) {
    return {
      ...state,
      imageCandidates: [],
      classifiedImages: [],
      decisions: [...state.decisions, {
        step: 'images',
        action: 'no candidates',
        reason: 'no images found in scrape results',
        ms: Date.now() - start,
      }],
    }
  }

  let classifiedImages: ClassifiedImage[] = []

  // Download images to storage
  if (deps.downloadAndStoreImages) {
    await deps.downloadAndStoreImages(candidates, state.input.brand.id)
  }

  // Classify images (vision scoring) — skip in dry-run mode
  if (deps.classifyImages && !options.dryRun) {
    classifiedImages = await deps.classifyImages(state.input.brand.id, options.dryRun)
  }

  return {
    ...state,
    imageCandidates: candidates,
    classifiedImages,
    decisions: [...state.decisions, {
      step: 'images',
      action: `${candidates.length} candidates, ${classifiedImages.length} classified`,
      reason: options.dryRun ? 'dry-run: classify skipped' : 'download+classify complete',
      ms: Date.now() - start,
    }],
  }
}

async function imagesRecoverNode(
  state: GraphState,
  deps: AcquisitionDeps,
  options: RunOptions = {},
): Promise<GraphState> {
  const start = Date.now()

  // Collect new candidates from recovery scrape
  const newCandidates = collectImageCandidates(state.scrapeResult)

  // Filter out candidates we already have
  const existingUrls = new Set(state.imageCandidates.map((c) => c.url))
  const freshCandidates = newCandidates.filter((c) => !existingUrls.has(c.url))

  if (freshCandidates.length === 0) {
    return {
      ...state,
      decisions: [...state.decisions, {
        step: 'images_recover',
        action: 'no new candidates',
        reason: 'recovery scrape had no new images',
        ms: Date.now() - start,
      }],
    }
  }

  let newClassified: ClassifiedImage[] = []

  if (deps.downloadAndStoreImages) {
    await deps.downloadAndStoreImages(freshCandidates, state.input.brand.id)
  }

  if (deps.classifyImages && !options.dryRun) {
    newClassified = await deps.classifyImages(state.input.brand.id, options.dryRun)
  }

  return {
    ...state,
    imageCandidates: [...state.imageCandidates, ...freshCandidates],
    classifiedImages: [...state.classifiedImages, ...newClassified],
    decisions: [...state.decisions, {
      step: 'images_recover',
      action: `${freshCandidates.length} new candidates, ${newClassified.length} classified`,
      reason: 'recovery images merged',
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

  const systemPrompt = withSchema(
    await fetchLangfusePrompt('acquisition-critique', ACQUISITION_CRITIQUE_SYSTEM_PROMPT),
    'CritiqueVerdict',
    CritiqueVerdictSchema,
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
        ? (mergedData as Record<string, unknown>)[key] as unknown[]
        : [];
      (mergedData as Record<string, unknown>)[key] = [...value, ...recoveryArr]
      continue
    }
    if (value !== null && value !== undefined && value !== '' &&
        !(Array.isArray(value) && value.length === 0)) {
      (mergedData as Record<string, unknown>)[key] = value
    }
  }
  return { data: mergedData as MultiScrapeResult['data'], statuses: mergedStatuses }
}

async function recoverNode(
  state: GraphState,
  deps: AcquisitionDeps,
): Promise<GraphState> {
  const start = Date.now()

  if (!state.plan) return { ...state, recoveryDone: true }

  const action = state.verdict?.recoveryAction ?? 'fanout'
  let recoveryDescription = 'no-op'
  let didRecover = false

  if (action === 'search' && deps.searchBrand) {
    // Recovery via search: discover new URLs then scrape them
    const searchResult = await deps.searchBrand(state.input.brand.name ?? state.input.brand.slug)
    const newUrls = searchResult.urls.filter(
      (u) => !state.plan!.surfaces.some((s) => s.url === u),
    )
    if (newUrls.length > 0) {
      const scrapeResult = await deps.scrapeBrandUrls(newUrls.slice(0, 3), {
        renderProvider: deps.renderProvider,
        brandName: state.input.brand.name,
      })
      state = { ...state, scrapeResult: mergeRecoveryResult(state.scrapeResult, scrapeResult) }
      didRecover = true
    }
    recoveryDescription = `search found ${searchResult.urls.length} URLs, scraped ${Math.min(newUrls.length, 3)}`
  } else if (action === 'render') {
    // Recovery via render: re-scrape surfaces that had static fetch with render directive
    const renderUrls = state.plan.surfaces
      .filter((s) => s.fetch === 'static')
      .map((s) => s.url)
      .slice(0, 3)
    if (renderUrls.length > 0 && deps.renderProvider) {
      const renderDirectives = new Map<string, SurfaceDirective>()
      for (const url of renderUrls) {
        renderDirectives.set(url, { fetch: 'render', reason: 'recovery render' })
      }
      const scrapeResult = await deps.scrapeBrandUrls(renderUrls, {
        directives: renderDirectives,
        renderProvider: deps.renderProvider,
        brandName: state.input.brand.name,
      })
      state = { ...state, scrapeResult: mergeRecoveryResult(state.scrapeResult, scrapeResult) }
      didRecover = true
    }
    recoveryDescription = `render recovery on ${renderUrls.length} URLs`
  } else {
    // Default: fan-out
    const fanOutUrls = state.plan.fanOut.filter((u) =>
      !state.plan!.surfaces.some((s) => s.url === u),
    )
    if (fanOutUrls.length > 0) {
      const scrapeResult = await deps.scrapeBrandUrls(fanOutUrls, {
        renderProvider: deps.renderProvider,
        brandName: state.input.brand.name,
      })
      state = { ...state, scrapeResult: mergeRecoveryResult(state.scrapeResult, scrapeResult) }
      didRecover = true
    }
    recoveryDescription = `fan-out ${fanOutUrls.length} URLs`
  }

  return {
    ...state,
    recoveryDone: true,
    agentOutcome: didRecover ? 'recovered' : state.agentOutcome,
    decisions: [...state.decisions, {
      step: 'recover',
      action: recoveryDescription,
      reason: action,
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
 * Flow: gather → plan → execute → images → critique → (recover → imagesRecover → critique)? → finalize
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

  const wallClockStart = Date.now()

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
    imageCandidates: [],
    classifiedImages: [],
    verdict: null,
    recoveryDone: false,
    agentOutcome: 'planned',
    decisions: [],
  }

  /** Update wall-clock usage and return true if budget is exhausted. */
  function wallClockExhausted(): boolean {
    state.budget.used.wallClockMs = Date.now() - wallClockStart
    return state.budget.allowed.wallClockMs > 0 &&
      state.budget.used.wallClockMs >= state.budget.allowed.wallClockMs
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
  if (!state.plan && state.planAttempts < 2 && !wallClockExhausted()) {
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
  if (!wallClockExhausted()) {
    state = await executeNode(state, deps)
  }

  // 3b. Images — download + classify scraped images
  if (!wallClockExhausted()) {
    state = await imagesNode(state, deps, options)
  }

  // 4. Critique
  if (!wallClockExhausted()) {
    state = await critiqueNode(state, model, options)
  }

  // 5. Handle 'fail' verdict — the critique says data is unusable
  if (state.verdict?.verdict === 'fail') {
    wallClockExhausted() // final update
    return {
      agentOutcome: 'blocked',
      plan: state.plan ? boundedPlan(state.plan) : undefined,
      budget: { allowed: state.budget.allowed, used: state.budget.used },
      decisions: state.decisions,
      error: `critique_failed: ${state.verdict.reason}`,
    }
  }

  // 6. If thin and no recovery yet, recover then re-critique
  if (state.verdict?.verdict === 'thin' && !state.recoveryDone && !wallClockExhausted()) {
    state = await recoverNode(state, deps)

    // Images recover — download + classify new candidates from recovery scrape
    if (!wallClockExhausted()) {
      state = await imagesRecoverNode(state, deps, options)
    }

    // Re-critique after recovery (but don't loop again)
    if (!wallClockExhausted()) {
      state = await critiqueNode(state, model, options)
    }

    // A 'fail' after recovery is also terminal
    if (state.verdict?.verdict === 'fail') {
      wallClockExhausted()
      return {
        agentOutcome: 'blocked',
        plan: state.plan ? boundedPlan(state.plan) : undefined,
        budget: { allowed: state.budget.allowed, used: state.budget.used },
        decisions: state.decisions,
        error: `critique_failed: ${state.verdict.reason}`,
      }
    }
  }

  // Finalize — record final wall-clock usage
  wallClockExhausted()

  // ---------------------------------------------------------------------------
  // Image ranking: sort classified images by quality for hero (4:3) frame
  // ---------------------------------------------------------------------------
  const ranked = state.classifiedImages.length > 0
    ? rank(state.classifiedImages, HERO_TARGET_RATIO)
    : []

  // Build imagePool for downstream (products agent): each entry carries url, score,
  // tags, and optional pageUrl/storageKey. Capped at ~16 KB (same as acquisitionPlan).
  const MAX_IMAGE_POOL_BYTES = 16_384
  let imagePool: ImagePoolEntry[] = ranked.map((img) => ({
    url: img.storage_path ?? img.id,
    score: img.score,
    tags: [img.tag, ...(img.disposition ? [img.disposition] : [])],
    ...(img.storage_path ? { storageKey: img.storage_path } : {}),
  }))
  // Trim entries until under the cap
  while (imagePool.length > 0 && JSON.stringify(imagePool).length > MAX_IMAGE_POOL_BYTES) {
    imagePool = imagePool.slice(0, -1)
  }

  // ---------------------------------------------------------------------------
  // Catalog discovery: run if the plan has priority product URLs
  // ---------------------------------------------------------------------------
  let catalogResult: CatalogDiscoveryResult | undefined
  const catalogUrls = state.plan?.catalog
  if (
    deps.discoverCatalog &&
    catalogUrls &&
    (catalogUrls.priorityProductUrls.length > 0 || catalogUrls.entryUrls.length > 0)
  ) {
    try {
      const knownSources = state.input.knownUrls
        .slice(0, 3)
        .map((url) => ({ url, channel: 'official' as const }))
      catalogResult = await deps.discoverCatalog({
        sources: knownSources,
        entryUrls: catalogUrls.entryUrls,
        priorityProductUrls: catalogUrls.priorityProductUrls,
      })
    } catch {
      // Catalog discovery is non-critical; swallow and continue
    }
  }

  return {
    agentOutcome: state.agentOutcome,
    plan: state.plan ?? undefined,
    directives: state.directives.size > 0 ? state.directives : undefined,
    scrapeResult: state.scrapeResult ?? undefined,
    classifiedImages: state.classifiedImages,
    imagePool: imagePool.length > 0 ? imagePool : undefined,
    catalogResult,
    budget: { allowed: state.budget.allowed, used: state.budget.used },
    decisions: state.decisions,
    error: state.error,
  }
}
