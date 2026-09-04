import type { ZodType } from 'zod'
import { z } from 'zod'

import {
  DETECT_SYSTEM_PROMPT,
  CLASSIFY_SYSTEM_PROMPT,
  NAME_ARBITER_SYSTEM_PROMPT,
  SITE_IDENTITY_SYSTEM_PROMPT,
  DESCRIPTION_SYSTEM_PROMPT,
  CATEGORY_LIST,
  TAIWAN_USAGE_RULES,
} from '@/lib/prompts'
import { detectBatchShape, classifyBatchShape } from '@/lib/services/category-classifier'
import { nameArbitrationShape } from '@/lib/services/name-arbiter'
import { siteIdentityShape } from '@/lib/services/site-identity-arbiter'
import { resolveQuarantine } from '@/lib/services/enrich-phases/site-identity'
import { descriptionShape } from '@/lib/services/description-rewrite'
import { isHighConfidenceWrite } from '@/lib/services/enrich-phases/detect'
import { toStrictJsonSchema } from '@/lib/services/_shared/zod-schema'
import {
  categoryAgreement,
  confidenceBandAgreement,
  writeEligibleAgreement,
  decisionAgreement,
  schemaCompliance,
  bannedTermScore,
} from './scorers'

// ---------------------------------------------------------------------------
// PhaseAdapter type
// ---------------------------------------------------------------------------

export interface PhaseAdapter {
  promptName: string
  fallbackPrompt: string
  variables?: Record<string, string>
  profileKey: string
  outputSchema: ZodType
  requestSchema: { name: string; schema: object }
  parseOutput(content: string): { ok: true; data: unknown } | { ok: false; error: unknown }
  unwrap: (output: unknown) => unknown
  expectedOf: (item: { expectedOutput: unknown }) => unknown
  expectedSchema: ZodType
  scorers: Array<{ name: string; fn: (output: unknown, expected: unknown) => number }>
  mode: 'scored' | 'pairwise' | 'review-only'
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

const nameExpectedSchema = z.object({
  chosen: z.string(),
  confidence: z.string(),
})

const siteIdentityExpectedSchema = z.object({
  owned: z.boolean(),
  confidence: z.string(),
  writeEligible: z.boolean().optional(),
})

const productsExpectedSchema = z.object({
  decisions: z.array(z.object({
    candidateUrl: z.string(),
    selected: z.boolean(),
    approvedBand: z.string().optional(),
    relativeRank: z.number().optional(),
  })),
})

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

type BatchResult = { results: unknown[] }

const registry: Record<string, PhaseAdapter> = {
  'detect-confidence-golden': {
    promptName: 'detect',
    fallbackPrompt: DETECT_SYSTEM_PROMPT,
    profileKey: 'detectBatch',
    outputSchema: detectBatchShape,
    requestSchema: makeRequestSchema('detect_batch', detectBatchShape),
    parseOutput: makeParseOutput(detectBatchShape),
    unwrap: (output) => (output as BatchResult).results[0],
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
    fallbackPrompt: CLASSIFY_SYSTEM_PROMPT,
    variables: { category_list: CATEGORY_LIST },
    profileKey: 'classificationBatch',
    outputSchema: classifyBatchShape,
    requestSchema: makeRequestSchema('classify_batch', classifyBatchShape),
    parseOutput: makeParseOutput(classifyBatchShape),
    unwrap: (output) => (output as BatchResult).results[0],
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
    fallbackPrompt: NAME_ARBITER_SYSTEM_PROMPT,
    profileKey: 'namesBatch',
    outputSchema: nameArbitrationShape,
    requestSchema: makeRequestSchema('name_arbitration', nameArbitrationShape),
    parseOutput: makeParseOutput(nameArbitrationShape),
    unwrap: (output) => (output as BatchResult).results[0],
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
    fallbackPrompt: SITE_IDENTITY_SYSTEM_PROMPT,
    profileKey: 'siteIdentityBatch',
    outputSchema: siteIdentityShape,
    requestSchema: makeRequestSchema('site_identity', siteIdentityShape),
    parseOutput: makeParseOutput(siteIdentityShape),
    unwrap: (output) => (output as BatchResult).results[0],
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

  'products-editorial-score-golden': {
    promptName: 'products',
    fallbackPrompt: '',
    profileKey: 'products',
    outputSchema: productsExpectedSchema,
    requestSchema: makeRequestSchema('products_editorial', productsExpectedSchema),
    parseOutput: makeParseOutput(productsExpectedSchema),
    unwrap: (output) => output,
    expectedOf: (item) => item.expectedOutput,
    expectedSchema: productsExpectedSchema,
    scorers: [],
    mode: 'review-only',
  },

  descriptions: {
    promptName: 'descriptions',
    fallbackPrompt: DESCRIPTION_SYSTEM_PROMPT,
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
