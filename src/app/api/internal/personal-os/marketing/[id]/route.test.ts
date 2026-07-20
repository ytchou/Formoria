import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isAuthorized: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
}))

vi.mock('@/lib/internal/personal-os-auth', () => ({
  isPersonalOsRequestAuthorized: mocks.isAuthorized,
}))
vi.mock('@/lib/services/marketing-calendar', () => ({
  updateMarketingItem: mocks.updateItem,
  deleteMarketingItem: mocks.deleteItem,
}))

import { DELETE, PATCH } from './route'

const callPatch = (body: unknown, id = 'test-id') =>
  PATCH(
    new Request('http://localhost/api/internal/personal-os/marketing/test-id', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  )

const callDelete = (id = 'test-id') =>
  DELETE(
    new Request(`http://localhost/api/internal/personal-os/marketing/${id}`, { method: 'DELETE' }),
    { params: Promise.resolve({ id }) },
  )

describe('PATCH /api/internal/personal-os/marketing/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthorized', async () => {
    mocks.isAuthorized.mockReturnValue(false)

    const response = await callPatch({ title: 'Updated' })

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.updateItem).not.toHaveBeenCalled()
  })

  it('returns 200 with the updated item on valid patch', async () => {
    mocks.isAuthorized.mockReturnValue(true)
    const updated = { id: 'test-id', title: 'Updated', status: 'brief' }
    mocks.updateItem.mockResolvedValue(updated)

    const response = await callPatch({ title: 'Updated', status: 'brief' })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ item: updated })
    expect(mocks.updateItem).toHaveBeenCalledWith('test-id', {
      title: 'Updated',
      status: 'brief',
    })
  })

  it('returns 400 when an enum value is invalid and does not call the service', async () => {
    mocks.isAuthorized.mockReturnValue(true)

    const response = await callPatch({ status: 'invalid-status' })

    expect(response.status).toBe(400)
    expect(mocks.updateItem).not.toHaveBeenCalled()
  })

  it('returns 400 when id is included in the body (immutable)', async () => {
    mocks.isAuthorized.mockReturnValue(true)

    const response = await callPatch({ id: 'sneaky', title: 'Updated' })

    expect(response.status).toBe(400)
    expect(mocks.updateItem).not.toHaveBeenCalled()
  })

  it('returns 404 when the service returns null (unknown id)', async () => {
    mocks.isAuthorized.mockReturnValue(true)
    mocks.updateItem.mockResolvedValue(null)

    const response = await callPatch({ title: 'Ghost' })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not found' })
  })

  it('returns 503 when the service throws', async () => {
    mocks.isAuthorized.mockReturnValue(true)
    mocks.updateItem.mockRejectedValue(new Error('db down'))

    const response = await callPatch({ title: 'Boom' })

    expect(response.status).toBe(503)
  })
})

describe('DELETE /api/internal/personal-os/marketing/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthorized', async () => {
    mocks.isAuthorized.mockReturnValue(false)

    const response = await callDelete()

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.deleteItem).not.toHaveBeenCalled()
  })

  it('returns 200 with deleted true on success', async () => {
    mocks.isAuthorized.mockReturnValue(true)
    mocks.deleteItem.mockResolvedValue({ deleted: true })

    const response = await callDelete()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ deleted: true })
  })

  it('returns 404 when the service returns deleted false (unknown id)', async () => {
    mocks.isAuthorized.mockReturnValue(true)
    mocks.deleteItem.mockResolvedValue({ deleted: false })

    const response = await callDelete()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not found' })
  })

  it('returns 503 when the service throws', async () => {
    mocks.isAuthorized.mockReturnValue(true)
    mocks.deleteItem.mockRejectedValue(new Error('db down'))

    const response = await callDelete()

    expect(response.status).toBe(503)
  })
})
