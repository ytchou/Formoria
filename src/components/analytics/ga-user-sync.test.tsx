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

  it('sets user properties for authenticated user', async () => {
    mockUseUser.mockReturnValue({
      user: { id: 'user-niizo', email: 'owner@niizo.tw', provider: 'email' },
      loading: false,
    })
    const { GaUserSync } = await import('./ga-user-sync')

    render(<GaUserSync />)

    expect(window.gtag).toHaveBeenCalledWith('set', { user_id: 'user-niizo' })
    expect(window.gtag).toHaveBeenCalledWith('set', {
      user_properties: {
        user_type: 'authenticated',
        preferred_locale: 'en',
      },
    })
  })

  it('sets user properties for unauthenticated visitor', async () => {
    const { GaUserSync } = await import('./ga-user-sync')

    render(<GaUserSync />)

    expect(window.gtag).toHaveBeenCalledWith('set', { user_id: null })
    expect(window.gtag).toHaveBeenCalledWith('set', {
      user_properties: {
        user_type: 'visitor',
        preferred_locale: 'en',
      },
    })
  })

  it('tracks login when user transitions from unauthenticated to authenticated', async () => {
    const { GaUserSync } = await import('./ga-user-sync')

    const { rerender } = render(<GaUserSync />)

    expect(mockTrackLogin).not.toHaveBeenCalled()

    mockUseUser.mockReturnValue({
      user: {
        id: 'user-niizo',
        email: 'owner@niizo.tw',
        provider: 'google',
      },
      loading: false,
    })

    rerender(<GaUserSync />)

    expect(mockTrackLogin).toHaveBeenCalledWith('google')
  })

  it('tracks sign_up when is_new_user=1 is in the URL', async () => {
    window.history.replaceState({}, '', '/en/brands?is_new_user=1')
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

    expect(mockTrackSignUp).toHaveBeenCalledWith('google')
    expect(mockTrackLogin).not.toHaveBeenCalled()
  })

  it('tracks login when is_new_user is absent from the URL', async () => {
    window.history.replaceState({}, '', '/en/brands')
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

    expect(mockTrackLogin).toHaveBeenCalledWith('google')
    expect(mockTrackSignUp).not.toHaveBeenCalled()
  })

  it('detects email auth method when provider is not google', async () => {
    const { GaUserSync } = await import('./ga-user-sync')

    const { rerender } = render(<GaUserSync />)

    mockUseUser.mockReturnValue({
      user: {
        id: 'user-niizo',
        email: 'owner@niizo.tw',
        provider: 'email',
      },
      loading: false,
    })

    rerender(<GaUserSync />)

    expect(mockTrackLogin).toHaveBeenCalledWith('email')
  })

  it('uses the email provider projected by the viewer context', async () => {
    const { GaUserSync } = await import('./ga-user-sync')

    const { rerender } = render(<GaUserSync />)

    mockUseUser.mockReturnValue({
      user: { id: 'user-niizo', email: 'owner@niizo.tw', provider: 'email' },
      loading: false,
    })

    rerender(<GaUserSync />)

    expect(mockTrackLogin).toHaveBeenCalledWith('email')
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

  it('sets content_group based on pathname', async () => {
    mockUsePathname.mockReturnValue('/zh-TW/brands/formoria')
    const { GaUserSync } = await import('./ga-user-sync')

    render(<GaUserSync />)

    expect(window.gtag).toHaveBeenCalledWith('set', {
      content_group: 'brand_detail',
    })
  })
})
