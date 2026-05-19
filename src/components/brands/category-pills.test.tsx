// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockReplace = vi.fn()
const mockSearchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => mockSearchParams,
  usePathname: () => '/',
}))

describe('CategoryPills', () => {
  const categories = [
    { slug: 'food-beverage', name: 'Food & Beverage' },
    { slug: 'fashion', name: 'Fashion' },
    { slug: 'lifestyle', name: 'Lifestyle' },
  ]

  beforeEach(() => {
    mockReplace.mockClear()
    mockSearchParams.delete('category')
  })

  it('renders All pill and category pills', async () => {
    const { CategoryPills } = await import('./category-pills')
    render(<CategoryPills categories={categories} />)
    expect(screen.getByRole('button', { name: /all/i })).toBeInTheDocument()
    expect(screen.getByText('Food & Beverage')).toBeInTheDocument()
    expect(screen.getByText('Fashion')).toBeInTheDocument()
    expect(screen.getByText('Lifestyle')).toBeInTheDocument()
  })

  it('highlights All pill when no category selected', async () => {
    const { CategoryPills } = await import('./category-pills')
    render(<CategoryPills categories={categories} />)
    const allPill = screen.getByRole('button', { name: /all/i })
    expect(allPill).toHaveAttribute('data-active', 'true')
  })

  it('highlights selected category pill from URL params', async () => {
    mockSearchParams.set('category', 'fashion')
    const { CategoryPills } = await import('./category-pills')
    render(<CategoryPills categories={categories} />)
    const fashionPill = screen.getByText('Fashion')
    expect(fashionPill.closest('button')).toHaveAttribute(
      'data-active',
      'true'
    )
    mockSearchParams.delete('category')
  })

  it('updates URL params when pill is clicked', async () => {
    const { CategoryPills } = await import('./category-pills')
    render(<CategoryPills categories={categories} />)
    fireEvent.click(screen.getByText('Fashion'))
    expect(mockReplace).toHaveBeenCalled()
  })
})
