import { cookies } from 'next/headers'
import { describe, expect, it, vi, type Mock } from 'vitest'

const mockUser = vi.hoisted(() => ({
  email: 'admin@formoria.com',
}))

vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { email: mockUser.email } },
      })),
    },
  })),
}))
vi.mock('@/lib/auth/admin-mode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/admin-mode')>()
  return {
    ...actual,
    signAdminModeCookieValue: vi.fn(async (v: string) => `signed:${v}`),
    ADMIN_MODE_COOKIE_OPTIONS: {
      httpOnly: true,
      sameSite: 'strict',
      secure: false,
      maxAge: 86400,
      path: '/',
    },
  }
})

describe('setAdminModeAction', () => {
  it('sets fm_mode for a real admin', async () => {
    const set = vi.fn()
    ;(cookies as Mock).mockResolvedValue({ set, get: () => undefined })
    mockUser.email = 'admin@formoria.com'
    process.env.ADMIN_EMAILS = 'admin@formoria.com'

    const { setAdminModeAction } = await import('./actions')
    await setAdminModeAction('viewer')

    expect(set).toHaveBeenCalledWith(
      'fm_mode',
      'signed:viewer',
      expect.objectContaining({ sameSite: 'strict', httpOnly: true })
    )
  })

  it('is a no-op for a non-admin', async () => {
    const set = vi.fn()
    ;(cookies as Mock).mockResolvedValue({ set, get: () => undefined })
    mockUser.email = 'user@example.com'
    process.env.ADMIN_EMAILS = 'admin@formoria.com'

    const { setAdminModeAction } = await import('./actions')
    await setAdminModeAction('viewer')

    expect(set).not.toHaveBeenCalled()
  })
})
