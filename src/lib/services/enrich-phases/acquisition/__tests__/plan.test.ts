import { describe, expect, it } from 'vitest'
import {
  AcquisitionPlan,
  toStrictJsonSchema,
  planToDirectives,
  boundedPlan,
} from '../plan'

describe('AcquisitionPlan', () => {
  const validPlan = {
    surfaces: [
      { url: 'https://example.com', fetch: 'static' as const, strategy: 'official-site' as const, reason: 'main site' },
      { url: 'https://ig.com/brand', fetch: 'render' as const, strategy: 'social' as const, reason: 'social' },
    ],
    fanOut: ['https://extra.com/about'],
    catalog: { entryUrls: ['https://example.com/products'], priorityProductUrls: [] },
    socialBios: { 'https://ig.com/brand': 'attempted' as const },
    decisions: [{ step: 'plan', action: 'fetch', reason: 'main site', ms: 100 }],
  }

  it('plan_schema_rejects_more_than_six_fetch_targets', () => {
    // 4 surfaces + 3 fanOut = 7 fetch targets → fails
    const fourSurfaces = Array.from({ length: 4 }, (_, i) => ({
      url: `https://example.com/${i}`,
      fetch: 'static' as const,
      reason: `surface ${i}`,
    }))
    const threeFanOut = Array.from({ length: 3 }, (_, i) => `https://extra.com/${i}`)
    const overPlan = {
      ...validPlan,
      surfaces: fourSurfaces,
      fanOut: threeFanOut,
    }
    const result = AcquisitionPlan.safeParse(overPlan)
    expect(result.success).toBe(false)

    // 3 surfaces + 3 fanOut = 6 → passes
    const threeSurfaces = fourSurfaces.slice(0, 3)
    const okPlan = {
      ...validPlan,
      surfaces: threeSurfaces,
      fanOut: threeFanOut,
    }
    const okResult = AcquisitionPlan.safeParse(okPlan)
    expect(okResult.success).toBe(true)
  })

  it('plan_schema_is_strict_json_schema_compatible', () => {
    const schema = toStrictJsonSchema(AcquisitionPlan)
    // No `optional` without `nullable` at root
    expect(schema.additionalProperties).toBe(false)

    // Check nested objects also have additionalProperties: false
    const props = schema.properties as Record<string, Record<string, unknown>> | undefined
    const surfaceItems = props?.surfaces?.items as Record<string, unknown> | undefined
    expect(surfaceItems?.additionalProperties).toBe(false)

    // No top-level optional-without-nullable: all required fields should be present
    // and optional fields should not have `optional` in the schema
    expect(schema.required).toBeDefined()
    expect(Array.isArray(schema.required)).toBe(true)

    // Decisions items
    const decisionsItems = props?.decisions?.items as Record<string, unknown> | undefined
    expect(decisionsItems?.additionalProperties).toBe(false)
  })

  it('planToDirectives_maps_fetch_and_strategy_per_url', () => {
    const plan = AcquisitionPlan.parse({
      ...validPlan,
      surfaces: [
        { url: 'https://a.com', fetch: 'render', strategy: 'single-page', reason: 'spa' },
      ],
    })
    const directives = planToDirectives(plan)
    expect(directives.get('https://a.com')).toEqual({
      fetch: 'render',
      strategy: 'official-site',
      reason: 'spa',
    })
  })

  it('boundedPlan truncates plan above 8 KB', () => {
    const largePlan = AcquisitionPlan.parse({
      ...validPlan,
      decisions: Array.from({ length: 200 }, (_, i) => ({
        step: `step-${i}`,
        action: 'a'.repeat(40),
        reason: 'r'.repeat(40),
        ms: i,
      })),
    })
    const bounded = boundedPlan(largePlan)
    const json = JSON.stringify(bounded)
    expect(json.length).toBeLessThanOrEqual(8192)
  })
})
