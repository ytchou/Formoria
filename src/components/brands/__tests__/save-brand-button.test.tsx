// @vitest-environment jsdom
import type { ReactElement } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'

const mockUser = { id: 'user-123', email: 'test@example.com' }
const mockPush = vi.fn()

vi.mock('@/lib/auth/use-user', () => ({
  useUser: vi.fn(() => ({ user: mockUser, loading: false })),
}))

vi.mock('@/i18n/navigation', () => ({
  useRouter: vi.fn(() => ({ push: mockPush })),
  usePathname: vi.fn(() => '/brands/test-brand'),
}))

vi.mock('@/hooks/use-saved-brands', () => ({
  useSavedBrands: vi.fn(() => ({
    savedIds: new Set<string>(),
    toggle: vi.fn(),
    loading: false,
  })),
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
  })

  it('renders an unfilled heart when brand is not saved', () => {
    renderWithProviders(<SaveBrandButton brandId="brand-1" />)
    const button = screen.getByRole('button', { name: '收藏這個品牌' })
    expect(button).toBeInTheDocument()
  })

  it('renders a filled heart when brand is saved', () => {
    vi.mocked(useSavedBrands).mockReturnValue({
      savedIds: new Set(['brand-1']),
      toggle: vi.fn(),
      loading: false,
    })
    renderWithProviders(<SaveBrandButton brandId="brand-1" />)
    const button = screen.getByRole('button', { name: '取消收藏這個品牌' })
    expect(button).toBeInTheDocument()
  })

  it('calls toggle when clicked by authenticated user', async () => {
    const mockToggle = vi.fn()
    vi.mocked(useSavedBrands).mockReturnValue({
      savedIds: new Set<string>(),
      toggle: mockToggle,
      loading: false,
    })
    renderWithProviders(<SaveBrandButton brandId="brand-1" />)
    const button = screen.getByRole('button', { name: '收藏這個品牌' })
    fireEvent.click(button)
    expect(mockToggle).toHaveBeenCalledWith('brand-1')
  })

  it('redirects to login when clicked by unauthenticated user', () => {
    vi.mocked(useUser).mockReturnValue({ user: null, loading: false })
    renderWithProviders(<SaveBrandButton brandId="brand-1" />)
    const button = screen.getByRole('button', { name: '收藏這個品牌' })
    fireEvent.click(button)
    expect(mockPush).toHaveBeenCalledWith('/auth/sign-in')
  })
})
