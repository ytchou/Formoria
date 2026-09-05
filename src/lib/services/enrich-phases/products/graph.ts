/**
 * Products agent — a LangGraph `StateGraph`.
 *
 * select → read → propose → verify → (repair)? → finalize
 *
 * What this replaces (DEV-1644 F6, F13, F15, F24): a hand-rolled sequential
 * machine whose read node stored raw HTML and could never render, whose verify
 * step never called `verifyOrigin`, whose image check passed silently on an
 * empty pool, and which carried its own copy of the model turn / `extractJson` /
 * `withSchema`. Every one of those is now the shared thing: the runtime owns the
 * audited model, `read-page.ts` owns the evidence, and `verify.ts` owns the
 * verdict — including origin.
 *
 * The audit envelope is NOT this file's business (DEV-1700): the model handed in
 * through `options.model` was built by `createAgentModel` with its phase audit
 * context already bound, so every turn writes its own `brand_ai_results` row.
 *
 * The repair edge is conditional: it fires only when verification left
 * REPAIRABLE failures (closed-set or image, with the URL checks passing) and a
 * turn is still affordable. Everything else routes straight to `finalize`.
 *
 * Every external dependency — fetch, render, registry lookup, origin text,
 * image storage and classification, and the model — arrives through `deps` or
 * `options`, so the graph is exercised end to end with fakes and no service
 * mock (`scripts/check-test-boundaries.mjs` refuses those).
 *
 * NO DATABASE. The agent proposes and verifies; `products.ts` publishes. That
 * split is what lets `publishProposals` be the single owner of candidate-pool
 * persistence and Made-in-Taiwan enrichment for both this path and the
 * single-call body.
 */

import { Annotation, END, START, StateGraph, GraphRecursionError } from '@langchain/langgraph'
import { randomUUID } from 'node:crypto'

import { fetchLangfusePrompt } from '@/lib/langfuse/prompt'
import type { CuratedProductProposal } from '@/lib/types/enriched-data'
import type { RenderProvider } from '../scraper/render/types'
import type { ProductCandidate } from '../product-candidates'
import type { CandidateImage } from '../candidate-pool'
import { rankForProduct, type RankableImage } from '../image-ranking'
import type {
  ProductCandidateEvaluation,
  ProductsModelResult,
  ProductProposalValidationOptions,
} from '../products'
import {
  PRODUCTS_PROPOSAL_SHAPE,
  validateCandidateEvaluations,
  validateProductProposals,
} from '../products'
import {
  assessDeterministicOrigin,
  type OriginExcerpt,
  type RegistryOriginAssessment,
} from '@/lib/services/curated-products/origin-qualification'
import type { CandidateOriginDecision } from '@/lib/services/curated-products/candidate-selection'
import type {
  ExactRegistryLookupInput,
  ExactRegistryLookupResult,
} from '../../mit-registry'
import {
  verifySameHost,
  verifyReachable,
  verifyProposal,
  verifyClosedSets,
  type ImageVerificationStatus,
} from './verify'
import {
  budgetFor,
  assertBudget,
  PRODUCTS_BUDGET_CEILINGS,
  type ProductsBudget,
  type ProductsBudgetState,
} from './budget'
import { BudgetExhausted } from '../acquisition/budget'
import {
  contentText,
  extractJson,
  withSchema,
  withSignal,
  type AgentModel,
  type AgentModelResponse,
} from '../agents/runtime'
import type { ChatMessage } from '@/lib/services/openai-client'
import { readProductPage, type ProductPageEvidence } from './read-page'
import {
  PRODUCTS_PROPOSE_SYSTEM_PROMPT,
  PRODUCTS_REPAIR_SYSTEM_PROMPT,
  PRODUCTS_SCHEMA_TRAILER,
} from '@/lib/prompts/products-agent'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Super-step ceiling. The longest path — select, read, propose, propose (one
 * reparse), verify, repair, finalize — is seven, so this bounds a stuck
 * conditional edge without ever cutting a healthy run short.
 */
export const PRODUCTS_RECURSION_LIMIT = 12

/** Pages the agent will read. Mirrors the reads ceiling in `budgetFor`. */
const MAX_SELECT = 12

/** Propose calls before the agent gives up and lets the caller fall back. */
const MAX_PROPOSE_ATTEMPTS = 2

/** Images pulled off one product page for the decision-#35 classify batch. */
const MAX_PAGE_IMAGES_PER_PRODUCT = 6

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ProductsInput = {
  brand: { id: string; slug: string; name: string; url?: string }
  pool: ProductCandidate[]
  imagePool: RankableImage[]
  catalogResult?: unknown
  scrapedData?: unknown
  priorityProductUrls?: string[]
  /**
   * Stable per-candidate ids, shared with the rows `persistCandidatePool`
   * writes. Origin excerpt ids are derived from these, so a citation the model
   * makes here resolves against the persisted candidate row.
   */
  candidateIdsByUrl?: ReadonlyMap<string, string>
}

export type ProductsVerification = {
  read: number
  /** Pages whose body came from the render provider. */
  rendered: number
  proposed: number
  verified: number
  repaired: number
  dropped: number
  dropReasons: Record<string, number>
  /**
   * Aggregate image verdict. `unverified` means NOTHING checked the images —
   * an empty pool — which is the case that used to pass silently (F6).
   */
  image: ImageVerificationStatus
  imageVerified: number
  imageUnverified: number
  originQualified: number
  /** Images stored and classified by the in-products batch (decision #35). */
  pageImagesClassified: number
}

export type ProductsOutput = {
  agentOutcome: 'proposed' | 'repaired' | 'fallback' | 'blocked'
  proposals: CuratedProductProposal[]
  verification: ProductsVerification
  decisions: Array<{ step: string; action: string; reason: string; ms: number }>
  /** Origin qualification per candidate URL, keyed as `persistCandidatePool` expects. */
  originDecisions: Map<string, CandidateOriginDecision>
  /** Editorial scores per candidate URL, the ranker input for the candidate pool. */
  evaluations: Map<string, ProductCandidateEvaluation>
  /** The pool the image check ran against, extended by any decision-#35 batch. */
  imagePool: RankableImage[]
  budget: { allowed: ProductsBudget; used: ProductsBudget }
  error?: string
}

export type ProductsDeps = {
  fetchHtml?: (url: string) => Promise<{ text: string; statusCode: number }>
  renderProvider?: RenderProvider
  /** Rendered product text for origin excerpts. The phase's own loader. */
  loadOriginTexts?: (urls: readonly string[]) => Promise<Map<string, string>>
  /** MIT registry lookup. Absent means the registry half is simply not asserted. */
  lookupRegistryProducts?: (
    inputs: readonly ExactRegistryLookupInput[],
  ) => Promise<Map<string, ExactRegistryLookupResult>>
  /**
   * Decision #35, step one. Stores images found on a product's OWN page that
   * the acquire pool never saw, and returns one opaque handle per candidate
   * (null for a rejected candidate), positionally aligned with the input.
   */
  storePageImages?: (candidates: CandidateImage[]) => Promise<(string | null)[]>
  /**
   * Decision #35, step two. Classifies exactly those handles and returns pool
   * entries carrying the page they came from and their own url. Called AT MOST
   * ONCE per run — the whole point of the decision is one extra batch, not a
   * per-product classification loop.
   */
  classifyPageImages?: (handles: string[]) => Promise<RankableImage[]>
}

type RunOptions = {
  model?: AgentModel
  signal?: AbortSignal
  budgetOverride?: ProductsBudget
}

type Decision = ProductsOutput['decisions'][number]

type Repairable = { proposal: CuratedProductProposal; failures: string[] }

// ---------------------------------------------------------------------------
// Run context
// ---------------------------------------------------------------------------

/**
 * Mutable per-run state deliberately kept OUT of the graph channels, for the
 * same reason acquisition keeps one: a `GraphRecursionError` or an abort unwinds
 * out of `invoke()` with no final state, and the budget ledger and the decision
 * trace are exactly what an operator needs from a run that ended that way.
 */
export type ProductsRunContext = {
  input: ProductsInput
  deps: ProductsDeps
  options: RunOptions
  budget: ProductsBudgetState
  decisions: Decision[]
  candidateIds: Map<string, string>
  /** Guards decision #35 to a single batch, whatever the verify node retries. */
  pageImageBatchDone: boolean
  /** Last graph state observed by a node, for counter recovery after an abort. */
  lastState: unknown
  wallClockStart: number
  signal: AbortSignal | undefined
  record: (step: string, action: string, reason: string, startedAt: number) => void
  wallClockExhausted: () => boolean
  invokeModel: (messages: ChatMessage[]) => Promise<AgentModelResponse>
}

/**
 * Exported so a test can assert the graph's SHAPE — nodes and the conditional
 * repair edge — without invoking it. `runProductsAgent` is the only production
 * caller.
 */
export function createProductsRunContext(
  input: ProductsInput,
  deps: ProductsDeps,
  options: RunOptions = {},
): ProductsRunContext {
  const candidateIds = new Map<string, string>(
    input.candidateIdsByUrl ? [...input.candidateIdsByUrl] : [],
  )
  for (const candidate of input.pool) {
    if (!candidateIds.has(candidate.url)) candidateIds.set(candidate.url, randomUUID())
  }

  const ctx: ProductsRunContext = {
    input,
    deps,
    options,
    budget: {
      allowed: { reads: 0, renders: 0, turns: 0, wallClockMs: 0 },
      used: { reads: 0, renders: 0, turns: 0, wallClockMs: 0 },
    },
    decisions: [],
    candidateIds,
    pageImageBatchDone: false,
    lastState: null,
    wallClockStart: Date.now(),
    // The hard deadline is the CEILING; `wallClockExhausted` enforces the
    // computed allowance gracefully, one node boundary at a time.
    signal: withSignal(
      options.signal,
      AbortSignal.timeout(PRODUCTS_BUDGET_CEILINGS.wallClockMs),
    ),
    record(step, action, reason, startedAt) {
      ctx.decisions.push({ step, action, reason, ms: Date.now() - startedAt })
    },
    wallClockExhausted() {
      ctx.budget.used.wallClockMs = Date.now() - ctx.wallClockStart
      return (
        ctx.budget.allowed.wallClockMs > 0 &&
        ctx.budget.used.wallClockMs >= ctx.budget.allowed.wallClockMs
      )
    },
    // Every turn — propose and repair alike — goes through the one model the
    // caller built. Its audit context is bound at construction, so there is
    // nothing left to wrap here.
    async invokeModel(messages) {
      return options.model!.invoke(
        messages,
        ctx.signal ? { signal: ctx.signal } : undefined,
      )
    },
  }
  return ctx
}

// ---------------------------------------------------------------------------
// Graph state
// ---------------------------------------------------------------------------

/** Last-value channel: a node's update replaces the previous value. */
function lastValue<T>(initial: () => T) {
  return Annotation<T>({ reducer: (_left: T, right: T) => right, default: initial })
}

const ProductsState = Annotation.Root({
  selectedUrls: lastValue<string[]>(() => []),
  evidence: lastValue<ProductPageEvidence[]>(() => []),
  proposals: lastValue<CuratedProductProposal[]>(() => []),
  proposeAttempts: lastValue<number>(() => 0),
  evaluations: lastValue<Map<string, ProductCandidateEvaluation>>(() => new Map()),
  verified: lastValue<CuratedProductProposal[]>(() => []),
  repairable: lastValue<Repairable[]>(() => []),
  repaired: lastValue<CuratedProductProposal[]>(() => []),
  dropped: lastValue<number>(() => 0),
  dropReasons: lastValue<Record<string, number>>(() => ({})),
  imagePool: lastValue<RankableImage[]>(() => []),
  imageStatuses: lastValue<ImageVerificationStatus[]>(() => []),
  originDecisions: lastValue<Map<string, CandidateOriginDecision>>(() => new Map()),
  pageImagesClassified: lastValue<number>(() => 0),
  agentOutcome: lastValue<ProductsOutput['agentOutcome']>(() => 'proposed'),
  error: lastValue<string | undefined>(() => undefined),
})

type ProductsStateType = typeof ProductsState.State
type ProductsUpdate = Partial<ProductsStateType>

// ---------------------------------------------------------------------------
// select
// ---------------------------------------------------------------------------

/** Pure: picks up to 12 candidates, prioritizing `priorityProductUrls`. */
function selectNode(ctx: ProductsRunContext): ProductsUpdate {
  const start = Date.now()
  const pool = ctx.input.pool
  const priority = new Set(ctx.input.priorityProductUrls ?? [])

  const prioritized = pool.filter((candidate) => priority.has(candidate.url))
  const rest = pool.filter((candidate) => !priority.has(candidate.url))
  const selectedUrls = [...prioritized, ...rest].slice(0, MAX_SELECT).map((c) => c.url)

  ctx.record(
    'select',
    `selected ${selectedUrls.length} of ${pool.length} candidates`,
    `${prioritized.length} prioritized`,
    start,
  )
  return { selectedUrls, imagePool: ctx.input.imagePool }
}

// ---------------------------------------------------------------------------
// read
// ---------------------------------------------------------------------------

const DEAD_FETCH = async () => ({ text: '', statusCode: 0 })

/**
 * Reads each selected page into STRUCTURED evidence. The render decision lives
 * in `readProductPage`, which shares this budget, so a page behind a JS shell
 * costs one render here and is visible in `verification.rendered`.
 */
async function readNode(
  ctx: ProductsRunContext,
  state: ProductsStateType,
): Promise<ProductsUpdate> {
  ctx.lastState = state
  const start = Date.now()
  const evidence: ProductPageEvidence[] = []
  let exhausted: BudgetExhausted | null = null

  for (const url of state.selectedUrls) {
    try {
      assertBudget(ctx.budget, 'reads')
    } catch (error) {
      // Reported as a graph state, not thrown: LangGraph may wrap an error
      // raised inside a node, and the caller has to be able to tell a spent
      // budget from a crash so it can choose the single-call fallback.
      if (!(error instanceof BudgetExhausted)) throw error
      exhausted = error
      break
    }

    const page = await readProductPage(url, {
      fetchHtml: ctx.deps.fetchHtml ?? DEAD_FETCH,
      ...(ctx.deps.renderProvider ? { renderProvider: ctx.deps.renderProvider } : {}),
      budget: ctx.budget,
      ...(ctx.deps.loadOriginTexts ? { loadOriginTexts: ctx.deps.loadOriginTexts } : {}),
      candidateId: ctx.candidateIds.get(url) ?? url,
    })
    ctx.budget.used.reads += 1
    evidence.push(page)

    if (ctx.wallClockExhausted()) break
  }

  const rendered = evidence.filter((page) => page.rendered).length
  ctx.record(
    'read',
    `read ${evidence.length} URLs`,
    `${state.selectedUrls.length} attempted, ${rendered} rendered`,
    start,
  )

  // A partial read is still evidence. Only a read that produced NOTHING and ran
  // out of budget hands the brand back to the single-call body.
  if (exhausted && evidence.length === 0) {
    return {
      evidence,
      agentOutcome: 'fallback',
      error: `budget_exhausted: ${exhausted.message}`,
    }
  }
  return { evidence }
}

// ---------------------------------------------------------------------------
// propose
// ---------------------------------------------------------------------------

/** What the model is shown. Structured evidence, never raw markup. */
function evidenceForPrompt(page: ProductPageEvidence) {
  return {
    url: page.url,
    title: page.title,
    description: page.description,
    text: page.mainText,
    images: page.images,
    json_ld: page.jsonLd,
    product_signals: page.productSignals,
    rendered: page.rendered,
    origin_excerpts: page.originExcerpts.map((excerpt) => ({
      id: excerpt.id,
      text: excerpt.text,
    })),
  }
}

function validationOptionsFor(ctx: ProductsRunContext): ProductProposalValidationOptions {
  return {
    siteUrl: brandUrlOf(ctx),
    candidates: ctx.input.pool,
  }
}

function brandUrlOf(ctx: ProductsRunContext): string {
  return ctx.input.brand.url ?? `https://${ctx.input.brand.slug}.com`
}

async function proposeNode(
  ctx: ProductsRunContext,
  state: ProductsStateType,
): Promise<ProductsUpdate> {
  ctx.lastState = state
  const start = Date.now()
  const attempts = state.proposeAttempts + 1

  try {
    assertBudget(ctx.budget, 'turns')
  } catch {
    ctx.record('propose', 'skipped', 'budget_exhausted', start)
    return {
      proposeAttempts: attempts,
      agentOutcome: 'fallback',
      error: 'budget_exhausted_before_propose',
    }
  }

  const basePrompt = await fetchLangfusePrompt(
    'products-propose',
    PRODUCTS_PROPOSE_SYSTEM_PROMPT,
  )
  const systemPrompt = withSchema(
    basePrompt,
    'Curated Product Proposals',
    PRODUCTS_PROPOSAL_SHAPE,
    PRODUCTS_SCHEMA_TRAILER,
  )
  const userContent = JSON.stringify({
    brand: ctx.input.brand,
    candidates: state.selectedUrls,
    evidence: state.evidence.map(evidenceForPrompt),
    scrapedData: ctx.input.scrapedData,
  })

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ]

  const response = await ctx.invokeModel(messages)
  ctx.budget.used.turns += 1

  let parsed: ProductsModelResult
  try {
    parsed = JSON.parse(extractJson(contentText(response))) as ProductsModelResult
  } catch {
    ctx.record('propose', 'parse_failed', 'model returned non-JSON', start)
    return { proposeAttempts: attempts }
  }

  const validation = validateProductProposals(parsed, validationOptionsFor(ctx))
  const excerptsByUrl = new Map<string, readonly OriginExcerpt[]>(
    state.evidence.map((page) => [page.url, page.originExcerpts]),
  )
  const readCandidates = ctx.input.pool.filter((candidate) =>
    excerptsByUrl.has(candidate.url),
  )
  const evaluations = validateCandidateEvaluations(parsed, readCandidates, excerptsByUrl)

  ctx.record(
    'propose',
    `proposed ${validation.proposals.length} products`,
    `${validation.dropped} dropped during validation`,
    start,
  )
  return { proposals: validation.proposals, proposeAttempts: attempts, evaluations }
}

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

/**
 * Decision #35. When a proposal's page has images that the pool cannot rank,
 * store and classify the page's OWN images once, and extend the pool.
 *
 * "Cannot rank" rather than "url not in the pool" is the test on purpose: a
 * pool loaded back out of `brand_images` carries the page it came from but not
 * each image's own url, so set arithmetic over image urls would order a batch
 * for every product on every re-run. An unrankable page is the condition the
 * decision actually cares about.
 */
async function runPageImageBatch(
  ctx: ProductsRunContext,
  pool: RankableImage[],
  evidenceByUrl: ReadonlyMap<string, ProductPageEvidence>,
  proposals: readonly CuratedProductProposal[],
): Promise<{ pool: RankableImage[]; added: number }> {
  if (ctx.pageImageBatchDone) return { pool, added: 0 }
  if (!ctx.deps.storePageImages || !ctx.deps.classifyPageImages) return { pool, added: 0 }

  const known = new Set(
    pool.flatMap((image) => (image.imageUrl ? [image.imageUrl] : [])),
  )
  const candidates: CandidateImage[] = []
  for (const proposal of proposals) {
    if (rankForProduct(pool, proposal.officialUrl) != null) continue
    const page = evidenceByUrl.get(proposal.officialUrl)
    if (!page) continue
    for (const [position, url] of page.images
      .slice(0, MAX_PAGE_IMAGES_PER_PRODUCT)
      .entries()) {
      if (known.has(url)) continue
      known.add(url)
      candidates.push({
        url,
        source: 'scrape',
        pageUrl: proposal.officialUrl,
        method: 'products_page',
        position,
      })
    }
  }
  if (candidates.length === 0) return { pool, added: 0 }

  // Marked BEFORE the awaits: one batch means one, even if verify is re-entered.
  ctx.pageImageBatchDone = true
  const start = Date.now()
  try {
    const handles = (await ctx.deps.storePageImages(candidates)).filter(
      (handle): handle is string => typeof handle === 'string' && handle.length > 0,
    )
    if (handles.length === 0) {
      ctx.record('verify', 'page_images_stored_none', `${candidates.length} candidates`, start)
      return { pool, added: 0 }
    }
    const classified = await ctx.deps.classifyPageImages(handles)
    ctx.record(
      'verify',
      `classified ${classified.length} page images`,
      `${candidates.length} candidates, ${handles.length} stored`,
      start,
    )
    return { pool: [...pool, ...classified], added: classified.length }
  } catch (error) {
    // An image batch is enrichment. Losing it costs a product image, not a run.
    ctx.record(
      'verify',
      'page_image_batch_failed',
      error instanceof Error ? error.message.slice(0, 120) : String(error),
      start,
    )
    return { pool, added: 0 }
  }
}

/** Registry assessments for the proposed products, in one lookup. */
async function lookupRegistry(
  ctx: ProductsRunContext,
  proposals: readonly CuratedProductProposal[],
): Promise<Map<string, ExactRegistryLookupResult>> {
  if (!ctx.deps.lookupRegistryProducts || proposals.length === 0) return new Map()
  const titleByUrl = new Map(ctx.input.pool.map((c) => [c.url, c.title ?? '']))
  try {
    return await ctx.deps.lookupRegistryProducts(
      proposals.map((proposal) => ({
        candidateId: ctx.candidateIds.get(proposal.officialUrl) ?? proposal.officialUrl,
        brand: ctx.input.brand.name,
        product: titleByUrl.get(proposal.officialUrl) ?? proposal.nameZh,
        model: null,
      })),
    )
  } catch {
    // Registry lookup fails closed; consensus may still qualify.
    return new Map()
  }
}

const NO_REGISTRY_MATCH: RegistryOriginAssessment = {
  matched: false,
  recordId: null,
  reason: 'no_exact_match',
}

async function verifyNode(
  ctx: ProductsRunContext,
  state: ProductsStateType,
): Promise<ProductsUpdate> {
  ctx.lastState = state
  const start = Date.now()
  const evidenceByUrl = new Map(state.evidence.map((page) => [page.url, page]))

  const batch = await runPageImageBatch(
    ctx,
    state.imagePool,
    evidenceByUrl,
    state.proposals,
  )
  const imagePool = batch.pool

  const registryMatches = await lookupRegistry(ctx, state.proposals)
  const brandUrl = brandUrlOf(ctx)

  // Reachability comes from the page this run already read; only a proposal
  // whose page was never read costs a second request.
  const fetchFn: typeof fetch = ctx.deps.fetchHtml
    ? (async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        try {
          const result = await ctx.deps.fetchHtml!(url)
          return new Response(result.text, { status: result.statusCode || 500 })
        } catch {
          return new Response('', { status: 500 })
        }
      }) as typeof fetch
    : ((async () => new Response('', { status: 200 })) as typeof fetch)

  const verified: CuratedProductProposal[] = []
  const repairable: Repairable[] = []
  const imageStatuses: ImageVerificationStatus[] = []
  const originDecisions = new Map<string, CandidateOriginDecision>()
  let dropped = 0
  const dropReasons: Record<string, number> = {}

  for (const proposal of state.proposals) {
    const page = evidenceByUrl.get(proposal.officialUrl)
    const sameHostResult = verifySameHost(proposal.officialUrl, brandUrl)
    const reachableResult = page
      ? page.statusCode >= 200 && page.statusCode < 400
        ? { ok: true }
        : { ok: false, reason: `HTTP ${page.statusCode}` }
      : await verifyReachable(proposal.officialUrl, fetchFn)

    const deterministic = assessDeterministicOrigin(page?.originExcerpts ?? [])
    const llm = state.evaluations.get(proposal.officialUrl)?.llmOrigin ?? {
      madeInTaiwan: false,
      materialsFromTaiwan: false,
      excerptIds: [],
    }
    const registry =
      registryMatches.get(
        ctx.candidateIds.get(proposal.officialUrl) ?? proposal.officialUrl,
      )?.assessment ?? NO_REGISTRY_MATCH

    const result = verifyProposal(
      {
        url: proposal.officialUrl,
        category: proposal.category,
        subcategory: proposal.subcategory ?? undefined,
        material: proposal.material,
      },
      {
        brandUrl,
        imagePool,
        rankFn: (pool, url) => rankForProduct(pool as readonly RankableImage[], url),
        sameHostResult,
        reachableResult,
        origin: { deterministic, llm, registry },
      },
    )

    imageStatuses.push(result.imageStatus)
    if (result.origin) {
      originDecisions.set(proposal.officialUrl, {
        deterministic,
        llm,
        registry,
        mitQualified: result.origin.qualified,
        qualificationMethod: result.origin.method,
      })
    }

    if (result.ok) {
      verified.push(proposal)
    } else if (result.repairable) {
      repairable.push({ proposal, failures: result.failures })
    } else {
      dropped += 1
      for (const failure of result.failures) {
        const key = failure.split(':')[0] ?? failure
        dropReasons[key] = (dropReasons[key] ?? 0) + 1
      }
    }
  }

  ctx.record(
    'verify',
    `${verified.length} verified, ${repairable.length} repairable, ${dropped} dropped`,
    Object.entries(dropReasons)
      .map(([key, count]) => `${key}:${count}`)
      .join(', ') || 'all passed',
    start,
  )

  return {
    verified,
    repairable,
    dropped,
    dropReasons,
    imagePool,
    imageStatuses,
    originDecisions,
    pageImagesClassified: state.pageImagesClassified + batch.added,
  }
}

// ---------------------------------------------------------------------------
// repair
// ---------------------------------------------------------------------------

async function repairNode(
  ctx: ProductsRunContext,
  state: ProductsStateType,
): Promise<ProductsUpdate> {
  ctx.lastState = state
  const start = Date.now()

  const basePrompt = await fetchLangfusePrompt(
    'products-repair',
    PRODUCTS_REPAIR_SYSTEM_PROMPT,
  )
  const systemPrompt = withSchema(
    basePrompt,
    'Curated Product Proposals',
    PRODUCTS_PROPOSAL_SHAPE,
    PRODUCTS_SCHEMA_TRAILER,
  )
  const userContent = JSON.stringify({
    brand: ctx.input.brand,
    repairable: state.repairable.map(({ proposal, failures }) => ({
      proposal: {
        name_zh: proposal.nameZh,
        name_en: proposal.nameEn,
        category: proposal.category,
        subcategory: proposal.subcategory,
        material: proposal.material,
        official_url: proposal.officialUrl,
        product_description_zh: proposal.productDescriptionZh,
        sources: proposal.sources,
      },
      failures,
    })),
  })

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ]

  const response = await ctx.invokeModel(messages)
  ctx.budget.used.turns += 1

  let parsed: ProductsModelResult
  try {
    parsed = JSON.parse(extractJson(contentText(response))) as ProductsModelResult
  } catch {
    ctx.record('repair', 'parse_failed', 'model returned non-JSON', start)
    return { dropped: state.dropped + state.repairable.length }
  }

  const brandUrl = brandUrlOf(ctx)
  const validation = validateProductProposals(parsed, validationOptionsFor(ctx))

  // Re-verify the checks the repair was allowed to touch. A repair that
  // "fixes" a proposal into a different host is not a repair.
  const reVerified = validation.proposals.filter((proposal) => {
    const closedSet = verifyClosedSets({
      category: proposal.category,
      subcategory: proposal.subcategory ?? undefined,
      material: proposal.material,
    })
    return closedSet.ok && verifySameHost(proposal.officialUrl, brandUrl).ok
  })

  ctx.record(
    'repair',
    `repaired ${reVerified.length} of ${state.repairable.length}`,
    `${validation.dropped} dropped during repair validation, ${validation.proposals.length - reVerified.length} failed re-verification`,
    start,
  )

  return {
    repaired: reVerified,
    dropped: state.dropped + (state.repairable.length - reVerified.length),
    ...(reVerified.length > 0 ? { agentOutcome: 'repaired' as const } : {}),
  }
}

// ---------------------------------------------------------------------------
// finalize
// ---------------------------------------------------------------------------

function finalizeNode(ctx: ProductsRunContext, state: ProductsStateType): ProductsUpdate {
  ctx.lastState = state
  const start = Date.now()
  ctx.wallClockExhausted() // records the final wall-clock usage
  ctx.record(
    'finalize',
    `${state.verified.length + state.repaired.length} proposals`,
    state.error ?? 'complete',
    start,
  )
  return {}
}

// ---------------------------------------------------------------------------
// Graph assembly
// ---------------------------------------------------------------------------

/** `true` when one more model turn is affordable. */
function turnsRemain(ctx: ProductsRunContext): boolean {
  try {
    assertBudget(ctx.budget, 'turns')
    return true
  } catch {
    return false
  }
}

/**
 * Every conditional edge names its own destinations. Without the third
 * argument LangGraph has to assume a router may reach ANY node, which both
 * loses the drawn shape and hides a router that returns a name no edge covers.
 */
export function buildProductsGraph(ctx: ProductsRunContext) {
  return new StateGraph(ProductsState)
    .addNode('select', () => selectNode(ctx))
    .addNode('read', (state) => readNode(ctx, state))
    .addNode('propose', (state) => proposeNode(ctx, state))
    .addNode('verify', (state) => verifyNode(ctx, state))
    .addNode('repair', (state) => repairNode(ctx, state))
    .addNode('finalize', (state) => finalizeNode(ctx, state))
    .addEdge(START, 'select')
    .addConditionalEdges(
      'select',
      (): 'read' | 'finalize' => (ctx.wallClockExhausted() ? 'finalize' : 'read'),
      ['read', 'finalize'],
    )
    .addConditionalEdges(
      'read',
      (state): 'propose' | 'finalize' =>
        state.agentOutcome === 'fallback' || ctx.wallClockExhausted()
          ? 'finalize'
          : 'propose',
      ['propose', 'finalize'],
    )
    .addConditionalEdges(
      'propose',
      (state): 'propose' | 'verify' | 'finalize' => {
        if (state.agentOutcome === 'fallback') return 'finalize'
        if (state.proposals.length > 0) {
          return ctx.wallClockExhausted() ? 'finalize' : 'verify'
        }
        // One reparse, then give the brand back to the caller. The self-edge is
        // what `PRODUCTS_RECURSION_LIMIT` ultimately backstops.
        if (state.proposeAttempts < MAX_PROPOSE_ATTEMPTS && !ctx.wallClockExhausted()) {
          return 'propose'
        }
        return 'finalize'
      },
      ['propose', 'verify', 'finalize'],
    )
    .addConditionalEdges(
      'verify',
      (state): 'repair' | 'finalize' =>
        state.repairable.length > 0 && turnsRemain(ctx) && !ctx.wallClockExhausted()
          ? 'repair'
          : 'finalize',
      ['repair', 'finalize'],
    )
    .addEdge('repair', 'finalize')
    .addEdge('finalize', END)
    .compile()
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const EMPTY_VERIFICATION: ProductsVerification = {
  read: 0,
  rendered: 0,
  proposed: 0,
  verified: 0,
  repaired: 0,
  dropped: 0,
  dropReasons: {},
  image: 'unverified',
  imageVerified: 0,
  imageUnverified: 0,
  originQualified: 0,
  pageImagesClassified: 0,
}

function outputFrom(
  state: ProductsStateType | null,
  ctx: ProductsRunContext,
  overrides: Partial<ProductsOutput> = {},
): ProductsOutput {
  const imageVerified = (state?.imageStatuses ?? []).filter((s) => s === 'verified').length
  const imageUnverified = (state?.imageStatuses ?? []).filter(
    (s) => s === 'unverified',
  ).length
  const originQualified = [
    ...(state?.originDecisions ?? new Map<string, CandidateOriginDecision>()).values(),
  ].filter((decision) => decision.mitQualified).length

  const verification: ProductsVerification = state
    ? {
        read: state.evidence.length,
        rendered: state.evidence.filter((page) => page.rendered).length,
        proposed: state.proposals.length,
        verified: state.verified.length,
        repaired: state.repaired.length,
        dropped: state.dropped,
        dropReasons: state.dropReasons,
        // Aggregate: verified wins, then unverified (nothing checked), then
        // missing (checked, nothing found).
        image:
          imageVerified > 0
            ? 'verified'
            : imageUnverified > 0 || state.imagePool.length === 0
              ? 'unverified'
              : 'missing',
        imageVerified,
        imageUnverified,
        originQualified,
        pageImagesClassified: state.pageImagesClassified,
      }
    : { ...EMPTY_VERIFICATION }

  return {
    agentOutcome: state?.agentOutcome ?? 'fallback',
    proposals: state ? [...state.verified, ...state.repaired] : [],
    verification,
    decisions: ctx.decisions,
    originDecisions: state?.originDecisions ?? new Map(),
    evaluations: state?.evaluations ?? new Map(),
    imagePool: state?.imagePool ?? ctx.input.imagePool,
    budget: { allowed: ctx.budget.allowed, used: ctx.budget.used },
    ...(state?.error ? { error: state.error } : {}),
    ...overrides,
  }
}

/**
 * Runs the products agent for a single brand. Never throws: every failure path
 * resolves to `fallback` or `blocked` so `products.ts` can decide between the
 * single-call body and a `skipped` phase result.
 */
export async function runProductsAgent(
  input: ProductsInput,
  deps: ProductsDeps,
  options: RunOptions = {},
): Promise<ProductsOutput> {
  const ctx = createProductsRunContext(input, deps, options)

  if (!options.model) {
    return outputFrom(null, ctx, { agentOutcome: 'blocked', error: 'no_model_provided' })
  }
  // FAILS CLOSED, and the caller must NOT retry the single-call body on this:
  // no candidates means the model would be asked to pick product pages while
  // being shown none (tweakable #6, decision #14).
  if (input.pool.length === 0) {
    return outputFrom(null, ctx, { agentOutcome: 'blocked', error: 'empty_pool' })
  }
  if (options.signal?.aborted) {
    return outputFrom(null, ctx, { agentOutcome: 'fallback', error: 'aborted' })
  }

  // The renders allowance starts at zero and `allowRenderFor` grows it from
  // what the reads actually find; `budgetFor` has no probe to size it from.
  ctx.budget.allowed = options.budgetOverride
    ? { ...options.budgetOverride }
    : budgetFor({ length: input.pool.length, needsRendering: 0 })

  try {
    const state = (await buildProductsGraph(ctx).invoke(
      { agentOutcome: 'proposed', imagePool: input.imagePool },
      {
        recursionLimit: PRODUCTS_RECURSION_LIMIT,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      },
    )) as ProductsStateType

    if (state.proposals.length === 0 && state.agentOutcome !== 'fallback') {
      return outputFrom(state, ctx, { agentOutcome: 'fallback', error: 'no_proposals' })
    }
    return outputFrom(state, ctx)
  } catch (error) {
    // Use the last observed state for counter recovery rather than zeroing
    // everything with EMPTY_VERIFICATION.
    const recovered = (ctx.lastState ?? null) as ProductsStateType | null
    if (error instanceof BudgetExhausted) {
      ctx.record('graph', 'stopped', `budget_exhausted: ${error.kind}`, ctx.wallClockStart)
      return outputFrom(recovered, ctx, {
        agentOutcome: 'fallback',
        error: `budget_exhausted: ${error.message}`,
      })
    }
    if (error instanceof GraphRecursionError) {
      ctx.record('graph', 'stopped', 'recursion_limit', ctx.wallClockStart)
      return outputFrom(recovered, ctx, { agentOutcome: 'fallback', error: 'recursion_limit' })
    }
    const aborted =
      options.signal?.aborted ||
      ctx.signal?.aborted ||
      (error instanceof Error &&
        (error.name === 'AbortError' || error.name === 'TimeoutError'))
    if (aborted) {
      ctx.record('graph', 'stopped', 'aborted', ctx.wallClockStart)
      return outputFrom(recovered, ctx, { agentOutcome: 'fallback', error: 'aborted' })
    }
    throw error
  }
}
