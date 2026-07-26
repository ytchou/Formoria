// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockUseUser = vi.fn()
const mockUsePathname = vi.fn()
const mockTrackLogin = vi.hoisted(() => vi.fn())
const mockTrackSignUp = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/use-user', () => ({
  useUser: () => mockUseUser(),
}))

vi.mock('@/lib/analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/analytics')>()

  return {
    ...actual,
    trackLogin: mockTrackLogin,
    trackSignUp: mockTrackSignUp,
  }
})

vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockUseUser.mockReturnValue({ user: null, loading: false })
  mockUsePathname.mockReturnValue('/en/brands')
  window.history.replaceState({}, '', '/en/brands')
  window.gtag = vi.fn()
})

describe('GaUserSync', () => {
  it('renders null', async () => {
    const { GaUserSync } = await import('./ga-user-sync')

    const { container } = render(<GaUserSync />)

    expect(container).toBeEmptyDOMElement()
  })









  it('cleans is_new_user param from URL after firing sign_up', async () => {
    window.history.replaceState(
      {},
      '',
      '/en/brands?is_new_user=1&utm_source=test',
    )
    const { GaUserSync } = await import('./ga-user-sync')

    const { rerender } = render(<GaUserSync />)

    mockUseUser.mockReturnValue({
      user: {
        id: 'user-niizo',
        email: 'owner@niizo.tw',
        provider: 'google',
      },
      loading: false,
    })

    rerender(<GaUserSync />)

    expect(window.location.search).not.toContain('is_new_user')
    expect(window.location.search).toContain('utm_source=test')
  })

})
