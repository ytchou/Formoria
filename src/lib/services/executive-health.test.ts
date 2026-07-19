import { describe, expect, it, vi } from 'vitest'
import {
  classifyExecutiveHealth,
  createExecutiveHealthMonitor,
  runExecutiveHealthCheck,
  type ExecutiveServiceHealth,
} from './executive-health'

function service(
  name: string,
  tier: ExecutiveServiceHealth['tier'],
  status: ExecutiveServiceHealth['status'],
): ExecutiveServiceHealth {
  return { service: name, tier, status, message: 'Checked', checkedAt: '2026-07-19T00:00:00Z' }
}

describe('executive health', () => {
  it('caches results for five minutes and supports explicit refresh', async () => {
    let now = 1_000
    const load = vi.fn().mockResolvedValue({
      status: 'healthy',
      checkedAt: '2026-07-19T00:00:00Z',
      services: [service('Public site', 'customer-critical', 'healthy')],
    })
    const monitor = createExecutiveHealthMonitor({ load, now: () => now })

    await monitor.get()
    now += 299_000
    await monitor.get()
    await monitor.refresh()

    expect(load).toHaveBeenCalledTimes(2)
  })

  it('classifies customer-critical outages above support degradation', () => {
    expect(
      classifyExecutiveHealth([
        service('Public site', 'customer-critical', 'down'),
        service('Resend', 'customer-flow', 'degraded'),
      ]),
    ).toBe('critical')
    expect(classifyExecutiveHealth([service('Resend', 'customer-flow', 'down')])).toBe('warning')
    expect(classifyExecutiveHealth([service('Public site', 'customer-critical', 'healthy')])).toBe(
      'healthy',
    )
  })

  it('sanitizes thrown provider errors and audits request, response, latency, and status', async () => {
    const audit = vi.fn()
    const result = await runExecutiveHealthCheck(
      {
        service: 'Provider',
        tier: 'back-office',
        request: { endpoint: 'https://provider.example/health' },
        run: async () => {
          throw new Error('Bearer secret-value')
        },
      },
      audit,
    )

    expect(result.message).toBe('Provider request failed')
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        request: { endpoint: 'https://provider.example/health' },
        response: expect.objectContaining({ status: 'down' }),
        latencyMs: expect.any(Number),
        status: 'error',
      }),
    )
    expect(JSON.stringify(audit.mock.calls)).not.toContain('secret-value')
  })
})
