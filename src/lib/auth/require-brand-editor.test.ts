import { beforeEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const getBrandBySlug = vi.fn()
const isOwnerOf = vi.fn()
const isActingAsAdmin = vi.fn()
const getImpersonatedBrandSlug = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser,
    },
  })),
}))

vi.mock('@/lib/services/brands', () => ({
  getBrandBySlug,
}))

vi.mock('@/lib/services/brand-owners', () => ({
  isOwnerOf,
}))

vi.mock('./admin-mode', () => ({
  isActingAsAdmin,
}))

vi.mock('./impersonation', () => ({
  getImpersonatedBrandSlug,
}))

describe('requireBrandEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUser.mockResolvedValue({ data: { user: null }, error: null })
    getBrandBySlug.mockResolvedValue({ id: 'brand-1', slug: 'brand-1', name: 'Brand 1' })
    isOwnerOf.mockResolvedValue(false)
    isActingAsAdmin.mockResolvedValue(false)
    getImpersonatedBrandSlug.mockResolvedValue(null)
  })

  it('allows an owner who is not an admin', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'owner@example.com' } },
      error: null,
    })
    isOwnerOf.mockResolvedValueOnce(true)
    isActingAsAdmin.mockResolvedValueOnce(false)

    const { requireBrandEditor } = await import('./require-brand-editor')
    await expect(requireBrandEditor('brand-1')).resolves.toEqual({
      user: { id: 'user-1', email: 'owner@example.com' },
      brand: { id: 'brand-1', slug: 'brand-1', name: 'Brand 1' },
      owner: true,
      actingAdmin: false,
      configuredAdmin: false,
    })
  })

  it('allows a god-mode admin who is not the owner', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'admin-1', email: 'admin@formoria.com' } },
      error: null,
    })
    isOwnerOf.mockResolvedValueOnce(false)
    isActingAsAdmin.mockResolvedValueOnce(true)
    getImpersonatedBrandSlug.mockResolvedValueOnce('brand-1')

    const { requireBrandEditor } = await import('./require-brand-editor')
    await expect(requireBrandEditor('brand-1')).resolves.toEqual({
      user: { id: 'admin-1', email: 'admin@formoria.com' },
      brand: { id: 'brand-1', slug: 'brand-1', name: 'Brand 1' },
      owner: false,
      actingAdmin: true,
      configuredAdmin: true,
    })
  })

  it('rejects an admin in viewer mode who is not the owner', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'admin-1', email: 'admin@formoria.com' } },
      error: null,
    })
    isOwnerOf.mockResolvedValueOnce(false)
    isActingAsAdmin.mockResolvedValueOnce(false)

    const { requireBrandEditor } = await import('./require-brand-editor')
    await expect(requireBrandEditor('brand-1')).resolves.toEqual({ error: 'forbidden' })
  })

  it('prefers the owner path over viewer mode for an owner-admin', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'admin-1', email: 'admin@formoria.com' } },
      error: null,
    })
    isOwnerOf.mockResolvedValueOnce(true)
    isActingAsAdmin.mockResolvedValueOnce(true)

    const { requireBrandEditor } = await import('./require-brand-editor')
    await expect(requireBrandEditor('brand-1')).resolves.toEqual({
      user: { id: 'admin-1', email: 'admin@formoria.com' },
      brand: { id: 'brand-1', slug: 'brand-1', name: 'Brand 1' },
      owner: true,
      actingAdmin: false,
      configuredAdmin: true,
    })
  })

  it('uses the current inline impersonation rule exactly', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'admin-1', email: 'admin@formoria.com' } },
      error: null,
    })
    isOwnerOf.mockResolvedValueOnce(false)
    isActingAsAdmin.mockResolvedValueOnce(true)
    getImpersonatedBrandSlug.mockResolvedValueOnce('different-brand')

    const { requireBrandEditor } = await import('./require-brand-editor')
    await expect(requireBrandEditor('brand-1')).resolves.toEqual({ error: 'forbidden' })
  })

  it('rejects unauthenticated users', async () => {
    const { requireBrandEditor } = await import('./require-brand-editor')
    await expect(requireBrandEditor('brand-1')).resolves.toEqual({ error: 'notLoggedIn' })
  })

  it('rejects unknown brands', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'owner@example.com' } },
      error: null,
    })
    getBrandBySlug.mockRejectedValueOnce(new Error('Brand not found: brand-1'))

    const { requireBrandEditor } = await import('./require-brand-editor')
    await expect(requireBrandEditor('brand-1')).resolves.toEqual({ error: 'brandNotFound' })
  })
})
