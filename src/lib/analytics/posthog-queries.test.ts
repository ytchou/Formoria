import { describe, expect, it } from 'vitest'
import {
  OWNER_ENDPOINTS,
  SITE_DASHBOARD_NAME,
  listOwnerEndpoints,
} from './posthog-queries'

describe('posthog-queries definitions', () => {
  it('declares exactly the four owner endpoints', () => {
    expect(Object.keys(OWNER_ENDPOINTS).sort()).toEqual([
      'brand_core_totals',
      'brand_daily_trend',
      'brand_outbound_destinations',
      'brand_traffic_sources',
    ])
  })

  it('every endpoint is versioned, cached at 900s, and parameterized by brand_id', () => {
    for (const def of listOwnerEndpoints()) {
      expect(def.version).toBeGreaterThanOrEqual(1)
      expect(def.dataFreshnessSeconds).toBe(900)
      expect(def.hogql).toContain('{variables.brand_id}')
      expect(def.variables.brand_id).toMatchObject({ type: 'String' })
      expect(def.variables.brand_id.default).toBeDefined()
      expect(def.hogql).toContain('analytics_schema_version')
      expect(def.hogql).toContain("surface, 'public'")
    }
  })

  it('traffic sources classifies via previous pageview in session', () => {
    const def = OWNER_ENDPOINTS.brand_traffic_sources
    expect(def.hogql).toMatch(/lagInFrame|LAG\(/i)
    for (const bucket of ['search', 'category', 'homepage', 'direct', 'other']) {
      expect(def.hogql).toContain(`'${bucket}'`)
    }
  })

  it('every endpoint has a dashboard insight variant carrying the {filters} placeholder', () => {
    expect(SITE_DASHBOARD_NAME).toBe('Formoria — Site analytics')
    for (const def of listOwnerEndpoints()) {
      expect(def.insight.name.length).toBeGreaterThan(0)
      expect(def.insight.hogql).toContain('{filters}')
      expect(def.insight.hogql).not.toContain('{variables.brand_id}')
    }
  })
})
