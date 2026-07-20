import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ isAuthorized: vi.fn(), getSnapshot: vi.fn() }))

vi.mock('@/lib/internal/personal-os-auth', () => ({
  isPersonalOsRequestAuthorized: mocks.isAuthorized,
}))
vi.mock('@/lib/services/formoria-feedback', () => ({
  getFormoriaFeedbackSnapshot: mocks.getSnapshot,
}))

import { GET } from './route'

describe('GET /api/internal/personal-os/feedback', () => {
  beforeEach(() => vi.clearAllMocks())

  it('authenticates before reading feedback', async () => {
    mocks.isAuthorized.mockReturnValue(false)
    const response = await GET(new Request('http://localhost/api/internal/personal-os/feedback'))

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ code: 'unauthorized', message: 'Unauthorized' })
    expect(mocks.getSnapshot).not.toHaveBeenCalled()
  })

  it('returns a no-store snapshot', async () => {
    mocks.isAuthorized.mockReturnValue(true)
    mocks.getSnapshot.mockResolvedValue({ schemaVersion: 1, generatedAt: '2026-07-20T00:00:00.000Z', items: [] })

    const response = await GET(new Request('http://localhost/api/internal/personal-os/feedback'))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toMatchObject({ schemaVersion: 1, items: [] })
  })
})
