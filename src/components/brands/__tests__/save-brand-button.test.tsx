// @vitest-environment jsdom
import type { ReactElement } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'

const mockUser = { id: 'user-123', email: 'test@example.com', provider: 'email' }
const mockPush = vi.fn()
const viewerState = {
  viewer: { hasOwnedBrand: false, isAdmin: false, impersonation: null },
  viewerLoading: false,
  refreshViewer: vi.fn(async () => {}),
}

vi.mock('@/lib/auth/use-user', () => ({
  useUser: vi.fn(() => ({ user: mockUser, loading: false, ...viewerState })),
}))

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ push: mockPush })),
}))

vi.mock('@/i18n/navigation', () => ({
  usePathname: vi.fn(() => '/brands/test-brand'),
}))

vi.mock('@/hooks/use-saved-brands', () => ({
  useSavedBrands: vi.fn(() => ({
    savedIds: new Set<string>(),
    toggle: vi.fn(),
    loading: false,
  })),
}))

const mocks = vi.hoisted(() => ({
  trackBrandSaved: vi.fn(),
  trackBrandUnsaved: vi.fn(),
}))

vi.mock('@/lib/analytics', () => ({
  trackBrandSaved: mocks.trackBrandSaved,
  trackBrandUnsaved: mocks.trackBrandUnsaved,
}))

import { SaveBrandButton } from '../save-brand-button'
import { useUser } from '@/lib/auth/use-user'
import { useSavedBrands } from '@/hooks/use-saved-brands'

const messages = {
  saveBrand: {
    save: '收藏',
    unsave: '取消收藏',
    saveAriaLabel: '收藏這個品牌',
    unsaveAriaLabel: '取消收藏這個品牌',
    loginToSave: '登入後即可收藏品牌',
  },
}

function renderWithProviders(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={messages}>
      {ui}
    </NextIntlClientProvider>
  )
}

describe('SaveBrandButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useSavedBrands).mockReturnValue({
      savedIds: new Set<string>(),
      toggle: vi.fn(),
      loading: false,
    })
  })

  it('renders an unfilled bookmark when brand is not saved', () => {
    renderWithProviders(<SaveBrandButton brandId="brand-1" slug="brand-slug-1" />)
    const button = screen.getByRole('button', { name: '收藏這個品牌' })
    expect(button).toBeInTheDocument()
    expect(button.querySelector('[data-auth-required-indicator]')).not.toBeInTheDocument()
  })

  it('renders a filled bookmark when brand is saved', () => {
    vi.mocked(useSavedBrands).mockReturnValue({
      savedIds: new Set(['brand-1']),
      toggle: vi.fn(),
      loading: false,
    })
    renderWithProviders(<SaveBrandButton brandId="brand-1" slug="brand-slug-1" />)
    const button = screen.getByRole('button', { name: '取消收藏這個品牌' })
    expect(button).toBeInTheDocument()
  })


  it('redirects to login when clicked by unauthenticated user', () => {
    vi.mocked(useUser).mockReturnValue({
      user: null,
      loading: false,
      ...viewerState,
    })
    renderWithProviders(<SaveBrandButton brandId="brand-1" slug="brand-slug-1" variant="inline" />)
    const button = screen.getByRole('button', { name: '收藏這個品牌' })
    expect(button).toHaveAttribute('title', '登入後即可收藏品牌')
    expect(button.querySelector('[data-auth-required-indicator]')).toBeInTheDocument()
    fireEvent.click(button)
    expect(mockPush).toHaveBeenCalledWith('/auth/sign-in')
  })


})
