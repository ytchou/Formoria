import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isAuthorized: vi.fn(),
  listItems: vi.fn(),
  createItem: vi.fn(),
}))

vi.mock('@/lib/internal/personal-os-auth', () => ({
  isPersonalOsRequestAuthorized: mocks.isAuthorized,
}))
vi.mock(import('@/lib/services/marketing-calendar'), async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, listMarketingItems: mocks.listItems, createMarketingItem: mocks.createItem }
})

import { GET, POST } from './route'

const BASE_URL = 'http://localhost/api/internal/personal-os/marketing'

describe('GET /api/internal/personal-os/marketing', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthorized', async () => {
    mocks.isAuthorized.mockReturnValue(false)

    const response = await GET(new Request(BASE_URL))

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.listItems).not.toHaveBeenCalled()
  })

  it('returns items array with no-store header when authorized', async () => {
    mocks.isAuthorized.mockReturnValue(true)
    mocks.listItems.mockResolvedValue([{ id: '1', title: 'Test', type: 'idea' }])

    const response = await GET(new Request(BASE_URL))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ items: [{ id: '1', title: 'Test', type: 'idea' }] })
  })

  it('returns 503 when service throws', async () => {
    mocks.isAuthorized.mockReturnValue(true)
    mocks.listItems.mockRejectedValue(new Error('DB error'))

    const response = await GET(new Request(BASE_URL))

    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ error: 'Marketing calendar unavailable' })
  })
})

describe('POST /api/internal/personal-os/marketing', () => {
  beforeEach(() => vi.clearAllMocks())

  function makeRequest(body: unknown) {
    return new Request(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('returns 401 when unauthorized', async () => {
    mocks.isAuthorized.mockReturnValue(false)

    const response = await POST(makeRequest({ id: '1', title: 'Test', type: 'idea' }))

    expect(response.status).toBe(401)
    expect(mocks.createItem).not.toHaveBeenCalled()
  })

  it('rejects invalid enum type with 400 and does not call service', async () => {
    mocks.isAuthorized.mockReturnValue(true)

    const response = await POST(makeRequest({ id: '1', title: 'Test', type: 'invalid-type' }))

    expect(response.status).toBe(400)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.createItem).not.toHaveBeenCalled()
  })

  it('rejects missing required fields with 400', async () => {
    mocks.isAuthorized.mockReturnValue(true)

    const response = await POST(makeRequest({ title: 'Test', type: 'idea' }))

    expect(response.status).toBe(400)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.createItem).not.toHaveBeenCalled()
  })

  it('creates item and returns { item } with 200 when valid', async () => {
    mocks.isAuthorized.mockReturnValue(true)
    const created = { id: '1', title: 'Test', type: 'idea', status: 'brief' }
    mocks.createItem.mockResolvedValue(created)

    const response = await POST(
      makeRequest({ id: '1', title: 'Test', type: 'idea', status: 'brief' }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ item: created })
    expect(mocks.createItem).toHaveBeenCalledOnce()
  })
})
