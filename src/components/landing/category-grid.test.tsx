// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => <a href={href} {...props}>{children}</a>,
}))

import CategoryGrid from './category-grid'

const mockCategories = [
  { slug: 'food', name: 'Food & Beverage', nameZh: '食品飲料' },
  { slug: 'beauty', name: 'Beauty', nameZh: '美妝保養' },
  { slug: 'design', name: 'Design', nameZh: '設計選品' },
  { slug: 'lifestyle', name: 'Lifestyle', nameZh: '生活風格' },
]

describe('CategoryGrid', () => {
  it('renders category names as links to /brands?category=slug', () => {
    render(<CategoryGrid categories={mockCategories} />)

    expect(screen.getByText('食品飲料')).toBeInTheDocument()
    expect(screen.getByText('美妝保養')).toBeInTheDocument()

    const foodLink = screen.getByRole('link', { name: /食品飲料/ })
    expect(foodLink).toHaveAttribute('href', '/brands?category=food')
  })

  it('renders nothing when categories is empty', () => {
    const { container } = render(<CategoryGrid categories={[]} />)
    expect(container.innerHTML).toBe('')
  })
})
