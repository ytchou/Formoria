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
    process.env.CHALLENGE_SECRET = 'test-cookie-secret'
    ;(isOwnerOf as Mock).mockReset()
  })
  afterEach(() => vi.clearAllMocks())

  it('isViewerMode reflects the fm_mode cookie', async () => {
    const { signAdminModeCookieValue } = await import('./admin-mode-cookie')
    const { isViewerMode } = await import('./admin-mode')
    mockCookie(signAdminModeCookieValue('viewer')); expect(await isViewerMode()).toBe(true)
    mockCookie(signAdminModeCookieValue('god')); expect(await isViewerMode()).toBe(false)
    mockCookie(undefined); expect(await isViewerMode()).toBe(false)
  })

  it('isActingAsAdmin: true for admin in god mode, false in viewer or for non-admin/empty', async () => {
    const { signAdminModeCookieValue } = await import('./admin-mode-cookie')
    const { isActingAsAdmin } = await import('./admin-mode')
    mockCookie(signAdminModeCookieValue('god'))
    expect(await isActingAsAdmin('admin@formoria.com')).toBe(true)
    expect(await isActingAsAdmin('user@example.com')).toBe(false)
    expect(await isActingAsAdmin(null)).toBe(false)
    mockCookie(signAdminModeCookieValue('viewer'))
    expect(await isActingAsAdmin('admin@formoria.com')).toBe(false)
  })

  it('canManageBrand: true if real owner OR acting admin', async () => {
    const { signAdminModeCookieValue } = await import('./admin-mode-cookie')
    const { canManageBrand } = await import('./admin-mode')
    mockCookie(signAdminModeCookieValue('god'))
    ;(isOwnerOf as Mock).mockResolvedValue(true)
    expect(await canManageBrand('u1', 'user@example.com', 'b1')).toBe(true) // owner
    ;(isOwnerOf as Mock).mockResolvedValue(false)
    expect(await canManageBrand('u1', 'admin@formoria.com', 'b1')).toBe(true) // acting admin
    expect(await canManageBrand('u1', 'user@example.com', 'b1')).toBe(false) // neither
    mockCookie(signAdminModeCookieValue('viewer'))
    expect(await canManageBrand('u1', 'admin@formoria.com', 'b1')).toBe(false) // admin downgraded, not owner
  })

  it('resolveAdminModeCookie: set god for admin w/o cookie, preserve viewer, delete for non-admin', async () => {
    const { resolveAdminModeCookie, readAdminModeCookie, signAdminModeCookieValue } = await import('./admin-mode')
    const viewerCookie = signAdminModeCookieValue('viewer')
    const godCookie = signAdminModeCookieValue('god')
    const decision = resolveAdminModeCookie({ email: 'admin@formoria.com', currentCookie: undefined })

    expect(decision.action).toBe('set')
    expect(decision.action === 'set' ? readAdminModeCookie(decision.value) : null).toBe('god')
    expect(resolveAdminModeCookie({ email: 'admin@formoria.com', currentCookie: viewerCookie })).toEqual({ action: 'none' })
    expect(resolveAdminModeCookie({ email: 'admin@formoria.com', currentCookie: godCookie })).toEqual({ action: 'none' })
    expect(resolveAdminModeCookie({ email: 'user@example.com', currentCookie: godCookie })).toEqual({ action: 'delete' })
    expect(resolveAdminModeCookie({ email: null, currentCookie: viewerCookie })).toEqual({ action: 'delete' })
    expect(resolveAdminModeCookie({ email: 'user@example.com', currentCookie: undefined })).toEqual({ action: 'none' })
  })

  it('rejects unsigned or tampered admin mode cookies', async () => {
    const { readAdminModeCookie, signAdminModeCookieValue } = await import('./admin-mode')
    const signed = signAdminModeCookieValue('viewer')

    expect(readAdminModeCookie('viewer')).toBeNull()
    expect(readAdminModeCookie(signed.replace('viewer', 'god'))).toBeNull()
  })

  it('exports hardened admin mode cookie attributes', async () => {
    const { ADMIN_MODE_COOKIE_OPTIONS } = await import('./admin-mode')

    expect(ADMIN_MODE_COOKIE_OPTIONS).toMatchObject({
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 86400,
    })
  })
})
