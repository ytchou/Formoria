// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrandFilterSidebar } from './brand-filter-sidebar'

const replace = vi.fn()
let query = ''

vi.mock('next/navigation', () => ({
  usePathname: () => '/brands',
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(query),
}))

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: (namespace: string) => (key: string, values?: { count: number }) => {
    const messages: Record<string, string> = {
      'brands.filters.appliedCount': `${values?.count ?? 0} filters applied`,
      'brands.filters.clearAll': 'Clear all',
      'brands.filters.category': 'Category',
      'brands.filters.priceRange': 'Price range',
      'brands.filters.brandStatus': 'Brand status',
      'brands.verificationFilter.all': 'All',
      'brands.verificationFilter.mit-verified': 'MIT verified',
      'brands.verificationFilter.owned': 'Brand managed',
    }
    return messages[`${namespace}.${key}`] ?? key
  },
}))

describe('BrandFilterSidebar', () => {
  beforeEach(() => {
    query = ''
    replace.mockClear()
  })

  it('renders price ranges as tags and writes the selected values to the URL', async () => {
    const user = userEvent.setup()
    render(<BrandFilterSidebar categories={[]} />)

    await user.click(screen.getByRole('button', { name: '$$' }))

    expect(replace).toHaveBeenCalledWith('/brands?price=2', { scroll: false })
  })

  it('counts and clears active price ranges', async () => {
    query = 'price=1%2C3'
    const user = userEvent.setup()
    render(<BrandFilterSidebar categories={[]} />)

    expect(screen.getByText('2 filters applied')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear all' }))

    expect(replace).toHaveBeenCalledWith('/brands', { scroll: false })
  })

  it('uses the same left-aligned option treatment for categories and status', () => {
    render(
      <BrandFilterSidebar
        categories={[
          {
            slug: 'bags-accessories',
            name: 'Bags & accessories',
            nameZh: '包袋配件',
          },
        ]}
      />
    )

    const categoryCheckbox = screen.getByRole('checkbox', {
      name: 'Bags & accessories',
    })
    const categoryLabel = categoryCheckbox.closest('label')
    const statusRadio = screen.getByRole('radio', { name: 'All' })
    const statusLabel = statusRadio.closest('label')

    expect(categoryLabel?.firstElementChild).toBe(categoryCheckbox)
    expect(categoryLabel).not.toHaveClass('justify-between')
    expect(categoryLabel).toHaveClass('type-card-description')
    expect(statusLabel).toHaveClass('type-card-description')
  })
})
