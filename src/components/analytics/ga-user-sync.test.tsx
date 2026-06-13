// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockUseUser = vi.fn()
const mockUsePathname = vi.fn()
const mockTrackLogin = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/use-user', () => ({
  useUser: () => mockUseUser(),
}))

vi.mock('@/lib/analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/analytics')>()

  return {
    ...actual,
    trackLogin: mockTrackLogin,
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
      user: { id: 'user-1', email: 'owner@example.com' },
      loading: false,
    })
    const { GaUserSync } = await import('./ga-user-sync')

    render(<GaUserSync />)

    expect(window.gtag).toHaveBeenCalledWith('set', { user_id: 'user-1' })
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
      user: { id: 'user-1', email: 'owner@example.com' },
      loading: false,
    })

    rerender(<GaUserSync />)

    expect(mockTrackLogin).toHaveBeenCalledWith('google')
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
