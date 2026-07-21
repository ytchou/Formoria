import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ isAuthorized: vi.fn(), getStatus: vi.fn() }))

vi.mock('@/lib/internal/personal-os-auth', () => ({
  isPersonalOsRequestAuthorized: mocks.isAuthorized,
}))
vi.mock('@/lib/services/executive-health', () => ({ getExecutiveHealth: mocks.getStatus }))

import { GET } from './route'

describe('GET /api/internal/personal-os/system-status', () => {
  beforeEach(() => vi.clearAllMocks())

  it('authenticates before running health providers', async () => {
    mocks.isAuthorized.mockReturnValue(false)
    const response = await GET(new Request('http://localhost/api/internal/personal-os/system-status'))

    expect(response.status).toBe(401)
    expect(mocks.getStatus).not.toHaveBeenCalled()
  })

  it('returns status without caching', async () => {
    mocks.isAuthorized.mockReturnValue(true)
    mocks.getStatus.mockResolvedValue({ status: 'healthy', services: [] })
    const response = await GET(new Request('http://localhost/api/internal/personal-os/system-status'))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})
