// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { NavCategoryTabs } from './nav-category-tabs'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('search=%E9%A6%99%E8%8D%89%E9%9B%86&category=jewelry'),
}))

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/brands',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))

vi.mock('next-intl', () => ({
  useLocale: () => 'zh-TW',
  useTranslations: () => (key: string) => (key === 'allBrands' ? '全部品牌' : key),
}))

describe('NavCategoryTabs', () => {
  it('does not underline the selected category', () => {
    render(
      <NavCategoryTabs
        categories={[
          { slug: 'jewelry', name: 'Jewelry', nameZh: '飾品珠寶' },
        ]}
      />,
    )

    const selectedCategory = screen.getByRole('button', { name: '飾品珠寶' })

    expect(selectedCategory).toHaveAttribute('data-active', 'true')
    expect(selectedCategory).not.toHaveClass('border-b-2', 'border-foreground')
  })

  it('has data-ph-no-autocapture on category tab buttons', () => {
    render(
      <NavCategoryTabs
        categories={[
          { slug: 'jewelry', name: 'Jewelry', nameZh: '飾品珠寶' },
        ]}
      />,
    )

    const allBrandsButton = screen.getByRole('button', { name: '全部品牌' })
    const categoryButton = screen.getByRole('button', { name: '飾品珠寶' })

    expect(allBrandsButton).toHaveAttribute('data-ph-no-autocapture')
    expect(categoryButton).toHaveAttribute('data-ph-no-autocapture')
  })
})
