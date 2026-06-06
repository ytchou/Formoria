// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { BrandCompleteness } from '@/lib/services/brand-completeness'

void within

// Mock next-intl server translations: echo "<namespace>.<key>" so we can assert by key,
// and interpolate values for messages like summary.
vi.mock('next-intl/server', () => ({
  getTranslations: async () => {
    const t = (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key
    return t
  },
}))

import { BrandCompletenessCard } from '@/components/dashboard/brand-completeness-card'

const completeness = (overrides?: Partial<BrandCompleteness>): BrandCompleteness => ({
  total: 9,
  completed: 3,
  fraction: 3 / 9,
  items: [
    { key: 'heroImage', complete: true, anchor: '#media' },
    { key: 'logo', complete: true, anchor: '#media' },
    { key: 'description', complete: true, anchor: '#description' },
    { key: 'purchaseLinks', complete: false, anchor: '#links' },
    { key: 'productPhotos', complete: false, anchor: '#media' },
    { key: 'socialLinks', complete: false, anchor: '#links' },
    { key: 'brandHighlights', complete: false, anchor: '#brandHighlights' },
    { key: 'foundingYear', complete: false, anchor: '#foundingYear' },
    { key: 'retailLocations', complete: false, anchor: '#locations' },
    ...[],
  ],
  ...overrides,
})

async function renderCard(c: BrandCompleteness, slug = 'test-brand') {
  render(await BrandCompletenessCard({ completeness: c, slug }))
}

describe('BrandCompletenessCard', () => {
  it('renders the summary with completed/total values', async () => {
    await renderCard(completeness())
    expect(screen.getByText(/dashboard\.completeness\.summary/)).toBeInTheDocument()
    expect(screen.getByText(/"completed":3/)).toBeInTheDocument()
    expect(screen.getByText(/"total":9/)).toBeInTheDocument()
  })

  it('renders incomplete items with an Edit deep link to the correct anchor', async () => {
    await renderCard(completeness())
    const editLinks = screen.getAllByRole('link', { name: /dashboard\.completeness\.editCta/ })
    expect(editLinks.length).toBe(6) // only the 6 incomplete items
    const hrefs = editLinks.map((a) => a.getAttribute('href'))
    expect(hrefs).toContain('/dashboard/brands/test-brand/edit#links')
    expect(hrefs).toContain('/dashboard/brands/test-brand/edit#media')
    expect(hrefs).toContain('/dashboard/brands/test-brand/edit#brandHighlights')
  })

  it('orders incomplete items before completed items', async () => {
    await renderCard(completeness())
    const labels = screen.getAllByTestId('completeness-item').map((el) => el.getAttribute('data-key'))
    const firstComplete = labels.indexOf('heroImage')
    const lastIncomplete = labels.indexOf('retailLocations')
    expect(lastIncomplete).toBeLessThan(firstComplete) // incomplete group precedes complete group
  })

  it('shows the celebratory complete state at 9/9 and no Edit links', async () => {
    const all = completeness({
      completed: 9, fraction: 1,
      items: completeness().items.map((i) => ({ ...i, complete: true })),
    })
    await renderCard(all)
    expect(screen.getByText('dashboard.completeness.complete')).toBeInTheDocument()
    expect(screen.queryAllByRole('link', { name: /editCta/ })).toHaveLength(0)
  })
})
