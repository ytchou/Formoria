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
import { toStrictJsonSchema } from '@/lib/services/_shared/zod-schema'
import { renderEditorialBands } from '@/lib/constants/curated-products'
import { PRODUCTS_PROPOSAL_SHAPE, PRODUCTS_SCHEMA } from '@/lib/services/enrich-phases/products'
import { AcquisitionPlan, CritiqueVerdictSchema } from '@/lib/services/enrich-phases/acquisition/plan'
import { runPlanStage } from '@/lib/services/enrich-phases/acquisition/graph'
import { fetchHtmlWithMetadata } from '@/lib/services/enrich-phases/scraper/fetch-guards'
import { fetchLangfusePromptWithMeta, parsePromptVersionPins } from '@/lib/langfuse/prompt'
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
  planFetchCapOk,
  planSchemaValid,
  recoveryActionConsistent,
  verdictAgreement,
  keepRate,
  repairPassRate,
  type ProductsGoldenContext,
} from './scorers'
import {
  productsExpectedSchema,
  summarizeCalibration,
  bandConfusion,
  tieBreakAblation,
  windowSweep,
  type ProductsReplayOutput,
  type ProductsExpected,
} from './products-calibration'
import { productsTask } from './products-replay'
import { acquisitionPlanTask } from './acquisition-plan-replay'
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

// Golden items list every defensible name; a verdict matching any of them agrees.
const nameExpectedSchema = z.object({
  acceptedNames: z.array(z.string()).min(1),
  confidence: z.string(),
})

const siteIdentityExpectedSchema = z.object({
  owned: z.boolean(),
  confidence: z.string(),
  writeEligible: z.boolean().optional(),
})

// DEV-1873: rule-only sets carry what their scorers need as `{ context }`;
// only the critique carries a human label, the overall verdict.
const productsContextSchema = z.object({
  siteUrl: z.string(),
  candidates: z.array(z.string()),
  ownedHosts: z.array(z.string()),
  hardUrls: z.array(z.string()).optional(),
})

const planExpectedSchema = z.object({ context: z.record(z.string(), z.unknown()) })
const critiqueExpectedSchema = z.object({ verdict: z.enum(['sufficient', 'thin', 'fail']) })
const productsContextExpectedSchema = z.object({ context: productsContextSchema })

const REPAIR_SHAPE = PRODUCTS_PROPOSAL_SHAPE.pick({ products: true })

function contextOf(item: { expectedOutput: unknown }): { context: unknown } {
  return { context: (item.expectedOutput as { context?: unknown } | null)?.context ?? {} }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

type BatchResult = { results: unknown[] }

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
        acceptedNames: eo.acceptedNames,
        confidence: eo.confidence,
      }
    },
    expectedSchema: nameExpectedSchema,
    scorers: [
      { name: 'decisionAgreement', fn: (o, e) => {
        const out = o as Record<string, unknown>
        const exp = e as Record<string, unknown>
        return (exp.acceptedNames as string[]).includes(out.chosen as string) ? 1 : 0
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

  'acquisition-plan-golden': {
    promptName: 'acquisition-plan',
    profileKey: 'acquisition',
    outputSchema: AcquisitionPlan,
    // Unused by the custom task (the plan travels as a submit_plan tool call);
    // kept for the adapter contract.
    requestSchema: makeRequestSchema('acquisition_plan', AcquisitionPlan),
    parseOutput: makeParseOutput(AcquisitionPlan),
    unwrap: (output) => output,
    expectedOf: contextOf,
    expectedSchema: planExpectedSchema,
    scorers: [
      { name: 'planSchemaValid', fn: (o) => planSchemaValid(o) },
      { name: 'planFetchCapOk', fn: (o) => planFetchCapOk(o) },
    ],
    mode: 'scored',
    task: acquisitionPlanTask({
      createAgentModel,
      runPlanStage,
      fetchHtml: fetchHtmlWithMetadata,
      fetchPromptMeta: (name) => fetchLangfusePromptWithMeta(name),
      parsePromptVersionPins: () => parsePromptVersionPins(),
    }),
  },

  'acquisition-critique-golden': {
    promptName: 'acquisition-critique',
    profileKey: 'acquisition',
    outputSchema: CritiqueVerdictSchema,
    requestSchema: makeRequestSchema('critique_verdict', CritiqueVerdictSchema),
    parseOutput: makeParseOutput(CritiqueVerdictSchema),
    unwrap: (output) => output,
    expectedOf: (item) => ({ verdict: (item.expectedOutput as { verdict?: unknown } | null)?.verdict }),
    expectedSchema: critiqueExpectedSchema,
    scorers: [
      { name: 'verdictAgreement', fn: (o, e) => verdictAgreement(o as { verdict?: unknown }, e as { verdict: unknown }) },
      { name: 'recoveryActionConsistent', fn: (o) => recoveryActionConsistent(o as { verdict?: unknown; recoveryAction?: unknown }) },
    ],
    mode: 'scored',
  },

  'products-repair-golden': {
    promptName: 'products-repair',
    profileKey: 'products_agent',
    outputSchema: REPAIR_SHAPE,
    // Same composition as graph.ts REPAIR_SCHEMA.
    requestSchema: makeRequestSchema('curated_product_repair', REPAIR_SHAPE),
    parseOutput: makeParseOutput(REPAIR_SHAPE),
    unwrap: (output) => output,
    expectedOf: contextOf,
    expectedSchema: productsContextExpectedSchema,
    scorers: [
      {
        name: 'repairPassRate',
        fn: (o, e) => repairPassRate(o, (e as { context: ProductsGoldenContext }).context),
        nullable: true,
      },
    ],
    mode: 'scored',
  },

  'products-fallback-golden': {
    promptName: 'products',
    // Exactly the variables products.ts sends on the single-call path.
    variables: {
      category_list: CATEGORY_LIST,
      subcategory_vocab_block: SUBCATEGORY_VOCAB_BLOCK,
      material_vocab_block: MATERIAL_VOCAB_BLOCK,
      taiwan_usage_rules: TAIWAN_USAGE_RULES,
    },
    profileKey: 'products',
    outputSchema: PRODUCTS_PROPOSAL_SHAPE,
    requestSchema: PRODUCTS_SCHEMA,
    parseOutput: makeParseOutput(PRODUCTS_PROPOSAL_SHAPE),
    unwrap: (output) => output,
    expectedOf: contextOf,
    expectedSchema: productsContextExpectedSchema,
    scorers: [
      {
        name: 'keepRate',
        fn: (o, e) => keepRate(o, (e as { context: ProductsGoldenContext }).context),
        nullable: true,
      },
    ],
    mode: 'scored',
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
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function adapterFor(datasetName: string): PhaseAdapter {
  const adapter = registry[datasetName]
  if (!adapter) {
    throw new Error(`No phase adapter registered for dataset "${datasetName}"`)
  }
  return adapter
}

/**
 * Returns the names of all registered datasets.
 * Used by the CLI to iterate adapters for validation.
 */
export function registeredDatasets(): string[] {
  return Object.keys(registry)
}
