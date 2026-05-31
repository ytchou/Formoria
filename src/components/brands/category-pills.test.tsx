// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextIntlClientProvider } from 'next-intl'
import zh from '../../../messages/zh-TW.json'

const mockReplace = vi.fn()
const mockSearchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => mockSearchParams,
  usePathname: () => '/',
}))

function renderWithProvider(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zh}>
      {ui}
    </NextIntlClientProvider>
  )
}

describe('CategoryPills', () => {
  const categories = [
    { slug: 'food-beverage', name: 'Food & Beverage', nameZh: null },
    { slug: 'fashion', name: 'Fashion', nameZh: null },
    { slug: 'lifestyle', name: 'Lifestyle', nameZh: null },
  ]

  beforeEach(() => {
    mockReplace.mockClear()
    mockSearchParams.delete('category')
  })

  it('renders All pill and category pills', async () => {
    const { CategoryPills } = await import('./category-pills')
    renderWithProvider(<CategoryPills categories={categories} />)
    expect(screen.getByRole('button', { name: /全部/ })).toBeInTheDocument()
    expect(screen.getByText('Food & Beverage')).toBeInTheDocument()
    expect(screen.getByText('Fashion')).toBeInTheDocument()
    expect(screen.getByText('Lifestyle')).toBeInTheDocument()
  })

  it('highlights All pill when no category selected', async () => {
    const { CategoryPills } = await import('./category-pills')
    renderWithProvider(<CategoryPills categories={categories} />)
    const allPill = screen.getByRole('button', { name: /全部/ })
    expect(allPill).toHaveAttribute('data-active', 'true')
  })

  it('highlights selected category pill from URL params', async () => {
    mockSearchParams.set('category', 'fashion')
    const { CategoryPills } = await import('./category-pills')
    renderWithProvider(<CategoryPills categories={categories} />)
    const fashionPill = screen.getByText('Fashion')
    expect(fashionPill.closest('button')).toHaveAttribute(
      'data-active',
      'true'
    )
    mockSearchParams.delete('category')
  })

  it('updates URL params when pill is clicked', async () => {
    const { CategoryPills } = await import('./category-pills')
    renderWithProvider(<CategoryPills categories={categories} />)
    fireEvent.click(screen.getByText('Fashion'))
    expect(mockReplace).toHaveBeenCalled()
  })
})

describe('CategoryPills — nameZh support', () => {
  const categoriesWithZh = [
    { slug: 'food', name: 'Food', nameZh: '食品' },
    { slug: 'fashion', name: 'Fashion', nameZh: null },
  ]

  it('renders nameZh when provided', async () => {
    const { CategoryPills } = await import('./category-pills')
    renderWithProvider(<CategoryPills categories={categoriesWithZh} />)
    expect(screen.getByRole('button', { name: '食品' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Food' })).not.toBeInTheDocument()
  })

  it('falls back to name when nameZh is null', async () => {
    const { CategoryPills } = await import('./category-pills')
    renderWithProvider(<CategoryPills categories={categoriesWithZh} />)
    expect(screen.getByRole('button', { name: 'Fashion' })).toBeInTheDocument()
  })
})
