import { describe, expect, it } from 'vitest'
import {
  OWNER_ENDPOINTS,
  OWNER_ENDPOINTS_V2,
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

  it('syncs one current date-window endpoint per owner metric', () => {
    expect(listOwnerEndpoints()).toHaveLength(4)
    for (const def of listOwnerEndpoints()) {
      expect(def.dataFreshnessSeconds).toBe(900)
      expect(def.hogql).toContain('{variables.brand_id}')
      expect(def.hogql).toContain('{variables.current_start}')
      expect(def.hogql).toContain('{variables.current_end}')
      expect(def.variables.brand_id).toMatchObject({ type: 'String' })
      expect(def.variables).toHaveProperty('current_start')
      expect(def.variables).toHaveProperty('current_end')
      expect(def.variables.brand_id.default).toBeDefined()
      expect(def.hogql).toContain('analytics_schema_version')
      expect(def.hogql).toContain("surface, 'public'")
    }
    expect(OWNER_ENDPOINTS_V2.brand_core_totals.hogql).toContain(
      '{variables.prior_start}',
    )
    expect(OWNER_ENDPOINTS_V2.brand_core_totals.variables).toHaveProperty('prior_start')
    for (const name of [
      'brand_daily_trend',
      'brand_traffic_sources',
      'brand_outbound_destinations',
    ] as const) {
      expect(OWNER_ENDPOINTS_V2[name].variables).not.toHaveProperty('prior_start')
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
