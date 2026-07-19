import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ isAuthorized: vi.fn(), refresh: vi.fn() }))

vi.mock('@/lib/internal/personal-os-auth', () => ({
  isPersonalOsRequestAuthorized: mocks.isAuthorized,
}))
vi.mock('@/lib/services/executive-health', () => ({ refreshExecutiveHealth: mocks.refresh }))

import { POST } from './route'

describe('POST /api/internal/personal-os/system-status/refresh', () => {
  beforeEach(() => vi.clearAllMocks())

  it('authenticates before refreshing providers', async () => {
    mocks.isAuthorized.mockReturnValue(false)

    const response = await POST(
      new Request('http://localhost/api/internal/personal-os/system-status/refresh', { method: 'POST' }),
    )

    expect(response.status).toBe(401)
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('returns refreshed status with no-store', async () => {
    mocks.isAuthorized.mockReturnValue(true)
    mocks.refresh.mockResolvedValue({ status: 'healthy', services: [] })

    const response = await POST(
      new Request('http://localhost/api/internal/personal-os/system-status/refresh', { method: 'POST' }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })
})
