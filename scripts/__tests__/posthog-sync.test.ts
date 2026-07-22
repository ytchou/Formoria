import { describe, expect, it } from 'vitest'
import { buildEndpointPayload, buildInsightPayload, planSyncActions } from '../posthog-sync'
import { OWNER_ENDPOINTS } from '@/lib/analytics/posthog-queries'

describe('posthog-sync payload builders', () => {
  const def = OWNER_ENDPOINTS.brand_core_totals

  it('builds an endpoint upsert payload from a definition', () => {
    expect(buildEndpointPayload(def)).toMatchObject({
      name: 'brand_core_totals',
      query: { kind: 'HogQLQuery', query: def.hogql },
      data_freshness_seconds: 900,
      is_materialized: false,
    })
  })

  it('builds a SQL insight payload carrying {filters}', () => {
    const payload = buildInsightPayload(def)
    expect(payload.name).toBe(def.insight.name)
    expect(JSON.stringify(payload.query)).toContain('{filters}')
  })

  it('plans create vs update by matching existing names', () => {
    const actions = planSyncActions(
      [{ name: 'brand_core_totals' }],
      Object.values(OWNER_ENDPOINTS).map((d) => d.name),
    )
    expect(actions.create).toContain('brand_daily_trend')
    expect(actions.update).toEqual(['brand_core_totals'])
  })
})
