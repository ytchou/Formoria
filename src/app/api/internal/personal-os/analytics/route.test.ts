import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PostHogQueryError } from '@/lib/adapters/posthog/query-api'

const mocks = vi.hoisted(() => ({ isAuthorized: vi.fn(), getSnapshot: vi.fn() }))

vi.mock('@/lib/internal/personal-os-auth', () => ({
  isPersonalOsRequestAuthorized: mocks.isAuthorized,
}))
vi.mock('@/lib/services/posthog-analytics', () => ({
  getPostHogAnalyticsSnapshot: mocks.getSnapshot,
}))

import { GET } from './route'

describe('GET /api/internal/personal-os/analytics', () => {
  beforeEach(() => vi.clearAllMocks())

  it('authenticates before PostHog configuration or provider calls', async () => {
    mocks.isAuthorized.mockReturnValue(false)
    const response = await GET(new Request('http://localhost/api/internal/personal-os/analytics'))

    expect(response.status).toBe(401)
    expect(mocks.getSnapshot).not.toHaveBeenCalled()
  })

  it.each([
    ['posthog_unconfigured', 503],
    ['posthog_unavailable', 503],
    ['invalid_provider_response', 502],
  ] as const)('maps %s to a stable error response', async (code, status) => {
    mocks.isAuthorized.mockReturnValue(true)
    mocks.getSnapshot.mockRejectedValue(new PostHogQueryError(code, 'internal detail'))

    const response = await GET(new Request('http://localhost/api/internal/personal-os/analytics'))
    expect(response.status).toBe(status)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      code,
      message: code === 'posthog_unconfigured'
        ? 'PostHog analytics is not configured.'
        : code === 'posthog_unavailable'
          ? 'PostHog analytics is temporarily unavailable.'
          : 'PostHog returned an invalid analytics response.',
    })
  })
})
