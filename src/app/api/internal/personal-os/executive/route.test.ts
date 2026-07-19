import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isAuthorized: vi.fn(),
  getSnapshot: vi.fn(),
}))

vi.mock('@/lib/internal/personal-os-auth', () => ({
  isPersonalOsRequestAuthorized: mocks.isAuthorized,
}))
vi.mock('@/lib/services/formoria-executive', () => ({
  getFormoriaExecutiveSnapshot: mocks.getSnapshot,
}))

import { GET } from './route'

describe('GET /api/internal/personal-os/executive', () => {
  beforeEach(() => vi.clearAllMocks())

  it('authenticates before loading any executive data', async () => {
    mocks.isAuthorized.mockReturnValue(false)

    const response = await GET(new Request('http://localhost/api/internal/personal-os/executive'))

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.getSnapshot).not.toHaveBeenCalled()
  })

  it('returns the normalized snapshot without caching', async () => {
    mocks.isAuthorized.mockReturnValue(true)
    mocks.getSnapshot.mockResolvedValue({ schemaVersion: 1 })

    const response = await GET(new Request('http://localhost/api/internal/personal-os/executive'))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ schemaVersion: 1 })
  })
})
