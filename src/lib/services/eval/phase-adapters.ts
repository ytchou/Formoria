import type { ZodType } from 'zod'
import { z } from 'zod'

import {
  CATEGORY_LIST,
  SUBCATEGORY_VOCAB_BLOCK,
  MATERIAL_VOCAB_BLOCK,
  TAIWAN_USAGE_RULES,
} from '@/lib/prompts'
import { detectBatchShape, classifyBatchShape } from '@/lib/services/category-classifier'
import { nameArbitrationShape } from '@/lib/services/name-arbiter'
import { siteIdentityShape } from '@/lib/services/site-identity-arbiter'
import { resolveQuarantine } from '@/lib/services/enrich-phases/site-identity'
import { descriptionShape } from '@/lib/services/description-rewrite'
import { isHighConfidenceWrite } from '@/lib/services/enrich-phases/detect'
import { parseAndValidate, toStrictJsonSchema } from '@/lib/services/_shared/zod-schema'
import { createProfiledOpenAIClient, profileChatParams } from '@/lib/services/llm-audit'
import { decide as typesafeDecide } from '@/lib/services/typesafe-audit'
import {
  INTENT_PARSE_JSON_SCHEMA,
  INTENT_PARSE_SYSTEM_PROMPT,
  intentParseShape,
  validateSubcategory,
  type IntentParseResult,
} from '@/lib/services/query-intent-parse'
import { describeError } from '@/lib/errors'
import { renderEditorialBands } from '@/lib/constants/curated-products'
import { PRODUCTS_PROPOSAL_SHAPE } from '@/lib/services/enrich-phases/products'
import {
  categoryAgreement,
  confidenceBandAgreement,
  writeEligibleAgreement,
  decisionAgreement,
  schemaCompliance,
  bannedTermScore,
  bandAgreement,
  withinPoolOrderingAgreement,
  selectionAgreement,
  originWhenSourced,
} from './scorers'
import {
  JEV_CANDIDATES,
  runJevCandidate,
  type DecideFn,
  type JevCandidate,
  type TwoStepJevCandidate,
} from './jev-questions'
import type { JevState } from '../typesafe-client'
import {
  jaccard,
  productsExpectedSchema,
  summarizeCalibration,
  bandConfusion,
  tieBreakAblation,
  windowSweep,
  type ProductsReplayOutput,
  type ProductsExpected,
} from './products-calibration'
import { productsTask } from './products-replay'
import { createAgentModel } from '../enrich-phases/agents/runtime'
import { runProductsAgent } from '../enrich-phases/products/graph'
import type { ArmResult, ExperimentItem, ExperimentArm } from './run-experiment'

// ---------------------------------------------------------------------------
// PhaseAdapter type
// ---------------------------------------------------------------------------

export interface PhaseAdapter {
  promptName: string | null
  variables?: Record<string, string>
  profileKey: string
  outputSchema: ZodType
  requestSchema: { name: string; schema: object }
  parseOutput(content: string): { ok: true; data: unknown } | { ok: false; error: unknown }
  unwrap: (output: unknown) => unknown
  expectedOf: (item: { expectedOutput: unknown }) => unknown
  expectedSchema: ZodType
  /**
   * A scorer returns null when it does not apply to the item (n/a).
   * `nullable` scorers are left absent (not zeroed) on failed items, so their
   * mean stays a metric of applicable items; failures show in the failed count.
   */
  scorers: Array<{ name: string; fn: (output: unknown, expected: unknown) => number | null; nullable?: true }>
  mode: 'scored' | 'pairwise'
  task?: (item: ExperimentItem, arm: ExperimentArm, ctx: { itemRunId: string; model?: string }) => Promise<{
    ok: boolean
    output: unknown
    error?: string
    promptMeta?: { name: string; version: number; source: 'langfuse' | 'snapshot' }
  }>
  /**
   * Jev decision path, used by custom arms whose value starts with `jev:`.
   * It always calls the pinned `JEV_MODEL`, the only version `parseArm` accepts.
   * An output that carries a numeric `probability` adds a threshold sweep to
   * the run summary.
   */
  decide?: (item: ExperimentItem, ctx: { itemRunId: string }) => Promise<{
    ok: boolean
    output: unknown
    error?: string
  }>
  summarize?: (results: ArmResult[]) => string
  reviewView?: (item: ExperimentItem) => unknown
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeParseOutput(schema: ZodType): PhaseAdapter['parseOutput'] {
  return (content: string) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch (e) {
      return { ok: false, error: e }
    }
    const result = schema.safeParse(parsed)
    if (result.success) {
      return { ok: true, data: result.data }
    }
    return { ok: false, error: result.error }
  }
}

function makeRequestSchema(name: string, schema: ZodType): { name: string; schema: object } {
  return { name, schema: toStrictJsonSchema(schema) }
}

/**
 * The `decide` hook for a Jev candidate: the golden item's `input` goes to the
 * candidate as-is, and its output is shaped for the adapter's scorers.
 */
function jevDecide<I, S extends JevState, O>(
  candidate: JevCandidate<I, S, O> | TwoStepJevCandidate<I, S, O>,
  decide: DecideFn,
): NonNullable<PhaseAdapter['decide']> {
  return async (item) => {
    try {
      const { output } = await runJevCandidate(candidate, decide, item.input as I)
      return { ok: true, output }
    } catch (e) {
      return { ok: false, output: null, error: describeError(e) }
    }
  }
}

// ---------------------------------------------------------------------------
// intent-parse task — the live /discover?q= request, minus cache and timeout fallbacks
// ---------------------------------------------------------------------------

type IntentCallModel = (
  input: { system: string; user: string; schema: typeof INTENT_PARSE_JSON_SCHEMA },
  options: { model?: string },
) => Promise<{ ok: boolean; content: string }>

/** The same audited client, profile params and schema `parseQueryIntent` uses (gpt-4o-mini). */
const defaultIntentCallModel: IntentCallModel = async (input, options) => {
  const client = createProfiledOpenAIClient('intentParse', { phase: 'intentParse' }, { model: options.model })
  const result = await client.chat({
    system: input.system,
    user: input.user,
    json: true,
    schema: input.schema,
    ...profileChatParams('intentParse'),
  })
  return { ok: result.response.ok, content: result.content ?? '' }
}

function intentParseTask(callModel: IntentCallModel): NonNullable<PhaseAdapter['task']> {
  return async (item, _arm, ctx) => {
    try {
      const { query } = item.input as { query: string }
      const result = await callModel(
        { system: INTENT_PARSE_SYSTEM_PROMPT, user: query, schema: INTENT_PARSE_JSON_SCHEMA },
        { model: ctx.model },
      )
      if (!result.ok) return { ok: false, output: null, error: 'Model call failed' }
      const parsed = parseAndValidate(result.content, intentParseShape)
      if (!parsed.success) return { ok: false, output: null, error: 'Output parsing failed' }
      // Same post-processing as the live path: an L2 outside the taxonomy or its L1 is dropped.
      return { ok: true, output: validateSubcategory(parsed.data) }
    } catch (e) {
      return { ok: false, output: null, error: describeError(e) }
    }
  }
}

// ---------------------------------------------------------------------------
// Expected schemas for golden datasets (DEV-1649 expected output shapes)
// ---------------------------------------------------------------------------

const detectExpectedSchema = z.object({
  isNonBrand: z.boolean(),
  confidence: z.string(),
  slugGenerated: z.string().nullable().optional(),
  brandName: z.string().nullable().optional(),
})

const categoryExpectedSchema = z.object({
  category: z.string(),
  subcategory: z.string().nullable().optional(),
  confidence: z.string(),
  writeEligible: z.boolean().optional(),
})

const nameExpectedSchema = z.object({
  chosen: z.string(),
  confidence: z.string(),
})

const siteIdentityExpectedSchema = z.object({
  owned: z.boolean(),
  confidence: z.string(),
  writeEligible: z.boolean().optional(),
})

/**
 * A labelled intent. Seeded items carry `expectedOutput: null` and stay
 * ARCHIVED until prelabel, so this schema never sees them: prelabel validates
 * the label it writes, and `cmdRun` reads ACTIVE items only. `category` is
 * nullable like `intentParseShape`: a query with no L1 is a valid label.
 */
const intentExpectedSchema = z.object({
  category: z.string().nullable(),
  subcategory: z.string().nullable(),
  materials: z.array(z.string()),
})

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

type BatchResult = { results: unknown[] }

/** Static adapter fields. The injectable model-calling hooks come from `transportHooks`. */
const registry: Record<string, PhaseAdapter> = {
  'detect-confidence-golden': {
    promptName: 'detect',
    profileKey: 'detectBatch',
    outputSchema: detectBatchShape,
    requestSchema: makeRequestSchema('detect_batch', detectBatchShape),
    parseOutput: makeParseOutput(detectBatchShape),
    unwrap: (output) => (output as BatchResult).results?.[0] ?? undefined,
    expectedOf: (item) => {
      const eo = item.expectedOutput as Record<string, unknown>
      return {
        isNonBrand: eo.isNonBrand,
        confidence: eo.confidence,
        slugGenerated: eo.slugGenerated ?? null,
        brandName: eo.brandName ?? null,
      }
    },
    expectedSchema: detectExpectedSchema,
    scorers: [
      { name: 'decisionAgreement', fn: (o, e) => {
        const out = o as Record<string, unknown>
        const exp = e as Record<string, unknown>
        return decisionAgreement(out.isNonBrand, exp.isNonBrand)
      }},
      { name: 'confidenceBandAgreement', fn: (o, e) => {
        const out = o as Record<string, unknown>
        const exp = e as Record<string, unknown>
        return confidenceBandAgreement(out.confidence as string, exp.confidence as string)
      }},
      { name: 'writeEligibleAgreement', fn: (o, e) => {
        const exp = e as Record<string, unknown>
        return writeEligibleAgreement(
          o,
          { writeEligible: exp.confidence === 'high' },
          (out) => isHighConfidenceWrite(out as { confidence: string }),
        )
      }},
    ],
    mode: 'scored',
  },

  'category-confidence-golden': {
    promptName: 'category-classify',
    variables: { category_list: CATEGORY_LIST },
    profileKey: 'classificationBatch',
    outputSchema: classifyBatchShape,
    requestSchema: makeRequestSchema('classify_batch', classifyBatchShape),
    parseOutput: makeParseOutput(classifyBatchShape),
    unwrap: (output) => (output as BatchResult).results?.[0] ?? undefined,
    expectedOf: (item) => {
      const eo = item.expectedOutput as Record<string, unknown>
      return {
        category: eo.category,
        subcategory: eo.subcategory ?? null,
        confidence: eo.confidence,
        writeEligible: eo.writeEligible,
      }
    },
    expectedSchema: categoryExpectedSchema,
    scorers: [
      { name: 'categoryAgreement', fn: (o, e) => {
        const out = o as { category: string; subcategory?: string | null }
        const exp = e as { category: string; subcategory?: string | null }
        return categoryAgreement(out, exp)
      }},
      { name: 'confidenceBandAgreement', fn: (o, e) => {
        const out = o as Record<string, unknown>
        const exp = e as Record<string, unknown>
        return confidenceBandAgreement(out.confidence as string, exp.confidence as string)
      }},
      { name: 'writeEligibleAgreement', fn: (o, e) => {
        const exp = e as Record<string, unknown>
        return writeEligibleAgreement(
          o,
          { writeEligible: (exp.confidence as string) === 'high' },
          (out) => (out as { confidence: string }).confidence === 'high',
        )
      }},
    ],
    mode: 'scored',
  },

  'name-arbiter-confidence-golden': {
    promptName: 'name-arbiter',
    profileKey: 'namesBatch',
    outputSchema: nameArbitrationShape,
    requestSchema: makeRequestSchema('name_arbitration', nameArbitrationShape),
    parseOutput: makeParseOutput(nameArbitrationShape),
    unwrap: (output) => (output as BatchResult).results?.[0] ?? undefined,
    expectedOf: (item) => {
      const eo = item.expectedOutput as Record<string, unknown>
      return {
        chosen: eo.chosen,
        confidence: eo.confidence,
      }
    },
    expectedSchema: nameExpectedSchema,
    scorers: [
      { name: 'decisionAgreement', fn: (o, e) => {
        const out = o as Record<string, unknown>
        const exp = e as Record<string, unknown>
        return decisionAgreement(out.chosen, exp.chosen)
      }},
      { name: 'confidenceBandAgreement', fn: (o, e) => {
        const out = o as Record<string, unknown>
        const exp = e as Record<string, unknown>
        return confidenceBandAgreement(out.confidence as string, exp.confidence as string)
      }},
    ],
    mode: 'scored',
  },

  'site-identity-confidence-golden': {
    promptName: 'site-identity',
    profileKey: 'siteIdentityBatch',
    outputSchema: siteIdentityShape,
    requestSchema: makeRequestSchema('site_identity', siteIdentityShape),
    parseOutput: makeParseOutput(siteIdentityShape),
    unwrap: (output) => (output as BatchResult).results?.[0] ?? undefined,
    expectedOf: (item) => {
      const eo = item.expectedOutput as Record<string, unknown>
      return {
        owned: eo.owned,
        confidence: eo.confidence,
        writeEligible: eo.writeEligible,
      }
    },
    expectedSchema: siteIdentityExpectedSchema,
    scorers: [
      { name: 'decisionAgreement', fn: (o, e) => {
        const out = o as Record<string, unknown>
        const exp = e as Record<string, unknown>
        return decisionAgreement(out.owned, exp.owned)
      }},
      { name: 'confidenceBandAgreement', fn: (o, e) => {
        const out = o as Record<string, unknown>
        const exp = e as Record<string, unknown>
        return confidenceBandAgreement(out.confidence as string, exp.confidence as string)
      }},
      { name: 'writeEligibleAgreement', fn: (o, e) => {
        const exp = e as Record<string, unknown>
        return writeEligibleAgreement(
          o,
          { writeEligible: exp.writeEligible as boolean },
          (out) => {
            const verdict = out as { owned: boolean; confidence: string }
            const decision = resolveQuarantine({
              slug: '',
              owned: verdict.owned,
              confidence: verdict.confidence as 'high' | 'medium' | 'low',
              reason: '',
            })
            // write-eligible = not revoked
            return !decision.revoked
          },
        )
      }},
    ],
    mode: 'scored',
  },

  'products-agent-ranking-golden': {
    promptName: 'products-propose',
    variables: {
      category_list: CATEGORY_LIST,
      subcategory_vocab_block: SUBCATEGORY_VOCAB_BLOCK,
      material_vocab_block: MATERIAL_VOCAB_BLOCK,
      editorial_bands: renderEditorialBands(),
    },
    profileKey: 'products_agent',
    outputSchema: PRODUCTS_PROPOSAL_SHAPE,
    requestSchema: makeRequestSchema('products_proposal', PRODUCTS_PROPOSAL_SHAPE),
    parseOutput: makeParseOutput(PRODUCTS_PROPOSAL_SHAPE),
    unwrap: (output) => output,
    expectedOf: (item) => item.expectedOutput,
    expectedSchema: productsExpectedSchema,
    scorers: [
      { name: 'bandAgreement', fn: (o, e) => bandAgreement(o as ProductsReplayOutput, e as ProductsExpected) },
      { name: 'withinPoolOrderingAgreement', fn: (o, e) => withinPoolOrderingAgreement(o as ProductsReplayOutput, e as ProductsExpected) },
      { name: 'selectionAgreement', fn: (o, e) => selectionAgreement(o as ProductsReplayOutput, e as ProductsExpected) },
      { name: 'originWhenSourced', fn: (o) => originWhenSourced(o as ProductsReplayOutput), nullable: true },
    ],
    mode: 'scored',
    task: productsTask({ createAgentModel, runProductsAgent }),
    summarize: (results: ArmResult[]) => {
      // Aggregate output/expected across all items across all arms
      const sections: string[] = []
      for (const armResult of results) {
        for (const item of armResult.items) {
          if (!item.ok || !item.output || !item.expected) continue
          const output = item.output as ProductsReplayOutput
          const expected = item.expected as ProductsExpected
          sections.push(summarizeCalibration({
            confusion: bandConfusion(output, expected),
            tieBreak: tieBreakAblation(output, expected),
            windowSweep: windowSweep(output, expected),
          }))
        }
      }
      return sections.join('\n\n---\n\n')
    },
  },

  descriptions: {
    promptName: 'descriptions',
    variables: { taiwan_usage_rules: TAIWAN_USAGE_RULES },
    profileKey: 'descriptions',
    outputSchema: descriptionShape,
    requestSchema: makeRequestSchema('brand_description', descriptionShape),
    parseOutput: makeParseOutput(descriptionShape),
    unwrap: (output) => output,
    expectedOf: (item) => item.expectedOutput,
    expectedSchema: descriptionShape,
    scorers: [
      { name: 'bannedTermScore', fn: (o) => {
        const out = o as Record<string, string>
        return bannedTermScore(out)
      }},
      { name: 'schemaCompliance', fn: (o) => {
        return schemaCompliance(o, descriptionShape)
      }},
    ],
    mode: 'pairwise',
  },

  'intent-parse-golden': {
    // No Langfuse prompt: the task sends the live INTENT_PARSE_SYSTEM_PROMPT.
    promptName: null,
    profileKey: 'intentParse',
    outputSchema: intentParseShape,
    requestSchema: makeRequestSchema(INTENT_PARSE_JSON_SCHEMA.name, intentParseShape),
    parseOutput: makeParseOutput(intentParseShape),
    unwrap: (output) => output,
    expectedOf: (item) => {
      const eo = item.expectedOutput as Record<string, unknown>
      return {
        category: eo.category,
        subcategory: eo.subcategory ?? null,
        materials: eo.materials ?? [],
      }
    },
    expectedSchema: intentExpectedSchema,
    scorers: [
      // First scorer is the threshold-sweep target: the Jev probability is P(L1).
      // A null expected L1 agrees only with a null output L1.
      { name: 'categoryAgreement', fn: (o, e) => {
        return decisionAgreement((o as IntentParseResult).category, (e as IntentParseResult).category)
      }},
      { name: 'subcategoryAgreement', nullable: true, fn: (o, e) => {
        const out = (o as IntentParseResult).subcategory ?? null
        const exp = (e as IntentParseResult).subcategory ?? null
        // n/a when neither side names an L2; a missing or extra L2 disagrees.
        if (out === null && exp === null) return null
        return out === exp ? 1 : 0
      }},
      { name: 'materialsJaccard', fn: (o, e) => {
        return jaccard(new Set((o as IntentParseResult).materials), new Set((e as IntentParseResult).materials))
      }},
    ],
    mode: 'scored',
  },
}

/** Injected transports; each defaults to the live client. */
export type AdapterDeps = {
  /** Jev `decide()`; defaults to typesafe-audit's audited `decide`. */
  decide?: DecideFn
  /** The intent-parse model call; defaults to the audited `intentParse` profile client. */
  callModel?: IntentCallModel
}

/** The model-calling hooks, built per call so tests can inject the transport. */
function transportHooks(
  datasetName: string,
  deps: AdapterDeps,
): Pick<PhaseAdapter, 'task' | 'decide'> {
  const decide = deps.decide ?? typesafeDecide
  switch (datasetName) {
    case 'detect-confidence-golden':
      return { decide: jevDecide(JEV_CANDIDATES.detect, decide) }
    case 'category-confidence-golden':
      return { decide: jevDecide(JEV_CANDIDATES.classification, decide) }
    case 'site-identity-confidence-golden':
      return { decide: jevDecide(JEV_CANDIDATES.siteIdentity, decide) }
    case 'intent-parse-golden':
      return {
        task: intentParseTask(deps.callModel ?? defaultIntentCallModel),
        decide: jevDecide(JEV_CANDIDATES.intentParse, decide),
      }
    default:
      return {}
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function adapterFor(datasetName: string, deps: AdapterDeps = {}): PhaseAdapter {
  const adapter = registry[datasetName]
  if (!adapter) {
    throw new Error(`No phase adapter registered for dataset "${datasetName}"`)
  }
  return { ...adapter, ...transportHooks(datasetName, deps) }
}

/**
 * Returns the names of all registered datasets.
 * Used by the CLI to iterate adapters for validation.
 */
export function registeredDatasets(): string[] {
  return Object.keys(registry)
}
