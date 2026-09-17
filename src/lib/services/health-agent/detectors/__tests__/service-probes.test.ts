import { describe, expect, it } from 'vitest'
import type { DetectorContext } from '../../types'
import { serviceProbesDetector } from '../service-probes'
import type { ExecutiveServiceHealth } from '@/lib/services/executive-health'

function makeCtx(
  deps: Record<string, unknown> = {},
): DetectorContext {
  return {
    date: '2026-09-17',
    deadline: Date.now() + 30_000,
    signal: new AbortController().signal,
    dryRun: false,
    deps,
  }
}

function makeService(
  overrides: Partial<ExecutiveServiceHealth> = {},
): ExecutiveServiceHealth {
  return {
    id: 'test',
    service: 'Test Service',
    tier: 'back-office',
    status: 'healthy',
    message: 'OK',
    checkedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('service-probes detector', () => {
  it('turns every non-healthy executive-health result into a finding and ignores unconfigured', async () => {
    const services: ExecutiveServiceHealth[] = [
      makeService({ id: 'a', service: 'Healthy A', status: 'healthy' }),
      makeService({ id: 'b', service: 'Down B', status: 'down', message: 'DB unreachable' }),
      makeService({ id: 'c', service: 'Degraded C', status: 'degraded', message: 'Slow responses' }),
      makeService({ id: 'd', service: 'Unconfigured D', status: 'unconfigured', message: 'Not configured' }),
    ]

    const loadExecutiveHealth = async () => ({
      status: 'warning' as const,
      checkedAt: new Date().toISOString(),
      services,
      inventory: [],
    })

    const ctx = makeCtx({ loadExecutiveHealth })
    const findings = await serviceProbesDetector.run(ctx)

    // 'healthy' and 'unconfigured' produce no findings
    expect(findings).toHaveLength(2)
    expect(findings.map((f) => f.title)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Down B'),
        expect.stringContaining('Degraded C'),
      ]),
    )
    // Unconfigured should not be present
    expect(findings.some((f) => f.title.includes('Unconfigured D'))).toBe(false)
    // Healthy should not be present
    expect(findings.some((f) => f.title.includes('Healthy A'))).toBe(false)
  })

  it('returns no findings when all services are healthy', async () => {
    const services: ExecutiveServiceHealth[] = [
      makeService({ id: 'a', status: 'healthy' }),
      makeService({ id: 'b', status: 'healthy' }),
    ]

    const loadExecutiveHealth = async () => ({
      status: 'healthy' as const,
      checkedAt: new Date().toISOString(),
      services,
      inventory: [],
    })

    const ctx = makeCtx({ loadExecutiveHealth })
    const findings = await serviceProbesDetector.run(ctx)
    expect(findings).toHaveLength(0)
  })
})
