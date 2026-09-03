/**
 * Products agent graph. Orchestrates the select → read → propose → verify →
 * repair → finalize flow as a linear state machine.
 *
 * All external dependencies (fetch, render, model) are injected so the graph
 * is fully testable with fakes.
 */

import { HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import type { Runnable } from '@langchain/core/runnables'
import { z } from 'zod'
import type { RenderProvider } from '../scraper/render/types'
import type { ProductCandidate } from '../product-candidates'
import type { RankableImage } from '../image-ranking'
import { rankForProduct } from '../image-ranking'
import type { CuratedProductProposal } from '@/lib/types/enriched-data'
import type { ProductsModelResult, ProductProposalValidationOptions } from '../products'
import { validateProductProposals } from '../products'
import { toStrictJsonSchema } from '../../_shared/zod-schema'
import {
  verifySameHost,
  verifyReachable,
  verifyProposal,
  verifyClosedSets,
} from './verify'
import {
  budgetFor,
  assertBudget,
  type ProductsBudget,
  type ProductsBudgetState,
} from './budget'
import { BudgetExhausted } from '../acquisition/budget'
import { invokeAudited, type AuditBridgeContext } from '../acquisition/audit-bridge'
import {
  PRODUCTS_PROPOSE_SYSTEM_PROMPT,
  PRODUCTS_REPAIR_SYSTEM_PROMPT,
  PRODUCTS_SCHEMA_TRAILER,
} from '@/lib/prompts/products-agent'

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
}

export type ProductsOutput = {
  agentOutcome: 'proposed' | 'repaired' | 'fallback' | 'blocked'
  proposals: CuratedProductProposal[]
  verification: ProductsVerification
  decisions: Array<{ step: string; action: string; reason: string; ms: number }>
  error?: string
}

type ProductsVerification = {
  read: number
  proposed: number
  verified: number
  repaired: number
  dropped: number
  dropReasons: Record<string, number>
}

export type ProductsDeps = {
  fetchHtml?: (url: string) => Promise<{ text: string; statusCode: number }>
  renderProvider?: RenderProvider
}

type RunOptions = {
  model?: Runnable
  signal?: AbortSignal
  audit?: Omit<AuditBridgeContext, 'phase'> & { phase?: string }
  budgetOverride?: ProductsBudget
}

type ModelResponse = { content: unknown }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function callModel(
  model: Runnable,
  messages: BaseMessage[],
  options: RunOptions,
): Promise<ModelResponse> {
  if (!options.audit) return (await model.invoke(messages)) as ModelResponse
  return (await invokeAudited(
    model as unknown as Parameters<typeof invokeAudited>[0],
    messages,
    { ...options.audit, phase: options.audit.phase ?? 'products' },
  )) as ModelResponse
}

/**
 * Agent-specific product schema. Mirrors the `products` array from the
 * monolithic `productsShape` in `products.ts`, without the `evaluations` key
 * the agent does not use. Inlined into the prompt so the model sees the exact
 * field names `validateProductProposals` reads.
 */
const agentProductsSchema = z.object({
  products: z.array(
    z.object({
      name_zh: z.string(),
      name_en: z.string().nullable(),
      category: z.string().nullable(),
      subcategory: z.string().nullable(),
      material: z.array(z.string()),
      official_url: z.string(),
      image_source_url: z.string().nullable(),
      product_description_zh: z.string(),
      sources: z.array(
        z.object({
          url: z.string(),
          source_type: z.string(),
          claim_zh: z.string().nullable(),
        }),
      ),
    }),
  ),
})

function withSchema(prompt: string): string {
  return `${prompt}\n\n## Curated Product Proposals JSON Schema\n\`\`\`json\n${JSON.stringify(toStrictJsonSchema(agentProductsSchema))}\n\`\`\`\n${PRODUCTS_SCHEMA_TRAILER}`
}

function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  return (fenced?.[1] ?? text).trim()
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

type GraphState = {
  input: ProductsInput
  budget: ProductsBudgetState
  selectedUrls: string[]
  readEvidence: Map<string, string>
  proposals: CuratedProductProposal[]
  verified: CuratedProductProposal[]
  repairable: Array<{ proposal: CuratedProductProposal; failures: string[] }>
  repaired: CuratedProductProposal[]
  dropped: number
  dropReasons: Record<string, number>
  proposeAttempts: number
  agentOutcome: ProductsOutput['agentOutcome']
  decisions: ProductsOutput['decisions']
  error?: string
}

function emptyState(input: ProductsInput): GraphState {
  return {
    input,
    budget: {
      allowed: { reads: 0, renders: 0, turns: 0, wallClockMs: 0 },
      used: { reads: 0, renders: 0, turns: 0, wallClockMs: 0 },
    },
    selectedUrls: [],
    readEvidence: new Map(),
    proposals: [],
    verified: [],
    repairable: [],
    repaired: [],
    dropped: 0,
    dropReasons: {},
    proposeAttempts: 0,
    agentOutcome: 'proposed',
    decisions: [],
  }
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

/** Pure: picks up to 12 candidates, prioritizing `priorityProductUrls`. */
function selectNode(state: GraphState): GraphState {
  const start = Date.now()
  const MAX_SELECT = 12
  const pool = state.input.pool
  const priority = new Set(state.input.priorityProductUrls ?? [])

  // Prioritized first, then the rest, capped at MAX_SELECT
  const prioritized = pool.filter((c) => priority.has(c.url))
  const rest = pool.filter((c) => !priority.has(c.url))
  const selected = [...prioritized, ...rest].slice(0, MAX_SELECT)
  const urls = selected.map((c) => c.url)

  return {
    ...state,
    selectedUrls: urls,
    decisions: [
      ...state.decisions,
      {
        step: 'select',
        action: `selected ${urls.length} of ${pool.length} candidates`,
        reason: `${prioritized.length} prioritized`,
        ms: Date.now() - start,
      },
    ],
  }
}

/** Fetches evidence per URL, budget-gated on reads. */
async function readNode(
  state: GraphState,
  deps: ProductsDeps,
): Promise<GraphState> {
  const start = Date.now()
  const evidence = new Map(state.readEvidence)
  let readsUsed = state.budget.used.reads
  const rendersUsed = state.budget.used.renders

  for (const url of state.selectedUrls) {
    try {
      assertBudget(state.budget, 'reads')
    } catch {
      throw new BudgetExhausted('reads' as never)
    }

    try {
      let text = ''
      if (deps.fetchHtml) {
        const result = await deps.fetchHtml(url)
        text = result.text
      }
      evidence.set(url, text)
      readsUsed++
      state.budget.used.reads = readsUsed
    } catch (err) {
      if (err instanceof BudgetExhausted) throw err
      // Fetch failure: skip this URL
    }
  }

  return {
    ...state,
    readEvidence: evidence,
    budget: {
      ...state.budget,
      used: { ...state.budget.used, reads: readsUsed, renders: rendersUsed },
    },
    decisions: [
      ...state.decisions,
      {
        step: 'read',
        action: `read ${evidence.size} URLs`,
        reason: `${state.selectedUrls.length} attempted`,
        ms: Date.now() - start,
      },
    ],
  }
}

/** Model call: propose products from evidence. */
async function proposeNode(
  state: GraphState,
  model: Runnable,
  options: RunOptions,
): Promise<GraphState> {
  const start = Date.now()

  try {
    assertBudget(state.budget, 'turns')
  } catch {
    return { ...state, agentOutcome: 'fallback', error: 'budget_exhausted_before_propose' }
  }

  const systemPrompt = withSchema(PRODUCTS_PROPOSE_SYSTEM_PROMPT)

  const evidenceEntries = Array.from(state.readEvidence.entries()).map(
    ([url, text]) => ({ url, text: text.slice(0, 4000) }),
  )

  const userContent = JSON.stringify({
    brand: state.input.brand,
    candidates: state.selectedUrls,
    evidence: evidenceEntries,
    scrapedData: state.input.scrapedData,
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

  let parsed: unknown
  try {
    parsed = JSON.parse(extractJson(content))
  } catch {
    return {
      ...state,
      proposeAttempts: state.proposeAttempts + 1,
      decisions: [
        ...state.decisions,
        {
          step: 'propose',
          action: 'parse_failed',
          reason: 'model returned non-JSON',
          ms: Date.now() - start,
        },
      ],
    }
  }

  const brandUrl = state.input.brand.url ?? `https://${state.input.brand.slug}.com`
  const validationOptions: ProductProposalValidationOptions = {
    siteUrl: brandUrl,
    candidates: state.input.pool,
  }

  const validation = validateProductProposals(
    parsed as ProductsModelResult,
    validationOptions,
  )

  return {
    ...state,
    proposals: validation.proposals,
    proposeAttempts: state.proposeAttempts + 1,
    decisions: [
      ...state.decisions,
      {
        step: 'propose',
        action: `proposed ${validation.proposals.length} products`,
        reason: `${validation.dropped} dropped during validation`,
        ms: Date.now() - start,
      },
    ],
  }
}

/** Code-only: verify each proposal. */
async function verifyNode(
  state: GraphState,
  deps: ProductsDeps,
): Promise<GraphState> {
  const start = Date.now()
  const verified: CuratedProductProposal[] = []
  const repairable: Array<{ proposal: CuratedProductProposal; failures: string[] }> = []
  let dropped = 0
  const dropReasons: Record<string, number> = {}

  const brandUrl = state.input.brand.url ?? `https://${state.input.brand.slug}.com`
  // Use a simple fetch for reachability in verify — if no fetchHtml, assume reachable
  const fetchFn: typeof fetch = deps.fetchHtml
    ? (async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        try {
          const result = await deps.fetchHtml!(url)
          return new Response(result.text, { status: result.statusCode })
        } catch {
          return new Response('', { status: 500 })
        }
      }) as typeof fetch
    : (async () => new Response('', { status: 200 })) as typeof fetch

  for (const proposal of state.proposals) {
    const sameHostResult = verifySameHost(proposal.officialUrl, brandUrl)
    const reachableResult = await verifyReachable(proposal.officialUrl, fetchFn)

    const result = verifyProposal(
      {
        url: proposal.officialUrl,
        category: proposal.category,
        subcategory: proposal.subcategory ?? undefined,
        material: proposal.material,
      },
      {
        brandUrl,
        imagePool: state.input.imagePool,
        rankFn: (pool, url) =>
          rankForProduct(pool as readonly RankableImage[], url),
        sameHostResult,
        reachableResult,
      },
    )

    if (result.ok) {
      verified.push(proposal)
    } else if (result.repairable) {
      repairable.push({ proposal, failures: result.failures })
    } else {
      dropped++
      for (const f of result.failures) {
        const key = f.split(':')[0] ?? f
        dropReasons[key] = (dropReasons[key] ?? 0) + 1
      }
    }
  }

  return {
    ...state,
    verified,
    repairable,
    dropped,
    dropReasons,
    decisions: [
      ...state.decisions,
      {
        step: 'verify',
        action: `${verified.length} verified, ${repairable.length} repairable, ${dropped} dropped`,
        reason: Object.entries(dropReasons)
          .map(([k, v]) => `${k}:${v}`)
          .join(', ') || 'all passed',
        ms: Date.now() - start,
      },
    ],
  }
}

/** Model call on repairable proposals, budget-gated at 1 turn. */
async function repairNode(
  state: GraphState,
  model: Runnable,
  options: RunOptions,
): Promise<GraphState> {
  const start = Date.now()
  if (state.repairable.length === 0) return state

  try {
    assertBudget(state.budget, 'turns')
  } catch {
    // No budget for repair — drop repairable as unrepaired
    return {
      ...state,
      dropped: state.dropped + state.repairable.length,
      decisions: [
        ...state.decisions,
        {
          step: 'repair',
          action: 'skipped',
          reason: 'budget_exhausted',
          ms: Date.now() - start,
        },
      ],
    }
  }

  const systemPrompt = withSchema(PRODUCTS_REPAIR_SYSTEM_PROMPT)
  const userContent = JSON.stringify({
    brand: state.input.brand,
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

  const messages: BaseMessage[] = [
    new SystemMessage(systemPrompt),
    new HumanMessage(userContent),
  ]

  const response = await callModel(model, messages, options)
  state.budget.used.turns++

  const content = typeof response.content === 'string'
    ? response.content
    : JSON.stringify(response.content)

  let parsed: unknown
  try {
    parsed = JSON.parse(extractJson(content))
  } catch {
    return {
      ...state,
      dropped: state.dropped + state.repairable.length,
      decisions: [
        ...state.decisions,
        {
          step: 'repair',
          action: 'parse_failed',
          reason: 'model returned non-JSON',
          ms: Date.now() - start,
        },
      ],
    }
  }

  const brandUrl = state.input.brand.url ?? `https://${state.input.brand.slug}.com`
  const validation = validateProductProposals(
    parsed as ProductsModelResult,
    { siteUrl: brandUrl, candidates: state.input.pool },
  )

  // Re-verify closed sets and same-host on repaired proposals
  const reVerified = validation.proposals.filter((p) => {
    const closedSet = verifyClosedSets({
      category: p.category,
      subcategory: p.subcategory ?? undefined,
      material: p.material,
    })
    const sameHost = verifySameHost(p.officialUrl, brandUrl)
    return closedSet.ok && sameHost.ok
  })

  return {
    ...state,
    repaired: reVerified,
    agentOutcome: reVerified.length > 0 ? 'repaired' : state.agentOutcome,
    decisions: [
      ...state.decisions,
      {
        step: 'repair',
        action: `repaired ${reVerified.length} of ${state.repairable.length}`,
        reason: `${validation.dropped} dropped during repair validation, ${validation.proposals.length - reVerified.length} failed re-verification`,
        ms: Date.now() - start,
      },
    ],
  }
}

/** Collect verified + repaired, build output. */
function finalizeNode(state: GraphState): ProductsOutput {
  const allProposals = [...state.verified, ...state.repaired]

  const verification: ProductsVerification = {
    read: state.readEvidence.size,
    proposed: state.proposals.length,
    verified: state.verified.length,
    repaired: state.repaired.length,
    dropped: state.dropped,
    dropReasons: state.dropReasons,
  }

  return {
    agentOutcome: state.agentOutcome,
    proposals: allProposals,
    verification,
    decisions: state.decisions,
    error: state.error,
  }
}

// ---------------------------------------------------------------------------
// Graph orchestration
// ---------------------------------------------------------------------------

/**
 * Runs the products agent for a single brand. Linear state machine:
 * select → read → propose → verify → repair → finalize.
 */
export async function runProductsAgent(
  input: ProductsInput,
  deps: ProductsDeps,
  options: RunOptions = {},
): Promise<ProductsOutput> {
  const model = options.model
  if (!model) {
    return {
      agentOutcome: 'blocked',
      proposals: [],
      verification: { read: 0, proposed: 0, verified: 0, repaired: 0, dropped: 0, dropReasons: {} },
      decisions: [],
      error: 'no_model_provided',
    }
  }

  if (input.pool.length === 0) {
    return {
      agentOutcome: 'blocked',
      proposals: [],
      verification: { read: 0, proposed: 0, verified: 0, repaired: 0, dropped: 0, dropReasons: {} },
      decisions: [],
      error: 'empty_pool',
    }
  }

  const wallClockStart = Date.now()

  let state = emptyState(input)

  // Compute budget from pool
  const needsRenderCount = input.pool.filter((_c) =>
    // ProductCandidate has no needsRendering field; count zero by default
    false,
  ).length
  state.budget.allowed = budgetFor({ length: input.pool.length, needsRendering: needsRenderCount })

  // Test-only budget override
  if (options.budgetOverride) {
    state.budget.allowed = { ...options.budgetOverride }
  }

  function wallClockExhausted(): boolean {
    state.budget.used.wallClockMs = Date.now() - wallClockStart
    return state.budget.allowed.wallClockMs > 0 &&
      state.budget.used.wallClockMs >= state.budget.allowed.wallClockMs
  }

  try {
    // 1. Select
    state = selectNode(state)
    if (wallClockExhausted()) return finalizeNode(state)

    // 2. Read
    state = await readNode(state, deps)
    if (wallClockExhausted()) return finalizeNode(state)

    // 3. Propose (with one retry on parse failure)
    state = await proposeNode(state, model, options)
    if (state.proposals.length === 0 && state.proposeAttempts < 2 && !wallClockExhausted()) {
      state = await proposeNode(state, model, options)
    }
    if (state.proposals.length === 0) {
      state.agentOutcome = 'fallback'
      state.error = state.error ?? 'no_proposals'
      return finalizeNode(state)
    }
    if (wallClockExhausted()) return finalizeNode(state)

    // 4. Verify
    state = await verifyNode(state, deps)
    if (wallClockExhausted()) return finalizeNode(state)

    // 5. Repair
    if (state.repairable.length > 0 && !wallClockExhausted()) {
      state = await repairNode(state, model, options)
    }

    // 6. Finalize
    return finalizeNode(state)
  } catch (err) {
    if (err instanceof BudgetExhausted) {
      state.agentOutcome = 'fallback'
      state.error = `budget_exhausted: ${err.message}`
      return finalizeNode(state)
    }
    throw err
  }
}
