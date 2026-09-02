import { z } from 'zod'
import type { SurfaceDirective } from '../scraper/strategies/types'

const MAX_PLAN_BYTES = 8192

const SurfaceSchema = z.object({
  url: z.string().url(),
  fetch: z.enum(['static', 'render', 'skip']),
  strategy: z.enum(['official-site', 'social', 'e-commerce', 'deep-multi-page', 'single-page']).optional(),
  adapter: z.string().optional(),
  reason: z.string(),
}).strict()

const DecisionSchema = z.object({
  step: z.string(),
  action: z.string(),
  reason: z.string(),
  ms: z.number(),
}).strict()

/**
 * The agent's structured plan for evidence acquisition. The total fetch target
 * count (surfaces + fanOut) is capped at 6 to stay within the probe budget.
 */
export const AcquisitionPlan = z.object({
  surfaces: z.array(SurfaceSchema).max(6),
  fanOut: z.array(z.string().url()).max(3),
  catalog: z.object({
    entryUrls: z.array(z.string().url()),
    priorityProductUrls: z.array(z.string().url()),
  }).strict(),
  socialBios: z.record(z.string(), z.enum(['blocked', 'attempted'])),
  decisions: z.array(DecisionSchema),
}).strict().refine(
  (plan) => plan.surfaces.length + plan.fanOut.length <= 6,
  { message: 'Total fetch targets (surfaces + fanOut) must be ≤ 6' },
)

export type AcquisitionPlanType = z.infer<typeof AcquisitionPlan>

export type CritiqueVerdict = {
  verdict: 'sufficient' | 'thin' | 'fail'
  reason: string
  recoveryAction?: 'fanout' | 'search' | 'render'
}

export const CritiqueVerdictSchema = z.object({
  verdict: z.enum(['sufficient', 'thin', 'fail']),
  reason: z.string(),
  recoveryAction: z.enum(['fanout', 'search', 'render']).optional(),
}).strict()

/**
 * Converts the AcquisitionPlan Zod schema to a strict JSON Schema compatible
 * with OpenAI's structured output. Uses Zod 4's built-in `.toJSONSchema()`,
 * which emits `additionalProperties: false` on `.strict()` objects.
 */
export function toStrictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return schema.toJSONSchema() as Record<string, unknown>
}

/**
 * Maps a parsed plan's surfaces to the SurfaceDirective type used by
 * `scrapeBrandUrls`. Each surface's fetch mode and optional strategy become
 * a directive keyed by URL.
 */
export function planToDirectives(
  plan: AcquisitionPlanType,
): Map<string, SurfaceDirective> {
  const map = new Map<string, SurfaceDirective>()
  for (const s of plan.surfaces) {
    const directive: SurfaceDirective = {
      fetch: s.fetch,
      reason: s.reason,
    }
    // Map plan's strategy names to InputType (single-page → official-site for scraper)
    if (s.strategy) {
      const strategyMap: Record<string, SurfaceDirective['strategy']> = {
        'official-site': 'official-site',
        'social': 'social',
        'e-commerce': 'e-commerce',
        'deep-multi-page': 'deep-multi-page',
        'single-page': 'official-site',
      }
      directive.strategy = strategyMap[s.strategy]
    }
    map.set(s.url, directive)
  }
  return map
}

/**
 * Truncates a plan to fit within the 8 KB ceiling. Trims decisions first
 * (least critical), then surfaces, preserving the plan structure.
 */
export function boundedPlan(plan: AcquisitionPlanType): AcquisitionPlanType {
  let current = { ...plan }
  if (JSON.stringify(current).length <= MAX_PLAN_BYTES) return current

  // Trim decisions first
  while (current.decisions.length > 1 && JSON.stringify(current).length > MAX_PLAN_BYTES) {
    current = { ...current, decisions: current.decisions.slice(0, -1) }
  }

  // If still too large, truncate reason strings
  if (JSON.stringify(current).length > MAX_PLAN_BYTES) {
    current = {
      ...current,
      surfaces: current.surfaces.map((s) => ({
        ...s,
        reason: s.reason.slice(0, 50),
      })),
      decisions: current.decisions.map((d) => ({
        ...d,
        reason: d.reason.slice(0, 30),
        action: d.action.slice(0, 30),
      })),
    }
  }

  return current
}
