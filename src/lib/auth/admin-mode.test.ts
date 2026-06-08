import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { cookies } from 'next/headers'
import { isOwnerOf } from '@/lib/services/brand-owners'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('@/lib/services/brand-owners', () => ({ isOwnerOf: vi.fn() }))

const mockCookie = (value?: string) =>
  (cookies as Mock).mockResolvedValue({ get: (n: string) => (n === 'fm_mode' && value ? { value } : undefined) })

describe('admin-mode', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.ADMIN_EMAILS = 'admin@formoria.com'
    ;(isOwnerOf as Mock).mockReset()
  })
  afterEach(() => vi.clearAllMocks())

  it('isViewerMode reflects the fm_mode cookie', async () => {
    const { isViewerMode } = await import('./admin-mode')
    mockCookie('viewer'); expect(await isViewerMode()).toBe(true)
    mockCookie('god'); expect(await isViewerMode()).toBe(false)
    mockCookie(undefined); expect(await isViewerMode()).toBe(false)
  })

  it('isActingAsAdmin: true for admin in god mode, false in viewer or for non-admin/empty', async () => {
    const { isActingAsAdmin } = await import('./admin-mode')
    mockCookie('god')
    expect(await isActingAsAdmin('admin@formoria.com')).toBe(true)
    expect(await isActingAsAdmin('user@example.com')).toBe(false)
    expect(await isActingAsAdmin(null)).toBe(false)
    mockCookie('viewer')
    expect(await isActingAsAdmin('admin@formoria.com')).toBe(false)
  })

  it('canManageBrand: true if real owner OR acting admin', async () => {
    const { canManageBrand } = await import('./admin-mode')
    mockCookie('god')
    ;(isOwnerOf as Mock).mockResolvedValue(true)
    expect(await canManageBrand('u1', 'user@example.com', 'b1')).toBe(true) // owner
    ;(isOwnerOf as Mock).mockResolvedValue(false)
    expect(await canManageBrand('u1', 'admin@formoria.com', 'b1')).toBe(true) // acting admin
    expect(await canManageBrand('u1', 'user@example.com', 'b1')).toBe(false) // neither
    mockCookie('viewer')
    expect(await canManageBrand('u1', 'admin@formoria.com', 'b1')).toBe(false) // admin downgraded, not owner
  })

  it('resolveAdminModeCookie: set god for admin w/o cookie, preserve viewer, delete for non-admin', async () => {
    const { resolveAdminModeCookie } = await import('./admin-mode')
    expect(resolveAdminModeCookie({ email: 'admin@formoria.com', currentCookie: undefined })).toEqual({ action: 'set', value: 'god' })
    expect(resolveAdminModeCookie({ email: 'admin@formoria.com', currentCookie: 'viewer' })).toEqual({ action: 'none' })
    expect(resolveAdminModeCookie({ email: 'admin@formoria.com', currentCookie: 'god' })).toEqual({ action: 'none' })
    expect(resolveAdminModeCookie({ email: 'user@example.com', currentCookie: 'god' })).toEqual({ action: 'delete' })
    expect(resolveAdminModeCookie({ email: null, currentCookie: 'viewer' })).toEqual({ action: 'delete' })
    expect(resolveAdminModeCookie({ email: 'user@example.com', currentCookie: undefined })).toEqual({ action: 'none' })
  })
})
