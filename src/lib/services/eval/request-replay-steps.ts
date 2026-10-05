/**
 * Step catalog for `llm-eval replay` (DEV-1917, design D7).
 *
 * A logged `brand_ai_results` row carries a phase, not a step: one phase can
 * hold several prompts with disjoint reply fields (the descriptions call and the
 * editorial repair turn, the products agent's propose and repair turns). The
 * catalog splits each phase by request shape (`system` vs `messages`) and, for
 * agent turns, by the tool or schema name the turn sent. Each entry names its
 * profile key because `config.profile` is not stored on the row.
 *
 * Key and prose fields are derived from each step's response schema
 * (Tweakable Decision 3): key = enum / boolean / closed-choice fields, prose =
 * free text. Paths are dot paths; `[]` means each array element. For a tool
 * turn the paths apply to the call's `args`.
 *
 * Stockists is excluded: it made 0 calls in the DEV-1916 run.
 */

import type { LlmProfileKey } from '@/lib/constants/llm-models'

// ---------------------------------------------------------------------------
// Discriminators — pinned to their source constants by the unit test
// ---------------------------------------------------------------------------

/** The plan turn's terminal tool (`acquisition/tools.ts`, `submitPlan`). */
export const ACQUIRE_PLAN_TOOL_NAME = 'submit_plan'
/** `CRITIQUE_SCHEMA.name` (`acquisition/graph.ts`). */
export const ACQUIRE_CRITIQUE_SCHEMA_NAME = 'critique_verdict'
/** `PRODUCTS_SCHEMA.name` (`enrich-phases/products.ts`). */
export const PRODUCTS_PROPOSE_SCHEMA_NAME = 'curated_product_proposals'
/** `REPAIR_SCHEMA.name` (`products/graph.ts`). */
export const PRODUCTS_REPAIR_SCHEMA_NAME = 'curated_product_repair'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReplayStep = {
  name: string
  phases: string[]
  /** `single` = a `{system, user}` call; `messages` = an agent turn. */
  shape: 'single' | 'messages'
  profileKey: LlmProfileKey
  keyFields: string[]
  proseFields: string[]
}

/** The fields of a logged row classification reads. */
export type ReplayRowLike = { phase: string; request: unknown }

type Discriminator = { tool: string } | { schema: string }

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

const PRODUCTS_KEY_FIELDS = [
  'products[].official_url',
  'products[].category',
  'products[].subcategory',
  'products[].material',
]
const PRODUCTS_PROSE_FIELDS = ['products[].product_description_zh', 'products[].sources[].claim_zh']

/** Catalog order is report order. */
export const REPLAY_STEPS: readonly ReplayStep[] = [
  {
    name: 'detect',
    phases: ['detect'],
    shape: 'single',
    profileKey: 'detect',
    keyFields: ['isNonBrand', 'confidence'],
    proseFields: ['reasoning', 'nonBrandReason'],
  },
  {
    name: 'facts',
    phases: ['facts'],
    shape: 'single',
    profileKey: 'facts',
    keyFields: [
      'category',
      'subcategories',
      'listing.verdict',
      'listing.taiwan_connection',
      'listing.has_own_products',
      'listing.has_purchase_channel',
    ],
    proseFields: ['listing.reasoning', 'listing.reason'],
  },
  {
    name: 'founding_facts',
    phases: ['founding_facts'],
    shape: 'single',
    profileKey: 'foundingFacts',
    keyFields: ['claims[].field', 'claims[].location_context'],
    proseFields: ['claims[].exact_excerpt'],
  },
  {
    name: 'founding_facts_verify',
    phases: ['founding_facts_verify'],
    shape: 'single',
    profileKey: 'foundingFactsVerify',
    keyFields: ['results[].passed'],
    proseFields: ['results[].reason'],
  },
  {
    name: 'faq',
    phases: ['faq'],
    shape: 'single',
    profileKey: 'faq',
    keyFields: ['entries[].preset_id'],
    proseFields: ['entries[].question_zh', 'entries[].answer_zh', 'entries[].question_en', 'entries[].answer_en'],
  },
  {
    name: 'names',
    phases: ['names'],
    shape: 'single',
    profileKey: 'names',
    keyFields: ['results[].chosen', 'results[].confidence'],
    proseFields: ['results[].reason'],
  },
  {
    name: 'classify_images',
    phases: ['classify_images'],
    shape: 'single',
    profileKey: 'classifyImages',
    keyFields: ['classifications[].disposition', 'classifications[].tag', 'classifications[].reasons'],
    proseFields: ['classifications[].caption'],
  },
  {
    name: 'descriptions',
    phases: ['descriptions'],
    shape: 'single',
    profileKey: 'descriptions',
    keyFields: [],
    proseFields: ['description_zh', 'description_en', 'blurb_zh', 'blurb_en'],
  },
  {
    // Logged under the descriptions phase (`EDITORIAL_REPAIR_AUDIT_PHASE`).
    name: 'editorial_repair',
    phases: ['descriptions'],
    shape: 'messages',
    profileKey: 'editorial',
    keyFields: [],
    proseFields: ['description', 'description_en', 'blurb', 'blurb_en'],
  },
  {
    // Scored on the turn's tool call; the paths apply to `submit_plan` args.
    name: 'acquire_plan',
    phases: ['acquire'],
    shape: 'messages',
    profileKey: 'acquisition',
    keyFields: ['surfaces[].fetch', 'surfaces[].strategy'],
    proseFields: ['surfaces[].reason', 'decisions[].reason'],
  },
  {
    name: 'acquire_critique',
    phases: ['acquire'],
    shape: 'messages',
    profileKey: 'acquisition',
    keyFields: ['verdict', 'recoveryAction', 'urlVerdicts[].owned', 'urlVerdicts[].confidence'],
    proseFields: ['reason', 'urlVerdicts[].reason'],
  },
  {
    name: 'products_propose',
    phases: ['products'],
    shape: 'messages',
    profileKey: 'products_agent',
    keyFields: ['evaluations[].made_in_taiwan', 'evaluations[].materials_from_taiwan', ...PRODUCTS_KEY_FIELDS],
    proseFields: ['evaluations[].editorial_rationale', ...PRODUCTS_PROSE_FIELDS],
  },
  {
    // The repair reply is `products` only (no `evaluations`).
    name: 'products_repair',
    phases: ['products'],
    shape: 'messages',
    profileKey: 'products_agent',
    keyFields: [...PRODUCTS_KEY_FIELDS],
    proseFields: [...PRODUCTS_PROSE_FIELDS],
  },
  {
    // The legacy single call; it sends the same proposals schema as propose.
    name: 'products_fallback',
    phases: ['products'],
    shape: 'single',
    profileKey: 'products',
    keyFields: ['evaluations[].made_in_taiwan', 'evaluations[].materials_from_taiwan', ...PRODUCTS_KEY_FIELDS],
    proseFields: ['evaluations[].editorial_rationale', ...PRODUCTS_PROSE_FIELDS],
  },
]

/**
 * Steps that share a phase and shape with another step and are told apart by
 * the tool or schema the turn sent. A step absent here matches on phase and
 * shape alone.
 */
const DISCRIMINATORS: Readonly<Record<string, Discriminator>> = {
  acquire_plan: { tool: ACQUIRE_PLAN_TOOL_NAME },
  acquire_critique: { schema: ACQUIRE_CRITIQUE_SCHEMA_NAME },
  products_propose: { schema: PRODUCTS_PROPOSE_SCHEMA_NAME },
  products_repair: { schema: PRODUCTS_REPAIR_SCHEMA_NAME },
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export function replayStepByName(name: string): ReplayStep | undefined {
  return REPLAY_STEPS.find((step) => step.name === name)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function shapeOf(request: Record<string, unknown>): ReplayStep['shape'] | null {
  if (Array.isArray(request.messages)) return 'messages'
  if (typeof request.system === 'string' || typeof request.user === 'string') return 'single'
  return null
}

function toolNamesOf(request: Record<string, unknown>): string[] {
  if (!Array.isArray(request.tools)) return []
  return request.tools.flatMap((tool) => {
    const name = asRecord(tool)?.name
    return typeof name === 'string' ? [name] : []
  })
}

function discriminatorHolds(discriminator: Discriminator, request: Record<string, unknown>): boolean {
  if ('tool' in discriminator) return toolNamesOf(request).includes(discriminator.tool)
  return asRecord(request.schema)?.name === discriminator.schema
}

/**
 * The catalog step a logged row belongs to, or `null` when it matches none
 * (reported as unclassified, never scored). A phase+shape group holds either
 * one undiscriminated step or only discriminated ones, so the first match wins.
 */
export function classifyReplayRow(row: ReplayRowLike): ReplayStep | null {
  const request = asRecord(row.request)
  if (!request) return null
  const shape = shapeOf(request)
  if (!shape) return null

  for (const step of REPLAY_STEPS) {
    if (step.shape !== shape || !step.phases.includes(row.phase)) continue
    const discriminator = DISCRIMINATORS[step.name]
    if (!discriminator || discriminatorHolds(discriminator, request)) return step
  }
  return null
}
