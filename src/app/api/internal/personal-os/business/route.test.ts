import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ isAuthorized: vi.fn(), getSnapshot: vi.fn() }))

vi.mock('@/lib/internal/personal-os-auth', () => ({
  isPersonalOsRequestAuthorized: mocks.isAuthorized,
}))
vi.mock('@/lib/services/formoria-business', () => ({
  getFormoriaBusinessSnapshot: mocks.getSnapshot,
}))

import { GET } from './route'

describe('GET /api/internal/personal-os/business', () => {
  beforeEach(() => vi.clearAllMocks())

  it('authenticates before configuration or business queries', async () => {
    mocks.isAuthorized.mockReturnValue(false)
    const response = await GET(new Request('http://localhost/api/internal/personal-os/business'))

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ code: 'unauthorized', message: 'Unauthorized' })
    expect(mocks.getSnapshot).not.toHaveBeenCalled()
  })

  it('maps business failures and never caches them', async () => {
    mocks.isAuthorized.mockReturnValue(true)
    mocks.getSnapshot.mockRejectedValue(new Error('database failure'))

    const response = await GET(new Request('http://localhost/api/internal/personal-os/business'))
    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      code: 'business_unavailable',
      message: 'Formoria business data is unavailable.',
    })
  })
})
