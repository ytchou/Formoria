// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { RelatedBrands } from '../related-brands'
import type { Brand } from '@/lib/types'

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string, params?: Record<string, unknown>) => {
    if (key === 'relatedBrands.heading') return `更多${params?.category}`
    if (key === 'relatedBrands.subtext') return `此分類還有 ${params?.count} 個品牌`
    if (key === 'relatedBrands.viewAll') return '查看全部'
    return key
  }),
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string
    children: React.ReactNode
    [key: string]: unknown
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('../brand-card', () => ({
  BrandCard: ({ brand }: { brand: Brand }) => (
    <article>{brand.name}</article>
  ),
}))

const relatedBrand = {
  id: 'brand-1',
  name: 'Related Brand',
  slug: 'related-brand',
} as Brand

it('merges the category count and view-all link into the related section', async () => {
  render(await RelatedBrands({
    brands: [relatedBrand],
    category: 'apparel',
    categoryLabel: '服飾鞋履',
    categoryName: '服飾鞋履',
    count: 76,
  }))

  expect(screen.getByRole('heading', { name: '更多服飾鞋履' })).toBeInTheDocument()
  expect(screen.getByText('此分類還有 76 個品牌')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /查看全部/ })).toHaveAttribute(
    'href',
    '/brands?category=apparel',
  )
  expect(screen.getByText('Related Brand')).toBeInTheDocument()
})
